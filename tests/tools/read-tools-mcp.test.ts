import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { createAppError, ERROR_CODE } from "../../src/core/errors.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { registerTools } from "../../src/tools/index.js";
import { ORDER_GET_TOOL, OrderGetOutputSchema } from "../../src/tools/orders/order-get/schemas.js";
import { OrderSearchOutputSchema } from "../../src/tools/orders/order-search/schemas.js";
import { ProductSearchOutputSchema } from "../../src/tools/products/product-search/schemas.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

const rawOrder = {
  entity_id: 7,
  increment_id: "000000007",
  store_id: 0,
  status: "processing",
  state: "processing",
  created_at: "2026-08-27 10:00:00",
  updated_at: "2026-08-27 11:00:00",
  order_currency_code: "USD",
  subtotal: 10,
  discount_amount: 0,
  shipping_amount: 0,
  tax_amount: 0,
  grand_total: 10,
  total_paid: null,
  total_refunded: null,
  customer_is_guest: 1,
  customer_firstname: null,
  customer_lastname: null,
  customer_email: null,
  billing_address: null,
  items: [],
  status_histories: [],
  payment: null,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const defaultFetch: MagentoFetch = () => Promise.resolve(jsonResponse(rawOrder));

function createMagentoClient(fetchImplementation: MagentoFetch): MagentoClient {
  return new MagentoClient({
    baseUrl: "https://shop.example/",
    storeScope: "default",
    oauth: {
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    },
    timeoutMs: 1000,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000,
    nonce: () => "fixed-test-nonce",
  });
}

interface HarnessOptions {
  readonly fetch?: MagentoFetch;
  readonly client?: MagentoClient;
  readonly audit?: AuditWriter;
}

interface ToolHarness {
  readonly client: Client;
  readonly server: McpServer;
  readonly audits: AuditInput[];
  readonly fetchCount: () => number;
}

const harnesses: ToolHarness[] = [];

async function createHarness(options: HarnessOptions = {}): Promise<ToolHarness> {
  let fetchCount = 0;
  const injectedFetch = options.fetch ?? defaultFetch;
  const client =
    options.client ??
    createMagentoClient((input, init) => {
      fetchCount += 1;
      return injectedFetch(input, init);
    });
  const audits: AuditInput[] = [];
  const audit =
    options.audit ??
    ({
      write(input) {
        audits.push(input);
        return Promise.resolve();
      },
    } satisfies AuditWriter);
  const server = new McpServer({ name: "order-get-test-server", version: "0.1.0" });
  registerTools(createRateLimitedRegisterTool(server, createToolCallLimiter()), {
    client,
    audit,
    approval: createWriteApprovalPolicy(new Uint8Array(32).fill(1)),
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(2),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcpClient = new Client({ name: "order-get-test-client", version: "0.1.0" });
  await mcpClient.connect(clientTransport);

  const harness = { client: mcpClient, server, audits, fetchCount: () => fetchCount };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.server.close();
  }
});

function expectApplicationResult(result: Awaited<ReturnType<Client["callTool"]>>): void {
  expect(OrderGetOutputSchema.safeParse(result.structuredContent).success).toBe(true);
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected one JSON text result");
  expect(result.content).toHaveLength(1);
  expect(content.text).toBe(JSON.stringify(result.structuredContent));
}

describe("order_get public MCP boundary", () => {
  it("lists exactly the approved Adobe Commerce PaaS admin tool catalog", async () => {
    const { client } = await createHarness();
    const listed = await client.listTools();

    expect(listed.tools.map(({ name }) => name).sort()).toEqual([
      "category_tree_get",
      "cms_page_get",
      "cms_page_search",
      "cms_page_update",
      "coupon_generate",
      "coupon_search",
      "credit_memo_get",
      "credit_memo_search",
      "customer_get",
      "customer_group_search",
      "customer_search",
      "inventory_get",
      "inventory_source_search",
      "inventory_stock_search",
      "inventory_update",
      "invoice_create",
      "invoice_get",
      "invoice_search",
      "order_add_comment",
      "order_analytics_get",
      "order_cancel",
      "order_email_send",
      "order_get",
      "order_hold",
      "order_search",
      "order_tracking_get",
      "order_unhold",
      "product_attribute_get",
      "product_attribute_search",
      "product_get",
      "product_search",
      "product_update",
      "quote_search",
      "sales_rule_get",
      "sales_rule_search",
      "shipment_create",
      "shipment_get",
      "shipment_search",
      "store_hierarchy_get",
    ]);
    for (const listedTool of listed.tools) {
      expect(JSON.stringify(listedTool.outputSchema)).toContain("RATE_LIMITED");
    }
    const tool = listed.tools.find(({ name }) => name === "order_get");
    expect(tool).toMatchObject({
      name: "order_get",
      title: "Get Magento Order",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["order_id"],
      },
    });
    expect(tool?.annotations).toEqual({ readOnlyHint: true });
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["order_id"]);

    const outputSchema = JSON.stringify(tool?.outputSchema);
    for (const code of [
      "FORBIDDEN",
      "RATE_LIMITED",
      "NOT_FOUND",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_INVALID_RESPONSE",
      "INTERNAL_ERROR",
    ]) {
      expect(outputSchema).toContain(code);
    }
    expect(outputSchema).not.toContain("INVALID_ARGUMENT");
    expect(outputSchema).not.toContain("shipment");
    expect(outputSchema).not.toContain("tracking");

    const writeTool = listed.tools.find(({ name }) => name === "order_add_comment");
    expect(writeTool).toMatchObject({
      name: "order_add_comment",
      title: "Add Private Magento Order Comment",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["order_id", "comment", "idempotency_key"],
      },
    });
    expect(Object.keys(writeTool?.inputSchema.properties ?? {})).toEqual([
      "order_id",
      "comment",
      "idempotency_key",
    ]);
    expect(JSON.stringify(writeTool?.outputSchema)).not.toContain("Private note");

    const orderSearch = listed.tools.find(({ name }) => name === "order_search");
    expect(orderSearch).toMatchObject({
      title: "Search Magento Orders",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", additionalProperties: false },
    });
    expect(Object.keys(orderSearch?.inputSchema.properties ?? {})).toEqual([
      "increment_id",
      "customer_email",
      "customer_id",
      "status",
      "created_from",
      "created_to",
      "grand_total_min",
      "grand_total_max",
      "sort",
      "page_size",
      "cursor",
    ]);
    expect(JSON.stringify(orderSearch?.outputSchema)).toContain("INVALID_CURSOR");

    const productSearch = listed.tools.find(({ name }) => name === "product_search");
    expect(productSearch).toMatchObject({
      title: "Search Magento Products",
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object", additionalProperties: false },
    });
    expect(Object.keys(productSearch?.inputSchema.properties ?? {})).toEqual([
      "search",
      "sku",
      "status",
      "visibility",
      "product_type",
      "price_min",
      "price_max",
      "sort",
      "page_size",
      "cursor",
    ]);
    expect(JSON.stringify(productSearch?.outputSchema)).toContain("INVALID_CURSOR");
  });

  it("returns a mapped, cursor-paginated order_search result with customer PII", async () => {
    const requestedPages: string[] = [];
    const orderSummary = {
      entity_id: 7,
      increment_id: "000000007",
      store_id: 0,
      state: "processing",
      created_at: "2026-08-27 10:00:00",
      updated_at: "2026-08-27 11:00:00",
      order_currency_code: "USD",
      grand_total: 10,
      total_paid: null,
      total_refunded: null,
      total_item_count: 1,
      customer_is_guest: 0,
      customer_firstname: "Jane",
      customer_lastname: "Doe",
      customer_email: "jane@example.com",
    };
    const harness = await createHarness({
      fetch(input) {
        const url = new URL(String(input));
        requestedPages.push(url.searchParams.get("searchCriteria[currentPage]") ?? "");
        const page = Number(url.searchParams.get("searchCriteria[currentPage]"));
        return Promise.resolve(
          jsonResponse({ items: page === 1 ? [orderSummary] : [], total_count: 26 }),
        );
      },
    });

    const first = await harness.client.callTool({
      name: "order_search",
      arguments: { status: "processing" },
    });
    const parsedFirst = OrderSearchOutputSchema.safeParse(first.structuredContent);
    expect(parsedFirst.success).toBe(true);
    if (!parsedFirst.success || !parsedFirst.data.ok) throw new Error("expected order search");
    expect(parsedFirst.data.data.orders[0]).toMatchObject({
      order_id: 7,
      status: null,
      customer: {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
      },
    });
    expect(parsedFirst.data.data.next_cursor).not.toBeNull();
    expect(first.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify(first.structuredContent),
    });

    const second = await harness.client.callTool({
      name: "order_search",
      arguments: {
        status: "processing",
        cursor: parsedFirst.data.data.next_cursor,
      },
    });
    expect(OrderSearchOutputSchema.safeParse(second.structuredContent).success).toBe(true);
    expect(requestedPages).toEqual(["1", "2"]);
    expect(harness.audits).toHaveLength(2);
    expect(harness.audits).toEqual([
      expect.objectContaining({ tool: "order_search", outcome: "success", attempt_count: 1 }),
      expect.objectContaining({ tool: "order_search", outcome: "success", attempt_count: 1 }),
    ]);
    expect(JSON.stringify(harness.audits)).not.toContain("processing");
    expect(JSON.stringify(harness.audits)).not.toContain("example.com");
  });

  it("returns a mapped product_search result and rejects a cursor with changed criteria", async () => {
    let requestedUrl: URL | undefined;
    const harness = await createHarness({
      fetch(input) {
        requestedUrl = new URL(String(input));
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 11,
                sku: "SKU-11",
                name: "Trail Shoe",
                attribute_set_id: 4,
                price: 79.5,
                status: 1,
                visibility: 4,
                type_id: "simple",
                created_at: "2026-08-20 10:00:00",
                updated_at: "2026-08-21 10:00:00",
              },
            ],
            total_count: 30,
          }),
        );
      },
    });

    const first = await harness.client.callTool({
      name: "product_search",
      arguments: { search: "shoe", status: "enabled", sort: "price_low_to_high" },
    });
    const parsed = ProductSearchOutputSchema.safeParse(first.structuredContent);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) throw new Error("expected product search");
    expect(parsed.data.data.products[0]).toEqual({
      product_id: 11,
      sku: "SKU-11",
      name: "Trail Shoe",
      product_type: "simple",
      status: "enabled",
      visibility: "catalog_search",
      price: 79.5,
      attribute_set_id: 4,
      created_at: "2026-08-20 10:00:00",
      updated_at: "2026-08-21 10:00:00",
    });
    expect(requestedUrl?.searchParams.get("fields")).toContain("items[id,sku,name");
    expect(requestedUrl?.searchParams.get("searchCriteria[sortOrders][0][field]")).toBe("price");

    const changed = await harness.client.callTool({
      name: "product_search",
      arguments: { search: "boot", cursor: parsed.data.data.next_cursor },
    });
    expect(changed.isError).toBe(true);
    expect(changed.structuredContent).toMatchObject({
      ok: false,
      error: { code: "INVALID_CURSOR", retryable: false },
    });
    expect(harness.fetchCount()).toBe(1);
  });

  it("returns output-valid empty results for Magento sparse collections serialized as null", async () => {
    const harness = await createHarness({
      fetch: () => Promise.resolve(jsonResponse({ items: null, total_count: 0 })),
    });

    const orderResult = await harness.client.callTool({
      name: "order_search",
      arguments: { status: "processing" },
    });
    const parsedOrder = OrderSearchOutputSchema.safeParse(orderResult.structuredContent);
    expect(parsedOrder.success).toBe(true);
    if (!parsedOrder.success || !parsedOrder.data.ok) throw new Error("expected order search");
    expect(parsedOrder.data.data).toMatchObject({
      orders: [],
      total_count: 0,
      next_cursor: null,
    });
    expect(orderResult.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify(orderResult.structuredContent),
    });

    const productResult = await harness.client.callTool({
      name: "product_search",
      arguments: { sku: "DOES-NOT-EXIST" },
    });
    const parsedProduct = ProductSearchOutputSchema.safeParse(productResult.structuredContent);
    expect(parsedProduct.success).toBe(true);
    if (!parsedProduct.success || !parsedProduct.data.ok)
      throw new Error("expected product search");
    expect(parsedProduct.data.data).toMatchObject({
      products: [],
      total_count: 0,
      next_cursor: null,
    });
    expect(productResult.content[0]).toMatchObject({
      type: "text",
      text: JSON.stringify(productResult.structuredContent),
    });
  });

  it("calls the registered handler and returns one output-valid JSON-mirrored success", async () => {
    const harness = await createHarness();
    const result = await harness.client.callTool({
      name: "order_get",
      arguments: { order_id: 7 },
    });

    expect(result.isError).toBeUndefined();
    expectApplicationResult(result);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { order_id: 7, shipping_address: null },
    });
    expect(harness.fetchCount()).toBe(1);
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      order_id: 7,
      outcome: "success",
      attempt_count: 1,
    });
  });

  it("returns real shipping PII in both MCP payloads with one request and no PII audit", async () => {
    const harness = await createHarness({
      fetch: () =>
        Promise.resolve(
          jsonResponse({
            ...rawOrder,
            extension_attributes: {
              shipping_assignments: [
                {
                  shipping: {
                    address: {
                      firstname: "Recipient",
                      email: "recipient@example.com",
                      street: ["Private street"],
                      country_id: "BG",
                      vat_id: "private-tax-id",
                    },
                  },
                },
              ],
            },
          }),
        ),
    });
    const result = await harness.client.callTool({
      name: ORDER_GET_TOOL,
      arguments: { order_id: 7 },
    });

    expect(result.isError).toBeUndefined();
    expectApplicationResult(result);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        billing_address: null,
        shipping_address: {
          first_name: "Recipient",
          email: "recipient@example.com",
          street: ["Private street"],
          country_code: "BG",
        },
      },
    });
    expect(harness.fetchCount()).toBe(1);
    expect(harness.audits).toHaveLength(1);
    for (const returned of ["Recipient", "recipient@example.com", "Private street"]) {
      expect(JSON.stringify(result.structuredContent)).toContain(returned);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(returned),
      });
      expect(JSON.stringify(harness.audits)).not.toContain(returned);
    }
    expect(JSON.stringify(result)).not.toContain("private-tax-id");
    expect(JSON.stringify(harness.audits)).not.toContain("private-tax-id");
    expect(JSON.stringify(harness.audits)).not.toContain("shipping_address");
  });

  it.each([
    {
      code: "FORBIDDEN",
      fetch: () => Promise.resolve(new Response("recipient@example.com", { status: 403 })),
    },
    {
      code: "NOT_FOUND",
      fetch: () => Promise.resolve(new Response("recipient@example.com", { status: 404 })),
    },
    {
      code: "UPSTREAM_UNAVAILABLE",
      fetch: () => Promise.resolve(new Response("recipient@example.com", { status: 500 })),
    },
    {
      code: "UPSTREAM_INVALID_RESPONSE",
      fetch: () =>
        Promise.resolve(jsonResponse({ entity_id: 7, customer_email: "recipient@example.com" })),
    },
  ] satisfies { code: string; fetch: MagentoFetch }[])(
    "returns the structured $code application failure",
    async ({ code, fetch }) => {
      const harness = await createHarness({ fetch });
      const result = await harness.client.callTool({
        name: "order_get",
        arguments: { order_id: 7 },
      });

      expect(result.isError).toBe(true);
      expectApplicationResult(result);
      expect(result.structuredContent).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain("recipient@example.com");
      expect(JSON.stringify(harness.audits)).not.toContain("recipient@example.com");
      expect(harness.audits).toHaveLength(1);
    },
  );

  it("normalizes an escaped workflow exception to a safe structured INTERNAL_ERROR", async () => {
    const unsafeClient = {
      getJson: () => Promise.reject(new Error("raw customer and credential details")),
    } as unknown as MagentoClient;
    const harness = await createHarness({ client: unsafeClient });
    const result = await harness.client.callTool({
      name: "order_get",
      arguments: { order_id: 7 },
    });

    expect(result.isError).toBe(true);
    expectApplicationResult(result);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(JSON.stringify(result)).not.toContain("customer and credential");
  });

  it("does not expose UPSTREAM_OUTCOME_UNKNOWN through order_get", async () => {
    const invalidReadClient = {
      getJson: () => Promise.reject(createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN)),
    } as unknown as MagentoClient;
    const harness = await createHarness({ client: invalidReadClient });
    const result = await harness.client.callTool({
      name: "order_get",
      arguments: { order_id: 7 },
    });

    expect(result.isError).toBe(true);
    expectApplicationResult(result);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: ERROR_CODE.INTERNAL_ERROR },
    });
  });

  it("lets the SDK reject schema-invalid input before fetch, handler, or audit", async () => {
    const harness = await createHarness();
    const result = await harness.client.callTool({
      name: "order_get",
      arguments: { order_id: "7" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(harness.fetchCount()).toBe(0);
    expect(harness.audits).toHaveLength(0);
  });
});
