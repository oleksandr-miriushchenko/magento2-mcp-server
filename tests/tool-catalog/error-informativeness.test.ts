import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AUDIT_TOOL, type AuditInput } from "../../src/core/audit.js";
import {
  createPolicyError,
  ERROR_CODE,
  POLICY_ERROR_REASON,
  type PolicyErrorReason,
} from "../../src/core/errors.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient } from "../../src/magento/client.js";
import { registerTools } from "../../src/tools/index.js";
import { createRateLimitedRegisterTool } from "../../src/tools/rate-limited-registration.js";
import { WRITE_ERROR_CODE } from "../../src/tools/shared/error-codes.js";
import { createToolFailureSchema } from "../../src/tools/shared/result-schemas.js";

const key = "00000000-0000-4000-8000-000000000001";
const orderWrite = { order_id: 1, idempotency_key: key };
const INPUTS: Readonly<Record<string, Record<string, unknown>>> = {
  [AUDIT_TOOL.ORDER_GET]: { order_id: 1 },
  [AUDIT_TOOL.ORDER_SEARCH]: { status: "processing" },
  [AUDIT_TOOL.ORDER_TRACKING_GET]: { order_id: 1 },
  [AUDIT_TOOL.INVOICE_SEARCH]: { order_id: 1 },
  [AUDIT_TOOL.INVOICE_GET]: { invoice_id: 1 },
  [AUDIT_TOOL.SHIPMENT_SEARCH]: { order_id: 1 },
  [AUDIT_TOOL.SHIPMENT_GET]: { shipment_id: 1 },
  [AUDIT_TOOL.CREDIT_MEMO_SEARCH]: { order_id: 1 },
  [AUDIT_TOOL.CREDIT_MEMO_GET]: { credit_memo_id: 1 },
  [AUDIT_TOOL.CUSTOMER_SEARCH]: {},
  [AUDIT_TOOL.CUSTOMER_GET]: { customer_id: 1 },
  [AUDIT_TOOL.CUSTOMER_GROUP_SEARCH]: {},
  [AUDIT_TOOL.PRODUCT_SEARCH]: {},
  [AUDIT_TOOL.PRODUCT_GET]: { sku: "a" },
  [AUDIT_TOOL.PRODUCT_ATTRIBUTE_SEARCH]: {},
  [AUDIT_TOOL.PRODUCT_ATTRIBUTE_GET]: { attribute_code: "a" },
  [AUDIT_TOOL.CATEGORY_TREE_GET]: {},
  [AUDIT_TOOL.INVENTORY_GET]: { sku: "a", stock_id: 1 },
  [AUDIT_TOOL.INVENTORY_SOURCE_SEARCH]: {},
  [AUDIT_TOOL.INVENTORY_STOCK_SEARCH]: {},
  [AUDIT_TOOL.QUOTE_SEARCH]: {},
  [AUDIT_TOOL.CMS_PAGE_SEARCH]: {},
  [AUDIT_TOOL.CMS_PAGE_GET]: { page_id: 1 },
  [AUDIT_TOOL.SALES_RULE_SEARCH]: {},
  [AUDIT_TOOL.SALES_RULE_GET]: { rule_id: 1 },
  [AUDIT_TOOL.COUPON_SEARCH]: { rule_id: 1 },
  [AUDIT_TOOL.ORDER_ANALYTICS_GET]: { created_from: "2026-09-01", created_to: "2026-09-01" },
  [AUDIT_TOOL.STORE_HIERARCHY_GET]: {},
  [AUDIT_TOOL.ORDER_ADD_COMMENT]: { ...orderWrite, comment: "a" },
  [AUDIT_TOOL.ORDER_CANCEL]: orderWrite,
  [AUDIT_TOOL.ORDER_HOLD]: orderWrite,
  [AUDIT_TOOL.ORDER_UNHOLD]: orderWrite,
  [AUDIT_TOOL.ORDER_EMAIL_SEND]: orderWrite,
  [AUDIT_TOOL.INVOICE_CREATE]: orderWrite,
  [AUDIT_TOOL.SHIPMENT_CREATE]: orderWrite,
  [AUDIT_TOOL.PRODUCT_UPDATE]: { sku: "a", price: 1, idempotency_key: key },
  [AUDIT_TOOL.INVENTORY_UPDATE]: {
    source_items: [{ sku: "a", source_code: "a", quantity: 1, status: "in_stock" }],
    idempotency_key: key,
  },
  [AUDIT_TOOL.CMS_PAGE_UPDATE]: { page_id: 1, title: "a", idempotency_key: key },
  [AUDIT_TOOL.COUPON_GENERATE]: { rule_id: 1, quantity: 1, idempotency_key: key },
};
const FailureSchema = createToolFailureSchema(z.enum(WRITE_ERROR_CODE));

async function harness(
  options: {
    status?: number;
    auditFails?: boolean;
    response?: unknown;
    policyReason?: PolicyErrorReason;
  } = {},
) {
  const audits: AuditInput[] = [];
  let attempts = 0;
  const nativeApproval = createWriteApprovalPolicy(new Uint8Array(32).fill(1));
  const policyReason = options.policyReason;
  const approval =
    policyReason === undefined
      ? nativeApproval
      : {
          ...nativeApproval,
          requireApproval() {
            throw createPolicyError(policyReason);
          },
        };
  const server = new McpServer(
    { name: "error-contract-test", version: "0.1.0" },
    {
      requestState: { verify: approval.verify },
    },
  );
  const unlimitedToolCalls = {
    tryAcquire: () => true,
    release: vi.fn(),
  };
  registerTools(createRateLimitedRegisterTool(server, unlimitedToolCalls), {
    client: new MagentoClient({
      baseUrl: "https://shop.example/",
      storeScope: "default",
      oauth: { consumerKey: "a", consumerSecret: "a", accessToken: "a", accessTokenSecret: "a" },
      timeoutMs: 1000,
      fetch: () => {
        attempts += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify(
              options.response ?? {
                message: "Email %1 already exists; quantity 12 exceeds 10.",
                parameters: ["alice@example.com"],
                trace: "private trace",
              },
            ),
            { status: options.status ?? 400 },
          ),
        );
      },
    }),
    audit: {
      write(input) {
        audits.push(input);
        return options.auditFails
          ? Promise.reject(new Error("private audit detail"))
          : Promise.resolve();
      },
    },
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 1,
    cursorKey: new Uint8Array(32).fill(2),
  });
  const client = new Client(
    { name: "error-contract-client", version: "0.1.0" },
    {
      capabilities: { elicitation: { form: {} } },
    },
  );
  client.setRequestHandler("elicitation/create", () =>
    Promise.resolve({ action: "accept", content: { confirm: true } }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const listed = await client.listTools();
  expect(listed.tools).toHaveLength(39);
  expect(listed.tools.map(({ name }) => name).sort()).toEqual(Object.keys(INPUTS).sort());
  return {
    audits,
    attempts: () => attempts,
    tools: listed.tools,
    async call(name: string) {
      const result = await client.callTool({ name, arguments: INPUTS[name] });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(result.structuredContent) },
      ]);
      const parsed = FailureSchema.safeParse(result.structuredContent);
      if (!parsed.success) throw new Error("Expected a structured failure");
      return parsed.data.error;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

it.each([400, 404])("keeps HTTP %i reasons in all 39 tools", async (status) => {
  const value = await harness({ status });
  try {
    for (const { name } of value.tools) {
      expect(await value.call(name)).toMatchObject({
        code: status === 400 ? ERROR_CODE.UPSTREAM_REJECTED : ERROR_CODE.NOT_FOUND,
        message: expect.stringContaining(
          "Email alice@example.com already exists; quantity 12 exceeds 10.",
        ),
        retryable: false,
      });
    }
    expect(value.attempts()).toBe(
      value.audits.reduce((sum, audit) => sum + audit.attempt_count, 0),
    );
    expect(JSON.stringify(value.audits)).not.toMatch(/alice|example.com|already exists|trace/);
  } finally {
    await value.close();
  }
});

it("preserves the original error with an explicit audit failure in all 39 tools", async () => {
  const value = await harness({ auditFails: true });
  try {
    for (const { name } of value.tools) {
      const error = await value.call(name);
      expect(error.code).toBe(ERROR_CODE.UPSTREAM_REJECTED);
      expect(error.message).toContain("Email alice@example.com already exists");
      expect(error.message).toContain("Audit recording also failed");
      expect(error.message).not.toContain("private");
      expect(error.retryable).toBe(false);
    }
  } finally {
    await value.close();
  }
});

it.each([
  POLICY_ERROR_REASON.INVALID_APPROVAL_STATE,
  POLICY_ERROR_REASON.INVALID_APPROVAL_RESPONSE,
  POLICY_ERROR_REASON.IDEMPOTENCY_CAPACITY,
  POLICY_ERROR_REASON.IDEMPOTENCY_RESERVATION,
  POLICY_ERROR_REASON.IDEMPOTENCY_PENDING,
])("preserves the known policy reason %s in all 11 writes", async (policyReason) => {
  const value = await harness({ policyReason });
  try {
    const writes = value.tools.filter(({ annotations }) => !annotations?.readOnlyHint);
    expect(writes).toHaveLength(11);
    for (const { name } of writes) {
      const error = await value.call(name);
      expect(error.message).toBe(createPolicyError(policyReason).message);
      expect(error.code).toBe(
        policyReason === POLICY_ERROR_REASON.IDEMPOTENCY_PENDING
          ? WRITE_ERROR_CODE.IDEMPOTENCY_IN_PROGRESS
          : ERROR_CODE.INTERNAL_ERROR,
      );
      expect(error.retryable).toBe(false);
    }
    expect(value.attempts()).toBe(0);
  } finally {
    await value.close();
  }
});

it("withholds read data and explains audit failure after a successful read", async () => {
  const value = await harness({
    status: 200,
    auditFails: true,
    response: { items: [], total_count: 0 },
  });
  try {
    expect(await value.call(AUDIT_TOOL.CUSTOMER_GROUP_SEARCH)).toEqual({
      code: ERROR_CODE.INTERNAL_ERROR,
      message:
        "The read completed, but audit recording failed. Restore auditing before another operation.",
      retryable: false,
    });
  } finally {
    await value.close();
  }
});
