import {
  createServer as createHttpServer,
  request as createHttpRequest,
  type Server as HttpServer,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";

import type { ServerConfig } from "../../src/core/config.js";
import type { MagentoFetch } from "../../src/magento/client.js";
import { DEFAULT_MAGENTO_MAX_RESPONSE_BYTES } from "../../src/magento/response-size.js";
import { createServerFactory } from "../../src/server.js";
import { OrderGetOutputSchema } from "../../src/tools/orders/order-get/schemas.js";
import { COMMON_ERROR_CODE } from "../../src/tools/shared/error-codes.js";
import {
  createHttpRequestListener,
  MCP_HTTP_PATH,
} from "../../src/transports/http-request-listener.js";

const toolArguments = {
  order_id: 7,
  comment: "Private note",
  idempotency_key: "4f8ae949-6e10-4ea1-865d-32ea06b72d3f",
};
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
const networkFetch = globalThis.fetch;

interface Harness {
  readonly client: Client;
  readonly endpoint: URL;
  readonly handler: McpHttpHandler;
  readonly httpServer: HttpServer;
  readonly fetchCount: () => number;
  readonly elicitationCount: () => number;
}

const harnesses: Harness[] = [];
const auditDirectories: string[] = [];

async function requestStatus(url: URL, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end();
  });
}

async function createHarness(
  magentoResponse: unknown = true,
  waitForMagentoResponse: Promise<void> = Promise.resolve(),
  maxResponseBytes = DEFAULT_MAGENTO_MAX_RESPONSE_BYTES,
): Promise<Harness> {
  let fetchCount = 0;
  let elicitationCount = 0;
  const fetchImplementation: MagentoFetch = async () => {
    fetchCount += 1;
    await waitForMagentoResponse;
    return new Response(JSON.stringify(magentoResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  vi.stubGlobal("fetch", fetchImplementation);
  const auditDirectory = await mkdtemp(join(tmpdir(), "magento2-mcp-http-test-"));
  auditDirectories.push(auditDirectory);
  const config: ServerConfig = {
    baseUrl: "https://shop.example/",
    storeScope: "default",
    oauth: {
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    },
    requestTimeoutMs: 1000,
    maxResponseBytes,
    maxPageSize: 25,
    auditFile: join(auditDirectory, "audit.jsonl"),
  };
  const handler = createMcpHandler(createServerFactory(config), {
    legacy: "reject",
    responseMode: "auto",
  });
  const httpServer = createHttpServer(createHttpRequestListener(handler, () => undefined));
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing HTTP test address.");
  const endpoint = new URL(`http://127.0.0.1:${address.port}${MCP_HTTP_PATH}`);
  const transport = new StreamableHTTPClientTransport(endpoint, { fetch: networkFetch });
  const client = new Client(
    { name: "http-test-client", version: "0.1.0" },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  client.setRequestHandler("elicitation/create", () => {
    elicitationCount += 1;
    return Promise.resolve({ action: "accept", content: { confirm: true } });
  });
  const harness = {
    client,
    endpoint,
    handler,
    httpServer,
    fetchCount: () => fetchCount,
    elicitationCount: () => elicitationCount,
  };
  harnesses.push(harness);
  await client.connect(transport);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.handler.close();
    await new Promise<void>((resolve, reject) => {
      harness.httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of auditDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("Streamable HTTP transport", () => {
  it("passes the configured Magento response limit into the client", async () => {
    const harness = await createHarness(rawOrder, Promise.resolve(), 64);

    const result = await harness.client.callTool({
      name: "order_get",
      arguments: { order_id: 7 },
    });

    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_INVALID_RESPONSE" },
    });
    expect(result.isError).toBe(true);
    expect(harness.fetchCount()).toBe(1);
  });

  it("serves the modern protocol with approval and idempotency across requests", async () => {
    const harness = await createHarness();

    expect(harness.client.getProtocolEra()).toBe("modern");
    const tools = await harness.client.listTools();
    expect(tools.tools).toHaveLength(39);

    const first = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(first.structuredContent).toMatchObject({
      ok: true,
      data: { order_id: 7, comment_added: true },
    });
    expect(harness.elicitationCount()).toBe(1);
    expect(harness.fetchCount()).toBe(1);

    const replay = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect(harness.elicitationCount()).toBe(1);
    expect(harness.fetchCount()).toBe(1);
  });

  it("applies localhost guards before routing", async () => {
    const harness = await createHarness();

    const invalidHost = await requestStatus(new URL("/not-mcp", harness.endpoint), {
      Host: "example.com",
    });
    expect(invalidHost).toBe(403);

    const invalidOrigin = await requestStatus(harness.endpoint, {
      Origin: "https://example.com",
    });
    expect(invalidOrigin).toBe(403);

    const unknownPath = await requestStatus(new URL("/not-mcp", harness.endpoint));
    expect(unknownPath).toBe(404);
  });

  it("shares one tool-call bucket across separate HTTP requests", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const harness = await createHarness(rawOrder);

    const results = await Promise.all(
      Array.from({ length: 11 }, () =>
        harness.client.callTool({ name: "order_get", arguments: { order_id: 7 } }),
      ),
    );
    const parsed = results.map((result) =>
      OrderGetOutputSchema.safeParse(result.structuredContent),
    );
    expect(parsed.every((result) => result.success)).toBe(true);
    const rateLimited = results.filter(
      (result) =>
        (result.structuredContent as { error?: { code?: string } } | undefined)?.error?.code ===
        COMMON_ERROR_CODE.RATE_LIMITED,
    );
    const successful = results.filter(
      (result) => (result.structuredContent as { ok?: boolean } | undefined)?.ok === true,
    );

    expect(successful).toHaveLength(10);
    expect(rateLimited).toHaveLength(1);
    expect(rateLimited[0]).toMatchObject({ isError: true });
    expect(harness.fetchCount()).toBe(10);
  });

  it("caps in-flight tool calls across separate HTTP requests", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let releaseMagento: () => void = () => undefined;
    const waitForMagentoResponse = new Promise<void>((resolve) => {
      releaseMagento = resolve;
    });
    const harness = await createHarness(rawOrder, waitForMagentoResponse);
    const inFlight = Array.from({ length: 10 }, () =>
      harness.client.callTool({ name: "order_get", arguments: { order_id: 7 } }),
    );

    try {
      await vi.waitFor(() => {
        expect(harness.fetchCount()).toBe(10);
      });
      now = 1_000;

      const rejected = await harness.client.callTool({
        name: "order_get",
        arguments: { order_id: 7 },
      });
      expect(rejected.structuredContent).toMatchObject({
        ok: false,
        error: { code: COMMON_ERROR_CODE.RATE_LIMITED },
      });
      expect(rejected).toMatchObject({ isError: true });
      expect(harness.fetchCount()).toBe(10);
    } finally {
      releaseMagento();
    }

    const completed = await Promise.all(inFlight);
    expect(
      completed.every(
        (result) => (result.structuredContent as { ok?: boolean } | undefined)?.ok === true,
      ),
    ).toBe(true);
  });
});
