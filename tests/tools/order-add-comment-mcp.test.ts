import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import { ERROR_CODE } from "../../src/core/errors.js";
import { WRITE_ERROR_CODE } from "../../src/tools/shared/error-codes.js";
import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import {
  createWriteApprovalPolicy,
  type WriteApprovalPolicy,
} from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { registerTools } from "../../src/tools/index.js";
import { OrderAddCommentOutputSchema } from "../../src/tools/orders/order-add-comment/schemas.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

const toolArguments = {
  order_id: 7,
  comment: "Private note",
  idempotency_key: "4f8ae949-6e10-4ea1-865d-32ea06b72d3f",
};

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly fetchCalls: { url: string; init: RequestInit }[];
  readonly audits: AuditInput[];
  readonly elicitations: unknown[];
}

const harnesses: Harness[] = [];

async function createHarness(
  options: {
    action?: "accept" | "decline" | "cancel";
    confirm?: boolean;
    elicitation?: boolean;
    fetch?: MagentoFetch;
    audit?: AuditWriter["write"];
    approval?: WriteApprovalPolicy;
  } = {},
): Promise<Harness> {
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const fetchImplementation: MagentoFetch = (input, init) => {
    fetchCalls.push({ url: String(input), init });
    if (options.fetch !== undefined) return options.fetch(input, init);
    return Promise.resolve(
      new Response(JSON.stringify(true), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const magento = new MagentoClient({
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
  const audits: AuditInput[] = [];
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return options.audit?.(input) ?? Promise.resolve();
    },
  };
  const approval = options.approval ?? createWriteApprovalPolicy(new Uint8Array(32).fill(7));
  const server = new McpServer(
    { name: "order-add-comment-test-server", version: "0.1.0" },
    { requestState: { verify: approval.verify } },
  );
  registerTools(createRateLimitedRegisterTool(server, createToolCallLimiter()), {
    client: magento,
    audit,
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(8),
  });

  const client = new Client(
    { name: "order-add-comment-test-client", version: "0.1.0" },
    {
      capabilities: options.elicitation === false ? {} : { elicitation: { form: {} } },
    },
  );
  const elicitations: unknown[] = [];
  if (options.elicitation !== false) {
    client.setRequestHandler("elicitation/create", (request) => {
      elicitations.push(request.params);
      return Promise.resolve({
        action: options.action ?? "accept",
        content: { confirm: options.confirm ?? true },
      });
    });
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const harness = { client, server, fetchCalls, audits, elicitations };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.client.close();
    await harness.server.close();
  }
});

describe("order_add_comment public MCP flow", () => {
  it("elicits approval, performs one POST, and replays without Magento traffic", async () => {
    const harness = await createHarness();
    const first = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });

    expect(OrderAddCommentOutputSchema.safeParse(first.structuredContent).success).toBe(true);
    expect(first.structuredContent).toMatchObject({
      ok: true,
      data: { order_id: 7, comment_added: true },
    });
    expect(JSON.stringify(first)).not.toContain("Private note");
    expect(JSON.stringify(first)).not.toContain(toolArguments.idempotency_key);
    expect(harness.elicitations).toHaveLength(1);
    expect(harness.elicitations[0]).toMatchObject({
      mode: "form",
      message:
        "Add a private comment to Magento order 7? The customer will not be notified, and the comment will not be visible on the storefront.",
      requestedSchema: {
        type: "object",
        properties: { confirm: { type: "boolean", title: "Confirm operation" } },
        required: ["confirm"],
      },
    });
    expect(JSON.stringify(harness.elicitations)).not.toContain("Private note");
    expect(harness.fetchCalls.map(({ init }) => init.method)).toEqual(["POST"]);
    expect(harness.fetchCalls.map(({ url }) => url)).toEqual([
      "https://shop.example/rest/default/V1/orders/7/comments",
    ]);
    expect(harness.audits).toHaveLength(1);
    expect(harness.audits[0]).toMatchObject({
      tool: "order_add_comment",
      order_id: 7,
      outcome: "success",
      attempt_count: 1,
      replayed: false,
    });

    const replay = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect(harness.elicitations).toHaveLength(1);
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.audits[1]).toMatchObject({
      outcome: "success",
      attempt_count: 0,
      replayed: true,
    });

    const conflict = await harness.client.callTool({
      name: "order_add_comment",
      arguments: { ...toolArguments, comment: "Different note" },
    });
    expect(conflict.structuredContent).toMatchObject({
      ok: false,
      error: { code: "IDEMPOTENCY_CONFLICT", retryable: false },
    });
    expect(harness.elicitations).toHaveLength(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it("audits a replay discovered during reservation after concurrent approvals", async () => {
    const firstApproval = Promise.withResolvers<{ readonly approved: true }>();
    const secondApproval = Promise.withResolvers<{ readonly approved: true }>();
    const bothApprovalsRequested = Promise.withResolvers<true>();
    let approvalIndex = 0;
    const approval: WriteApprovalPolicy = {
      verify() {
        return Promise.reject(new Error("request state verification is not expected"));
      },
      requireApproval() {
        const currentIndex = approvalIndex++;
        if (currentIndex === 1) bothApprovalsRequested.resolve(true);
        return currentIndex === 0 ? firstApproval.promise : secondApproval.promise;
      },
    };
    const harness = await createHarness({ approval });

    const firstCall = harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    const secondCall = harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    await bothApprovalsRequested.promise;

    firstApproval.resolve({ approved: true });
    const first = await firstCall;
    secondApproval.resolve({ approved: true });
    const second = await secondCall;

    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.audits).toHaveLength(2);
    expect(harness.audits[0]).toMatchObject({ attempt_count: 1, replayed: false });
    expect(harness.audits[1]).toMatchObject({ attempt_count: 0, replayed: true });
  });

  it.each([
    { action: "decline", confirm: true },
    { action: "cancel", confirm: true },
    { action: "accept", confirm: false },
  ] as const)("returns a structured decline without calling Magento: %j", async (options) => {
    const harness = await createHarness(options);
    const response = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECLINED", retryable: false },
    });
    expect(harness.fetchCalls).toHaveLength(0);
    expect(harness.audits[0]).toMatchObject({ outcome: "failure", attempt_count: 0 });
  });

  it("fails closed when the client does not advertise elicitation", async () => {
    const harness = await createHarness({ elicitation: false });

    const response = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response)).toContain("did not declare the required capability");
    expect(harness.fetchCalls).toHaveLength(0);
    expect(harness.audits).toHaveLength(0);
  });
});

it.each([200, 500])(
  "keeps write outcome and same-key protection after HTTP %i plus audit failure",
  async (status) => {
    let auditFails = true;
    const harness = await createHarness({
      audit: () =>
        auditFails ? Promise.reject(new Error("private audit diagnostic")) : Promise.resolve(),
      fetch: () => Promise.resolve(new Response(JSON.stringify(true), { status })),
    });
    const first = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(first.isError).toBe(true);
    expect(first.structuredContent).toMatchObject({
      ok: false,
      error: {
        code: status === 200 ? ERROR_CODE.INTERNAL_ERROR : ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN,
        message: expect.stringContaining(
          status === 200 ? "Magento confirmed the write" : "Magento may have completed",
        ),
        retryable: false,
      },
    });
    expect(JSON.stringify(first)).toContain("new idempotency key");
    expect(JSON.stringify(first)).toMatch(/audit recording failed|Audit recording also failed/);
    expect(JSON.stringify(first)).not.toContain("private audit diagnostic");
    expect(first.content).toEqual([
      { type: "text", text: JSON.stringify(first.structuredContent) },
    ]);
    expect(harness.fetchCalls.map(({ init }) => init.method)).toEqual(["POST"]);

    auditFails = false;
    const repeated = await harness.client.callTool({
      name: "order_add_comment",
      arguments: toolArguments,
    });
    expect(repeated.structuredContent).toMatchObject(
      status === 200
        ? {
            ok: true,
            data: { comment_added: true },
          }
        : {
            ok: false,
            error: {
              code: WRITE_ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
              message: expect.stringContaining("ongoing or unresolved operation"),
            },
          },
    );
    if (status === 500) {
      expect(JSON.stringify(repeated)).toContain("Reconcile the Magento state");
      expect(JSON.stringify(repeated)).toContain("Do not retry with a new idempotency key");
    }
    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.elicitations).toHaveLength(1);
  },
);
