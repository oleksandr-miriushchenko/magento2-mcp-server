import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { createAppError, ERROR_CODE } from "../../src/core/errors.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { MagentoInventory } from "../../src/magento/inventory.js";
import { MagentoProductDetails } from "../../src/magento/product-details.js";
import type { ToolDependencies } from "../../src/tools/dependencies.js";
import { registerInventoryUpdate } from "../../src/tools/inventory/inventory-update/register.js";
import {
  InventoryUpdateInputSchema,
  InventoryUpdateOutputSchema,
} from "../../src/tools/inventory/inventory-update/schemas.js";
import { createInventoryUpdateWorkflow } from "../../src/tools/inventory/inventory-update/workflow.js";
import { registerProductUpdate } from "../../src/tools/products/product-update/register.js";
import {
  ProductUpdateInputSchema,
  ProductUpdateOutputSchema,
} from "../../src/tools/products/product-update/schemas.js";
import { createProductUpdateWorkflow } from "../../src/tools/products/product-update/workflow.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

const PRODUCT_KEY = "64f6c4c3-7c8b-4409-b028-c7f8433cc349";
const INVENTORY_KEY = "a86b375c-2847-4521-8bf9-197dd0cdd38b";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function client(fetchImplementation: MagentoFetch): MagentoClient {
  return new MagentoClient({
    baseUrl: "https://shop.example/",
    storeScope: "default",
    oauth: {
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    },
    timeoutMs: 1_000,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000,
    nonce: () => "business-write-test-nonce",
  });
}

describe("business write schemas and workflows", () => {
  it("accepts only allowlisted product changes and bounded unique inventory items", () => {
    expect(
      ProductUpdateInputSchema.safeParse({ sku: "SKU-1", idempotency_key: PRODUCT_KEY }).success,
    ).toBe(false);
    expect(
      ProductUpdateInputSchema.safeParse({
        sku: "SKU-1",
        price: 10,
        custom_attributes: [{ code: "cost", value: 2 }],
        idempotency_key: PRODUCT_KEY,
      }).success,
    ).toBe(false);
    expect(
      InventoryUpdateInputSchema.safeParse({
        source_items: Array.from({ length: 101 }, () => ({
          sku: "SKU-1",
          source_code: "default",
          quantity: 1,
          status: "in_stock",
        })),
        idempotency_key: INVENTORY_KEY,
      }).success,
    ).toBe(false);
    expect(
      InventoryUpdateInputSchema.safeParse({
        source_items: [
          { sku: "SKU-1", source_code: "default", quantity: 1, status: "in_stock" },
          { sku: "SKU-1", source_code: "default", quantity: 2, status: "out_of_stock" },
        ],
        idempotency_key: INVENTORY_KEY,
      }).success,
    ).toBe(false);
  });

  it("performs one product PUT and replays without I/O", async () => {
    const products = {
      updateProduct: vi.fn(() => Promise.resolve()),
    };
    const registry = new InMemoryIdempotencyRegistry();
    const workflow = createProductUpdateWorkflow(products, registry.forTool("product_update"));
    const input = ProductUpdateInputSchema.parse({
      sku: "SKU-1",
      price: 89,
      status: "disabled",
      idempotency_key: PRODUCT_KEY,
    });
    const signal = new AbortController().signal;
    await expect(workflow.execute(input, signal)).resolves.toEqual({
      ok: true,
      data: { sku: "SKU-1", updated: true, changed_fields: ["price", "status"] },
    });
    expect(products.updateProduct).toHaveBeenCalledWith(
      "SKU-1",
      { price: 89, status: 2 },
      signal,
      undefined,
    );
    products.updateProduct.mockClear();
    expect(workflow.lookup(input)).toMatchObject({ ok: true });
    expect(products.updateProduct).not.toHaveBeenCalled();
  });

  it("sends all inventory source items in one POST", async () => {
    const inventory = {
      updateSourceItems: vi.fn(() => Promise.resolve()),
    };
    const workflow = createInventoryUpdateWorkflow(
      inventory,
      new InMemoryIdempotencyRegistry().forTool("inventory_update"),
    );
    const input = InventoryUpdateInputSchema.parse({
      source_items: [
        { sku: "SKU-1", source_code: "west", quantity: 2, status: "in_stock" },
        { sku: "SKU-1", source_code: "east", quantity: 0, status: "out_of_stock" },
      ],
      idempotency_key: INVENTORY_KEY,
    });
    await expect(workflow.execute(input, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      data: { updated_count: 2 },
    });
    expect(inventory.updateSourceItems).toHaveBeenCalledOnce();
    expect(inventory.updateSourceItems).toHaveBeenCalledWith(
      [
        { sku: "SKU-1", sourceCode: "east", quantity: 0, status: 0 },
        { sku: "SKU-1", sourceCode: "west", quantity: 2, status: 1 },
      ],
      expect.any(AbortSignal),
      undefined,
    );
  });

  it("keeps an ambiguous write pending for its idempotency key", async () => {
    const products = {
      updateProduct: vi.fn(() =>
        Promise.reject(createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN)),
      ),
    };
    const workflow = createProductUpdateWorkflow(
      products,
      new InMemoryIdempotencyRegistry().forTool("product_update"),
    );
    const input = ProductUpdateInputSchema.parse({
      sku: "SKU-1",
      price: 1,
      idempotency_key: PRODUCT_KEY,
    });
    await expect(workflow.execute(input, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_OUTCOME_UNKNOWN",
    });
    expect(() => workflow.lookup(input)).toThrow("ongoing or unresolved operation");
  });
});

describe("business write Magento boundaries", () => {
  it("uses the exact fixed PUT and POST payloads without retries", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = client((input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        init.method === "PUT" ? jsonResponse({ sku: "SKU/1" }) : jsonResponse([]),
      );
    });
    await new MagentoProductDetails(transport).updateProduct(
      "SKU/1",
      { name: "New", price: 5, status: 2, visibility: 1, weight: 3 },
      new AbortController().signal,
    );
    await new MagentoInventory(transport).updateSourceItems(
      [{ sku: "SKU/1", sourceCode: "west", quantity: 4, status: 1 }],
      new AbortController().signal,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://shop.example/rest/default/V1/products/SKU%2F1");
    expect(calls[0]?.init.method).toBe("PUT");
    const productBody = calls[0]?.init.body;
    if (typeof productBody !== "string") throw new Error("Expected product JSON body.");
    expect(JSON.parse(productBody)).toEqual({
      product: {
        sku: "SKU/1",
        name: "New",
        price: 5,
        status: 2,
        visibility: 1,
        weight: 3,
      },
    });
    expect(calls[1]?.url).toBe("https://shop.example/rest/default/V1/inventory/source-items");
    expect(calls[1]?.init.method).toBe("POST");
    const inventoryBody = calls[1]?.init.body;
    if (typeof inventoryBody !== "string") throw new Error("Expected inventory JSON body.");
    expect(JSON.parse(inventoryBody)).toEqual({
      sourceItems: [{ sku: "SKU/1", source_code: "west", quantity: 4, status: 1 }],
    });
  });
});

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly calls: { url: string; init: RequestInit }[];
  readonly audits: AuditInput[];
  readonly elicitations: unknown[];
}

const harnesses: Harness[] = [];

async function createHarness(): Promise<Harness> {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImplementation: MagentoFetch = (input, init) => {
    calls.push({ url: String(input), init });
    if (init.method === "PUT") return Promise.resolve(jsonResponse({ sku: "SKU-1" }));
    return Promise.resolve(jsonResponse([]));
  };
  const audits: AuditInput[] = [];
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return Promise.resolve();
    },
  };
  const approval = createWriteApprovalPolicy(new Uint8Array(32).fill(8));
  const dependencies: ToolDependencies = {
    client: client(fetchImplementation),
    audit,
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(9),
  };
  const server = new McpServer(
    { name: "business-write-test", version: "0.1.0" },
    { requestState: { verify: approval.verify } },
  );
  const registerTool = createRateLimitedRegisterTool(server, createToolCallLimiter());
  registerProductUpdate(registerTool, dependencies);
  registerInventoryUpdate(registerTool, dependencies);
  const mcpClient = new Client(
    { name: "business-write-client", version: "0.1.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const elicitations: unknown[] = [];
  mcpClient.setRequestHandler("elicitation/create", (request) => {
    elicitations.push(request.params);
    return Promise.resolve({ action: "accept", content: { confirm: true } });
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  const value = { client: mcpClient, server, calls, audits, elicitations };
  harnesses.push(value);
  return value;
}

afterEach(async () => {
  for (const value of harnesses.splice(0)) {
    await value.client.close();
    await value.server.close();
  }
});

describe("business write MCP handlers", () => {
  it("requires approval, sends one mutation per tool, and returns JSON mirrors", async () => {
    const harness = await createHarness();
    const listed = await harness.client.listTools();
    for (const tool of listed.tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    }

    const product = await harness.client.callTool({
      name: "product_update",
      arguments: { sku: "SKU-1", price: 88, idempotency_key: PRODUCT_KEY },
    });
    const inventory = await harness.client.callTool({
      name: "inventory_update",
      arguments: {
        source_items: [{ sku: "SKU-1", source_code: "default", quantity: 5, status: "in_stock" }],
        idempotency_key: INVENTORY_KEY,
      },
    });

    expect(ProductUpdateOutputSchema.safeParse(product.structuredContent).success).toBe(true);
    expect(InventoryUpdateOutputSchema.safeParse(inventory.structuredContent).success).toBe(true);
    expect(product.content).toEqual([
      { type: "text", text: JSON.stringify(product.structuredContent) },
    ]);
    expect(inventory.content).toEqual([
      { type: "text", text: JSON.stringify(inventory.structuredContent) },
    ]);
    expect(harness.elicitations).toHaveLength(2);
    expect(harness.calls.map((call) => call.init.method)).toEqual(["PUT", "POST"]);
    expect(harness.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/rest/default/V1/products/SKU-1",
      "/rest/default/V1/inventory/source-items",
    ]);
    expect(harness.audits).toEqual([
      expect.objectContaining({ tool: "product_update", outcome: "success", attempt_count: 1 }),
      expect.objectContaining({ tool: "inventory_update", outcome: "success", attempt_count: 1 }),
    ]);
    expect(JSON.stringify(harness.audits)).not.toContain("SKU-1");
    expect(JSON.stringify(harness.audits)).not.toContain(PRODUCT_KEY);
    expect(JSON.stringify(harness.audits)).not.toContain(INVENTORY_KEY);
  });
});
