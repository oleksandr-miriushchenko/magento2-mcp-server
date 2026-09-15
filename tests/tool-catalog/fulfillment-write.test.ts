import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { createAppError, ERROR_CODE } from "../../src/core/errors.js";
import {
  InMemoryIdempotencyRegistry,
  InMemoryIdempotencyStore,
} from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { type FulfillmentWriter, MagentoFulfillment } from "../../src/magento/fulfillment.js";
import { registerFulfillmentWriteTools } from "../../src/tools/orders/fulfillment-write/register.js";
import {
  InvoiceCreateInputSchema,
  type OrderCancelInput,
  type OrderCancelSuccess,
  OrderCancelInputSchema,
  ShipmentCreateInputSchema,
  ShipmentCreateOutputSchema,
} from "../../src/tools/orders/fulfillment-write/schemas.js";
import {
  createInvoiceCreateWorkflow,
  createOrderCancelWorkflow,
  createShipmentCreateWorkflow,
} from "../../src/tools/orders/fulfillment-write/workflows.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

const idempotencyKey = "4f8ae949-6e10-4ea1-865d-32ea06b72d3f";
const orderCancelInput: OrderCancelInput = { order_id: 7, idempotency_key: idempotencyKey };

function writer() {
  return {
    cancelOrder: vi.fn<FulfillmentWriter["cancelOrder"]>(() => Promise.resolve()),
    holdOrder: vi.fn<FulfillmentWriter["holdOrder"]>(() => Promise.resolve()),
    unholdOrder: vi.fn<FulfillmentWriter["unholdOrder"]>(() => Promise.resolve()),
    sendOrderEmail: vi.fn<FulfillmentWriter["sendOrderEmail"]>(() => Promise.resolve()),
    createInvoice: vi.fn<FulfillmentWriter["createInvoice"]>(() => Promise.resolve(51)),
    createShipment: vi.fn<FulfillmentWriter["createShipment"]>(() => Promise.resolve(61)),
  } satisfies FulfillmentWriter;
}

function requestBody(call: { readonly init: RequestInit } | undefined): unknown {
  const body = call?.init.body;
  if (typeof body !== "string") throw new Error("Expected a JSON string request body.");
  return JSON.parse(body) as unknown;
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
    timeoutMs: 1000,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000,
    nonce: () => "fixed-test-nonce",
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fulfillment write input contracts", () => {
  it("accepts only UUID-bound allowlisted action and invoice inputs", () => {
    expect(OrderCancelInputSchema.safeParse(orderCancelInput).success).toBe(true);
    expect(
      OrderCancelInputSchema.safeParse({ ...orderCancelInput, status: "canceled" }).success,
    ).toBe(false);
    expect(
      OrderCancelInputSchema.safeParse({ ...orderCancelInput, idempotency_key: "same" }).success,
    ).toBe(false);
    expect(InvoiceCreateInputSchema.parse(orderCancelInput)).toEqual({
      ...orderCancelInput,
      capture: false,
      notify: false,
    });
    expect(
      InvoiceCreateInputSchema.safeParse({ ...orderCancelInput, capture: true, items: [] }).success,
    ).toBe(false);
  });

  it("bounds and canonicalizes shipment tracking without arbitrary fields", () => {
    const valid = ShipmentCreateInputSchema.parse({
      ...orderCancelInput,
      tracks: [{ track_number: "  T-1  ", carrier_code: "custom", title: " Carrier " }],
    });
    expect(valid).toMatchObject({
      notify: false,
      tracks: [{ track_number: "T-1", carrier_code: "custom", title: "Carrier" }],
    });
    expect(
      ShipmentCreateInputSchema.safeParse({
        ...orderCancelInput,
        tracks: Array.from({ length: 11 }, (_, index) => ({
          track_number: `T-${index}`,
          carrier_code: "custom",
          title: "Carrier",
        })),
      }).success,
    ).toBe(false);
    expect(
      ShipmentCreateInputSchema.safeParse({
        ...orderCancelInput,
        tracks: [
          {
            track_number: "T-1",
            carrier_code: "custom",
            title: "Carrier",
            arbitrary: true,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ShipmentCreateInputSchema.safeParse({
        ...orderCancelInput,
        tracks: [
          {
            track_number: "T-1",
            carrier_code: "c".repeat(33),
            title: "Carrier",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("Magento fulfillment write boundary", () => {
  it("uses exactly the six fixed POST routes and allowlisted request bodies", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const responses: unknown[] = [true, true, true, true, 51, 61];
    const fulfillment = new MagentoFulfillment(
      client((input, init) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(jsonResponse(responses.shift()));
      }),
    );
    const signal = new AbortController().signal;

    await fulfillment.cancelOrder(7, signal);
    await fulfillment.holdOrder(7, signal);
    await fulfillment.unholdOrder(7, signal);
    await fulfillment.sendOrderEmail(7, signal);
    await expect(fulfillment.createInvoice(7, true, false, signal)).resolves.toBe(51);
    await expect(
      fulfillment.createShipment(
        7,
        true,
        [{ trackNumber: "T-1", carrierCode: "custom", title: "Carrier" }],
        signal,
      ),
    ).resolves.toBe(61);

    expect(calls.map(({ init }) => init.method)).toEqual(Array(6).fill("POST"));
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual([
      "/rest/default/V1/orders/7/cancel",
      "/rest/default/V1/orders/7/hold",
      "/rest/default/V1/orders/7/unhold",
      "/rest/default/V1/orders/7/emails",
      "/rest/default/V1/order/7/invoice",
      "/rest/default/V1/order/7/ship",
    ]);
    expect(calls.slice(0, 4).map((call) => requestBody(call))).toEqual([{}, {}, {}, {}]);
    expect(requestBody(calls[4])).toEqual({ capture: true, notify: false });
    expect(requestBody(calls[5])).toEqual({
      notify: true,
      tracks: [{ track_number: "T-1", carrier_code: "custom", title: "Carrier" }],
    });
  });

  it("treats a schema-invalid successful POST response as an unknown outcome", async () => {
    const fulfillment = new MagentoFulfillment(
      client(() => Promise.resolve(jsonResponse({ private: "unexpected" }))),
    );
    await expect(fulfillment.cancelOrder(7, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_OUTCOME_UNKNOWN",
    });
  });

  it("treats a literal false POST response as a definitive rejection", async () => {
    const fulfillment = new MagentoFulfillment(client(() => Promise.resolve(jsonResponse(false))));

    await expect(fulfillment.cancelOrder(7, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      message: "Magento returned false and did not confirm the requested operation.",
      retryable: false,
    });
  });

  it("keeps a literal true POST response successful", async () => {
    const fulfillment = new MagentoFulfillment(client(() => Promise.resolve(jsonResponse(true))));

    await expect(fulfillment.cancelOrder(7, new AbortController().signal)).resolves.toBeUndefined();
  });

  it("treats malformed successful POST JSON as an unknown outcome", async () => {
    const fulfillment = new MagentoFulfillment(
      client(() =>
        Promise.resolve(
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );

    await expect(fulfillment.cancelOrder(7, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_OUTCOME_UNKNOWN",
    });
  });
});

describe("fulfillment write workflows", () => {
  it("performs one mutation, then replays without another writer call", async () => {
    const target = writer();
    const workflow = createOrderCancelWorkflow(
      target,
      new InMemoryIdempotencyStore<OrderCancelSuccess>(),
    );
    const signal = new AbortController().signal;
    const onAttempt = vi.fn();

    await expect(workflow.execute(orderCancelInput, signal, onAttempt)).resolves.toMatchObject({
      ok: true,
      data: { order_id: 7, canceled: true },
    });
    expect(target.cancelOrder).toHaveBeenCalledWith(7, signal, onAttempt);

    target.cancelOrder.mockClear();
    expect(workflow.lookup(orderCancelInput)).toMatchObject({ ok: true });
    expect(target.cancelOrder).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous mutation pending and blocks a duplicate", async () => {
    const target = writer();
    target.cancelOrder.mockRejectedValue(createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN));
    const workflow = createOrderCancelWorkflow(target, new InMemoryIdempotencyStore());

    await expect(
      workflow.execute(orderCancelInput, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN" });
    expect(() => workflow.lookup(orderCancelInput)).toThrow("ongoing or unresolved operation");
    expect(target.cancelOrder).toHaveBeenCalledOnce();
  });

  it("maps only approved invoice and shipment arguments to the writer", async () => {
    const target = writer();
    const invoiceWorkflow = createInvoiceCreateWorkflow(target, new InMemoryIdempotencyStore());
    const shipmentWorkflow = createShipmentCreateWorkflow(target, new InMemoryIdempotencyStore());
    const signal = new AbortController().signal;

    await invoiceWorkflow.execute({ ...orderCancelInput, capture: true, notify: false }, signal);
    await shipmentWorkflow.execute(
      {
        ...orderCancelInput,
        notify: true,
        tracks: [{ track_number: "T-1", carrier_code: "custom", title: "Carrier" }],
      },
      signal,
    );

    expect(target.createInvoice).toHaveBeenCalledWith(7, true, false, signal, undefined);
    expect(target.createShipment).toHaveBeenCalledWith(
      7,
      true,
      [{ trackNumber: "T-1", carrierCode: "custom", title: "Carrier" }],
      signal,
      undefined,
    );
  });
});

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly fetchCalls: { url: string; init: RequestInit }[];
  readonly audits: AuditInput[];
  readonly elicitations: unknown[];
}

const harnesses: Harness[] = [];

async function createHarness(mutationResponse?: () => Response): Promise<Harness> {
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const magento = client((input, init) => {
    fetchCalls.push({ url: String(input), init });
    return Promise.resolve(mutationResponse?.() ?? jsonResponse(61));
  });
  const audits: AuditInput[] = [];
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return Promise.resolve();
    },
  };
  const approval = createWriteApprovalPolicy(new Uint8Array(32).fill(7));
  const server = new McpServer(
    { name: "fulfillment-write-test", version: "0.1.0" },
    { requestState: { verify: approval.verify } },
  );
  registerFulfillmentWriteTools(createRateLimitedRegisterTool(server, createToolCallLimiter()), {
    client: magento,
    audit,
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(8),
  });

  const elicitations: unknown[] = [];
  const mcpClient = new Client(
    { name: "fulfillment-write-client", version: "0.1.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  mcpClient.setRequestHandler("elicitation/create", (request) => {
    elicitations.push(request.params);
    return Promise.resolve({ action: "accept", content: { confirm: true } });
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  const harness = { client: mcpClient, server, fetchCalls, audits, elicitations };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.server.close();
  }
});

describe("fulfillment write MCP boundary", () => {
  it("registers six strictly annotated tools", async () => {
    const harness = await createHarness();
    const listed = await harness.client.listTools();
    expect(listed.tools.map(({ name }) => name)).toEqual([
      "order_cancel",
      "order_hold",
      "order_unhold",
      "order_email_send",
      "invoice_create",
      "shipment_create",
    ]);
    for (const tool of listed.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true });
      expect(tool.outputSchema).toBeDefined();
    }
    for (const tool of listed.tools.filter(({ name }) =>
      ["order_cancel", "order_hold", "order_unhold"].includes(name),
    )) {
      expect(tool.annotations).toMatchObject({ destructiveHint: true });
    }
    for (const tool of listed.tools.filter(
      ({ name }) => !["order_cancel", "order_hold", "order_unhold"].includes(name),
    )) {
      expect(tool.annotations).toMatchObject({ destructiveHint: false });
    }
  });

  it("elicits, posts once, audits safely, and replays shipment_create", async () => {
    const harness = await createHarness();
    const argumentsValue = {
      ...orderCancelInput,
      notify: true,
      tracks: [{ track_number: "T-1", carrier_code: "custom", title: "Carrier" }],
    };
    const first = await harness.client.callTool({
      name: "shipment_create",
      arguments: argumentsValue,
    });

    expect(ShipmentCreateOutputSchema.safeParse(first.structuredContent).success).toBe(true);
    expect(first.structuredContent).toMatchObject({
      ok: true,
      data: { order_id: 7, shipment_id: 61, tracking_count: 1 },
    });
    expect(harness.elicitations).toHaveLength(1);
    expect(JSON.stringify(harness.elicitations)).not.toContain("T-1");
    expect(harness.fetchCalls.map(({ init }) => init.method)).toEqual(["POST"]);
    expect(harness.fetchCalls.map(({ url }) => new URL(url).pathname)).toEqual([
      "/rest/default/V1/order/7/ship",
    ]);
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      tool: "shipment_create",
      outcome: "success",
      attempt_count: 1,
    });
    expect(JSON.stringify(harness.audits)).not.toContain(idempotencyKey);
    expect(JSON.stringify(harness.audits)).not.toContain("T-1");

    const replay = await harness.client.callTool({
      name: "shipment_create",
      arguments: argumentsValue,
    });
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect(harness.elicitations).toHaveLength(1);
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.audits[1]).toMatchObject({ outcome: "success", attempt_count: 0 });
  });
});
