import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { createAppError, ERROR_CODE } from "../../src/core/errors.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { registerCmsPageUpdate } from "../../src/tools/cms/cms-page-update/register.js";
import {
  CmsPageUpdateInputSchema,
  CmsPageUpdateOutputSchema,
} from "../../src/tools/cms/cms-page-update/schemas.js";
import { createCmsPageUpdateWorkflow } from "../../src/tools/cms/cms-page-update/workflow.js";
import type { ToolDependencies } from "../../src/tools/dependencies.js";
import { registerCouponGenerate } from "../../src/tools/promotions/coupon-generate/register.js";
import {
  CouponGenerateInputSchema,
  CouponGenerateOutputSchema,
} from "../../src/tools/promotions/coupon-generate/schemas.js";
import { createCouponGenerateWorkflow } from "../../src/tools/promotions/coupon-generate/workflow.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

const CMS_KEY = "4f8ae949-6e10-4ea1-865d-32ea06b72d3f";
const COUPON_KEY = "8ca8def3-0541-42c6-8af2-e2318f234bcd";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly calls: { url: string; init: RequestInit }[];
  readonly audits: AuditInput[];
  readonly elicitations: unknown[];
}

const harnesses: Harness[] = [];

async function createHarness(fetchOverride?: MagentoFetch): Promise<Harness> {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImplementation: MagentoFetch = (input, init) => {
    calls.push({ url: String(input), init });
    if (fetchOverride !== undefined) return fetchOverride(input, init);
    if (init.method === "PUT") return Promise.resolve(jsonResponse({ id: 3 }));
    return Promise.resolve(jsonResponse(["VIP-A1", "VIP-B2"]));
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
    timeoutMs: 1_000,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000,
    nonce: () => "commerce-write-test-nonce",
  });
  const audits: AuditInput[] = [];
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return Promise.resolve();
    },
  };
  const approval = createWriteApprovalPolicy(new Uint8Array(32).fill(4));
  const dependencies: ToolDependencies = {
    client: magento,
    audit,
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(5),
  };
  const server = new McpServer(
    { name: "commerce-write-test", version: "0.1.0" },
    { requestState: { verify: approval.verify } },
  );
  const registerTool = createRateLimitedRegisterTool(server, createToolCallLimiter());
  registerCmsPageUpdate(registerTool, dependencies);
  registerCouponGenerate(registerTool, dependencies);
  const client = new Client(
    { name: "commerce-write-client", version: "0.1.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const elicitations: unknown[] = [];
  client.setRequestHandler("elicitation/create", (request) => {
    elicitations.push(request.params);
    return Promise.resolve({ action: "accept", content: { confirm: true } });
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const value = { client, server, calls, audits, elicitations };
  harnesses.push(value);
  return value;
}

afterEach(async () => {
  for (const value of harnesses.splice(0)) {
    await value.client.close();
    await value.server.close();
  }
});

describe("commerce write schemas and workflows", () => {
  it("rejects unbounded or arbitrary CMS and coupon inputs", () => {
    expect(
      CmsPageUpdateInputSchema.safeParse({ page_id: 3, idempotency_key: CMS_KEY }).success,
    ).toBe(false);
    expect(
      CmsPageUpdateInputSchema.safeParse({
        page_id: 3,
        content: "new",
        arbitrary_field: true,
        idempotency_key: CMS_KEY,
      }).success,
    ).toBe(false);
    expect(
      CouponGenerateInputSchema.safeParse({
        rule_id: 9,
        quantity: 101,
        idempotency_key: COUPON_KEY,
      }).success,
    ).toBe(false);
    expect(
      CouponGenerateInputSchema.safeParse({
        rule_id: 9,
        quantity: 1,
        delimiter: "-",
        idempotency_key: COUPON_KEY,
      }).success,
    ).toBe(false);
    expect(
      CouponGenerateInputSchema.safeParse({
        rule_id: 9,
        quantity: 1,
        length: 64,
        prefix: "P".repeat(32),
        suffix: "S".repeat(32),
        delimiter_at_every: 1,
        delimiter: "----",
        idempotency_key: COUPON_KEY,
      }).success,
    ).toBe(false);
  });

  it("performs one CMS update and replays without I/O", async () => {
    const cms = {
      updatePage: vi.fn(() => Promise.resolve()),
    };
    const registry = new InMemoryIdempotencyRegistry();
    const workflow = createCmsPageUpdateWorkflow(cms, registry.forTool("cms_page_update"));
    const input = CmsPageUpdateInputSchema.parse({
      page_id: 3,
      content: "<p>New policy</p>",
      meta_description: null,
      idempotency_key: CMS_KEY,
    });
    const signal = new AbortController().signal;
    await expect(workflow.execute(input, signal)).resolves.toMatchObject({
      ok: true,
      data: { page_id: 3, updated: true },
    });
    expect(cms.updatePage).toHaveBeenCalledWith(
      3,
      {
        content: "<p>New policy</p>",
        metaDescription: null,
      },
      signal,
      undefined,
    );
    cms.updatePage.mockClear();
    expect(workflow.lookup(input)).toMatchObject({ ok: true });
    expect(cms.updatePage).not.toHaveBeenCalled();
  });

  it("generates the requested coupons in one mutation", async () => {
    const promotions = {
      generateCoupons: vi.fn(() => Promise.resolve(["VIP-A1", "VIP-B2"])),
    };
    const registry = new InMemoryIdempotencyRegistry();
    const workflow = createCouponGenerateWorkflow(promotions, registry.forTool("coupon_generate"));
    const input = CouponGenerateInputSchema.parse({
      rule_id: 9,
      quantity: 2,
      prefix: "VIP-",
      idempotency_key: COUPON_KEY,
    });
    await expect(workflow.execute(input, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      data: { rule_id: 9, quantity: 2, coupons: ["VIP-A1", "VIP-B2"] },
    });
    expect(promotions.generateCoupons).toHaveBeenCalledOnce();
  });

  it("keeps ambiguous CMS writes pending and releases definite coupon rejections", async () => {
    const cms = {
      updatePage: vi.fn(() => Promise.reject(createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN))),
    };
    const cmsRegistry = new InMemoryIdempotencyRegistry();
    const cmsWorkflow = createCmsPageUpdateWorkflow(cms, cmsRegistry.forTool("cms_page_update"));
    const cmsInput = CmsPageUpdateInputSchema.parse({
      page_id: 3,
      active: false,
      idempotency_key: CMS_KEY,
    });
    await expect(cmsWorkflow.execute(cmsInput, new AbortController().signal)).rejects.toMatchObject(
      { code: "UPSTREAM_OUTCOME_UNKNOWN" },
    );
    expect(() => cmsWorkflow.lookup(cmsInput)).toThrow("ongoing or unresolved operation");

    const promotions = {
      generateCoupons: vi.fn(() => Promise.reject(createAppError(ERROR_CODE.UPSTREAM_REJECTED))),
    };
    const couponRegistry = new InMemoryIdempotencyRegistry();
    const couponWorkflow = createCouponGenerateWorkflow(
      promotions,
      couponRegistry.forTool("coupon_generate"),
    );
    const couponInput = CouponGenerateInputSchema.parse({
      rule_id: 9,
      quantity: 1,
      idempotency_key: COUPON_KEY,
    });
    await expect(
      couponWorkflow.execute(couponInput, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });
    expect(promotions.generateCoupons).toHaveBeenCalledOnce();
    expect(couponWorkflow.lookup(couponInput)).toBeUndefined();
  });
});

describe("commerce write MCP boundary", () => {
  it("advertises safe annotations and executes one fixed request per write", async () => {
    const value = await createHarness();
    const listed = await value.client.listTools();
    expect(listed.tools.find(({ name }) => name === "cms_page_update")?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(listed.tools.find(({ name }) => name === "coupon_generate")?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });

    const cms = await value.client.callTool({
      name: "cms_page_update",
      arguments: {
        page_id: 3,
        content: "<p>New policy</p>",
        active: false,
        meta_description: null,
        idempotency_key: CMS_KEY,
      },
    });
    const coupon = await value.client.callTool({
      name: "coupon_generate",
      arguments: {
        rule_id: 9,
        quantity: 2,
        prefix: "VIP-",
        idempotency_key: COUPON_KEY,
      },
    });
    expect(CmsPageUpdateOutputSchema.safeParse(cms.structuredContent).success).toBe(true);
    expect(CouponGenerateOutputSchema.safeParse(coupon.structuredContent).success).toBe(true);
    expect(cms.content[0]).toEqual({ type: "text", text: JSON.stringify(cms.structuredContent) });
    expect(coupon.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(coupon.structuredContent),
    });
    expect(value.calls.map(({ init }) => init.method)).toEqual(["PUT", "POST"]);
    expect(value.calls.map(({ url }) => new URL(url).pathname)).toEqual([
      "/rest/default/V1/cmsPage/3",
      "/rest/default/V1/coupons/generate",
    ]);
    const cmsBody = value.calls[0]?.init.body;
    const couponBody = value.calls[1]?.init.body;
    if (typeof cmsBody !== "string" || typeof couponBody !== "string") {
      throw new Error("expected JSON request bodies");
    }
    expect(JSON.parse(cmsBody)).toEqual({
      page: {
        id: 3,
        content: "<p>New policy</p>",
        active: false,
        meta_description: null,
      },
    });
    expect(JSON.parse(couponBody)).toEqual({
      couponSpec: {
        rule_id: 9,
        quantity: 2,
        length: 12,
        format: "alphanum",
        prefix: "VIP-",
      },
    });
    expect(JSON.stringify(value.elicitations)).toContain("New policy");
    expect(JSON.stringify(value.audits)).not.toContain("New policy");
    expect(JSON.stringify(value.audits)).not.toContain(CMS_KEY);
    expect(JSON.stringify(value.audits)).not.toContain("VIP-A1");
  });

  it("replays completed writes without approval or Magento traffic", async () => {
    const value = await createHarness();
    const request = {
      name: "coupon_generate",
      arguments: {
        rule_id: 9,
        quantity: 2,
        idempotency_key: COUPON_KEY,
      },
    };
    const first = await value.client.callTool(request);
    const second = await value.client.callTool(request);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(value.elicitations).toHaveLength(1);
    expect(value.calls).toHaveLength(1);
    expect(value.audits).toHaveLength(2);
    expect(value.audits[1]).toMatchObject({ attempt_count: 0, outcome: "success" });
  });
});
