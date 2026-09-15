import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { registerAnalyticsTools } from "../../src/tools/analytics/index.js";
import { OrderAnalyticsGetOutputSchema } from "../../src/tools/analytics/schemas.js";
import { registerCmsTools } from "../../src/tools/cms/index.js";
import { CmsPageGetOutputSchema, CmsPageSearchOutputSchema } from "../../src/tools/cms/schemas.js";
import type { ToolDependencies } from "../../src/tools/dependencies.js";
import { registerPromotionTools } from "../../src/tools/promotions/index.js";
import {
  CouponSearchOutputSchema,
  SalesRuleGetOutputSchema,
  SalesRuleSearchOutputSchema,
} from "../../src/tools/promotions/schemas.js";
import { registerQuoteTools } from "../../src/tools/quotes/index.js";
import { QuoteSearchOutputSchema } from "../../src/tools/quotes/schemas.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";
import { registerStoreTools } from "../../src/tools/store/index.js";
import { StoreHierarchyGetOutputSchema } from "../../src/tools/store/schemas.js";

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
    nonce: () => "commerce-read-test-nonce",
  });
}

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly audits: AuditInput[];
}

const harnesses: Harness[] = [];

async function harness(fetchImplementation: MagentoFetch): Promise<Harness> {
  const audits: AuditInput[] = [];
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return Promise.resolve();
    },
  };
  const dependencies = {
    client: client(fetchImplementation),
    audit,
    approval: createWriteApprovalPolicy(new Uint8Array(32).fill(6)),
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: 25,
    cursorKey: new Uint8Array(32).fill(7),
  } satisfies ToolDependencies;
  const server = new McpServer({ name: "commerce-read-test", version: "0.1.0" });
  const registerTool = createRateLimitedRegisterTool(server, createToolCallLimiter());
  registerQuoteTools(registerTool, dependencies);
  registerCmsTools(registerTool, dependencies);
  registerPromotionTools(registerTool, dependencies);
  registerAnalyticsTools(registerTool, dependencies);
  registerStoreTools(registerTool, dependencies);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcpClient = new Client({ name: "commerce-read-client", version: "0.1.0" });
  await mcpClient.connect(clientTransport);
  const value = { client: mcpClient, server, audits };
  harnesses.push(value);
  return value;
}

afterEach(async () => {
  for (const value of harnesses.splice(0)) {
    await value.client.close();
    await value.server.close();
  }
});

function expectJsonMirror(result: Awaited<ReturnType<Client["callTool"]>>): void {
  expect(result.content).toHaveLength(1);
  expect(result.content[0]).toEqual({
    type: "text",
    text: JSON.stringify(result.structuredContent),
  });
}

describe("commerce read tool contracts", () => {
  it("registers eight read and two write tools and marks the reads as read-only", async () => {
    const value = await harness(() => Promise.resolve(jsonResponse([])));
    const listed = await value.client.listTools();
    expect(listed.tools.map(({ name }) => name).sort()).toEqual([
      "cms_page_get",
      "cms_page_search",
      "cms_page_update",
      "coupon_generate",
      "coupon_search",
      "order_analytics_get",
      "quote_search",
      "sales_rule_get",
      "sales_rule_search",
      "store_hierarchy_get",
    ]);
    for (const tool of listed.tools.filter(
      ({ name }) => !name.endsWith("_update") && name !== "coupon_generate",
    )) {
      expect(tool.annotations).toEqual({ readOnlyHint: true });
    }
  });

  it("searches quotes on the fixed endpoint and returns customer PII outside audit", async () => {
    let requestedUrl: URL | undefined;
    const value = await harness((input) => {
      requestedUrl = new URL(String(input));
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: 4,
              store_id: 1,
              created_at: "2026-09-01 10:00:00",
              updated_at: "2026-09-02 10:00:00",
              is_active: true,
              is_virtual: false,
              items_count: 2,
              items_qty: 3,
              customer: { firstname: "Jane", lastname: "Doe", email: "jane@example.com" },
              currency: { quote_currency_code: "USD" },
            },
          ],
          total_count: 1,
        }),
      );
    });
    const result = await value.client.callTool({ name: "quote_search", arguments: {} });
    const parsed = QuoteSearchOutputSchema.safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) throw new Error("expected quote search success");
    expect(requestedUrl?.pathname).toBe("/rest/default/V1/carts/search");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][0][filters][0][field]"),
    ).toBe("is_active");
    expect(requestedUrl?.searchParams.get("fields")).not.toContain("billing_address");
    expect(parsed.data.data.quotes[0]?.customer).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    });
    expectJsonMirror(result);
    expect(JSON.stringify(value.audits)).not.toContain("example.com");
  });

  it("uses the fixed CMS endpoints and excludes content from search results", async () => {
    const paths: string[] = [];
    const value = await harness((input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      const page = {
        id: 3,
        identifier: "returns",
        title: null,
        active: null,
        creation_time: null,
        update_time: null,
        sort_order: "1",
      };
      return Promise.resolve(
        jsonResponse(
          url.pathname.endsWith("/search")
            ? { items: [{ ...page, content: "must be stripped" }], total_count: 1 }
            : {
                ...page,
                page_layout: "1column",
                meta_title: null,
                meta_keywords: null,
                meta_description: "Return policy",
                content_heading: "Returns",
                content: null,
                layout_update_xml: "must be stripped",
              },
        ),
      );
    });
    const search = await value.client.callTool({
      name: "cms_page_search",
      arguments: { identifier: "returns" },
    });
    const get = await value.client.callTool({ name: "cms_page_get", arguments: { page_id: 3 } });
    expect(CmsPageSearchOutputSchema.safeParse(search.structuredContent).success).toBe(true);
    expect(CmsPageGetOutputSchema.safeParse(get.structuredContent).success).toBe(true);
    expect(search.structuredContent).toMatchObject({
      ok: true,
      data: {
        pages: [
          {
            title: null,
            is_active: null,
            created_at: null,
            updated_at: null,
            sort_order: 1,
          },
        ],
      },
    });
    expect(get.structuredContent).toMatchObject({ ok: true, data: { content: null } });
    expect(JSON.stringify(search.structuredContent)).not.toContain("must be stripped");
    expect(JSON.stringify(get.structuredContent)).not.toContain("layout_update_xml");
    expect(paths).toEqual(["/rest/default/V1/cmsPage/search", "/rest/default/V1/cmsPage/3"]);
  });

  it("reads sales rules and coupons only through core repository endpoints", async () => {
    const paths: string[] = [];
    const rule = {
      rule_id: 9,
      name: "VIP",
      description: null,
      is_active: true,
      from_date: null,
      to_date: null,
      sort_order: 1,
      simple_action: "by_percent",
      discount_amount: 10,
      coupon_type: "SPECIFIC_COUPON",
      times_used: 2,
    };
    const value = await harness((input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/salesRules/search"))
        return Promise.resolve(jsonResponse({ items: [rule], total_count: 1 }));
      if (url.pathname.endsWith("/salesRules/9"))
        return Promise.resolve(
          jsonResponse({
            ...rule,
            website_ids: [1],
            customer_group_ids: [1, 2],
            uses_per_customer: 1,
            uses_per_coupon: 10,
            stop_rules_processing: false,
            apply_to_shipping: false,
            use_auto_generation: true,
            discount_qty: null,
            discount_step: 0,
            simple_free_shipping: "0",
            condition: { private: true },
          }),
        );
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              coupon_id: 5,
              rule_id: 9,
              code: null,
              usage_limit: null,
              usage_per_customer: null,
              times_used: 2,
              expiration_date: null,
              is_primary: true,
              type: 1,
            },
          ],
          total_count: 1,
        }),
      );
    });
    const search = await value.client.callTool({
      name: "sales_rule_search",
      arguments: { active: true },
    });
    const get = await value.client.callTool({ name: "sales_rule_get", arguments: { rule_id: 9 } });
    const coupons = await value.client.callTool({
      name: "coupon_search",
      arguments: { rule_id: 9 },
    });
    expect(SalesRuleSearchOutputSchema.safeParse(search.structuredContent).success).toBe(true);
    expect(SalesRuleGetOutputSchema.safeParse(get.structuredContent).success).toBe(true);
    expect(CouponSearchOutputSchema.safeParse(coupons.structuredContent).success).toBe(true);
    expect(coupons.structuredContent).toMatchObject({
      ok: true,
      data: { coupons: [{ code: null, usage_limit: null, usage_per_customer: null }] },
    });
    expect(JSON.stringify(get.structuredContent)).not.toContain("condition");
    expect(paths).toEqual([
      "/rest/default/V1/salesRules/search",
      "/rest/default/V1/salesRules/9",
      "/rest/default/V1/coupons/search",
    ]);
  });

  it("bounds analytics and assembles the fixed three-endpoint store hierarchy", async () => {
    const paths: string[] = [];
    const value = await harness((input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/orders"))
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                entity_id: 1,
                created_at: "2026-09-01 10:00:00",
                order_currency_code: "USD",
                grand_total: 12,
                total_paid: 12,
                total_refunded: 2,
              },
              {
                entity_id: 2,
                created_at: "2026-09-01 11:00:00",
                order_currency_code: "USD",
                grand_total: 18,
                total_paid: 18,
                total_refunded: null,
              },
            ],
            total_count: 2,
          }),
        );
      if (url.pathname.endsWith("/websites"))
        return Promise.resolve(
          jsonResponse([{ id: 1, code: "base", name: "Main Website", default_group_id: 1 }]),
        );
      if (url.pathname.endsWith("/storeGroups"))
        return Promise.resolve(
          jsonResponse([
            { id: 1, website_id: 1, root_category_id: 2, default_store_id: 1, name: "Main Store" },
          ]),
        );
      return Promise.resolve(
        jsonResponse([
          {
            id: 1,
            code: "default",
            name: "Default Store View",
            website_id: 1,
            store_group_id: 1,
            is_active: true,
          },
        ]),
      );
    });
    const analytics = await value.client.callTool({
      name: "order_analytics_get",
      arguments: { created_from: "2026-09-01", created_to: "2026-09-02" },
    });
    const hierarchy = await value.client.callTool({ name: "store_hierarchy_get", arguments: {} });
    const parsedAnalytics = OrderAnalyticsGetOutputSchema.safeParse(analytics.structuredContent);
    expect(parsedAnalytics.success).toBe(true);
    if (!parsedAnalytics.success || !parsedAnalytics.data.ok)
      throw new Error("expected analytics success");
    expect(parsedAnalytics.data.data.currencies).toEqual([
      {
        currency_code: "USD",
        order_count: 2,
        gross_order_value: 30,
        paid_amount: 30,
        refunded_amount: 2,
        net_collected_amount: 28,
        average_order_value: 15,
      },
    ]);
    expect(StoreHierarchyGetOutputSchema.safeParse(hierarchy.structuredContent).success).toBe(true);
    expect(paths.sort()).toEqual(
      [
        "/rest/default/V1/orders",
        "/rest/default/V1/store/storeGroups",
        "/rest/default/V1/store/storeViews",
        "/rest/default/V1/store/websites",
      ].sort(),
    );
    expect(OrderAnalyticsGetOutputSchema.safeParse({}).success).toBe(false);
  });
});
