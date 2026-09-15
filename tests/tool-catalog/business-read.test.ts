import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import {
  AUDIT_OUTCOME,
  AUDIT_TOOL,
  type AuditInput,
  type AuditWriter,
} from "../../src/core/audit.js";
import { ERROR_CODE } from "../../src/core/errors.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { MagentoCustomers, MAGENTO_CUSTOMER_SORT } from "../../src/magento/customers.js";
import { MagentoInventory } from "../../src/magento/inventory.js";
import { MagentoProductDetails } from "../../src/magento/product-details.js";
import { registerCustomerTools } from "../../src/tools/customers/index.js";
import {
  CUSTOMER_GET_TOOL,
  CustomerGetOutputSchema,
} from "../../src/tools/customers/customer-get/schemas.js";
import { CustomerSearchOutputSchema } from "../../src/tools/customers/customer-search/schemas.js";
import { CustomerGroupSearchOutputSchema } from "../../src/tools/customers/customer-group-search/schemas.js";
import type { ToolDependencies } from "../../src/tools/dependencies.js";
import { registerInventoryGet } from "../../src/tools/inventory/inventory-get/register.js";
import { InventoryGetOutputSchema } from "../../src/tools/inventory/inventory-get/schemas.js";
import { InventorySourceSearchOutputSchema } from "../../src/tools/inventory/inventory-source-search/schemas.js";
import { registerInventorySourceSearch } from "../../src/tools/inventory/inventory-source-search/register.js";
import { InventoryStockSearchOutputSchema } from "../../src/tools/inventory/inventory-stock-search/schemas.js";
import { registerInventoryStockSearch } from "../../src/tools/inventory/inventory-stock-search/register.js";
import { registerCategoryTreeGet } from "../../src/tools/products/category-tree-get/register.js";
import {
  CategoryTreeGetInputSchema,
  CategoryTreeGetOutputSchema,
} from "../../src/tools/products/category-tree-get/schemas.js";
import { registerProductAttributeGet } from "../../src/tools/products/product-attribute-get/register.js";
import { ProductAttributeGetOutputSchema } from "../../src/tools/products/product-attribute-get/schemas.js";
import { registerProductAttributeSearch } from "../../src/tools/products/product-attribute-search/register.js";
import { ProductAttributeSearchOutputSchema } from "../../src/tools/products/product-attribute-search/schemas.js";
import { registerProductGet } from "../../src/tools/products/product-get/register.js";
import { ProductGetOutputSchema } from "../../src/tools/products/product-get/schemas.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

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
    nonce: () => "business-read-test-nonce",
  });
}

const rawCustomer = {
  id: 7,
  group_id: 1,
  store_id: 1,
  website_id: 1,
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-02 10:00:00",
  email: "jane@example.com",
  firstname: "Jane",
  lastname: "Doe",
};

const rawAttribute = {
  attribute_id: 93,
  attribute_code: "color",
  frontend_input: "select",
  default_frontend_label: "Color",
  is_required: false,
  is_unique: "0",
  is_user_defined: false,
  is_visible_on_front: "1",
  used_in_product_listing: "1",
  is_filterable: true,
  is_filterable_in_search: true,
  is_searchable: "0",
  is_comparable: "0",
  scope: "global",
};

describe("business read Magento boundaries", () => {
  it("defaults category tree requests to the maximum bounded depth", () => {
    expect(CategoryTreeGetInputSchema.safeParse({})).toMatchObject({
      success: true,
      data: { depth: 10 },
    });
  });

  it("uses fixed customer endpoints and sparse projections", async () => {
    const urls: URL[] = [];
    const customers = new MagentoCustomers(
      client((input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.pathname.endsWith("/customers/search")) {
          return Promise.resolve(jsonResponse({ items: [rawCustomer], total_count: 1 }));
        }
        if (url.pathname.endsWith("/customerGroups/search")) {
          return Promise.resolve(
            jsonResponse({ items: [{ id: 1, code: "General", tax_class_id: 3 }], total_count: 1 }),
          );
        }
        return Promise.resolve(jsonResponse({ ...rawCustomer, addresses: [] }));
      }),
    );
    const signal = new AbortController().signal;

    await customers.searchCustomers(
      {
        email: "jane@example.com",
        sort: MAGENTO_CUSTOMER_SORT.CREATED_DESCENDING,
        pageSize: 10,
        currentPage: 1,
      },
      signal,
    );
    await customers.getCustomer(7, signal);
    await customers.searchCustomerGroups(
      { sort: "id_ascending", pageSize: 10, currentPage: 1 },
      signal,
    );

    expect(urls.map((url) => url.pathname)).toEqual([
      "/rest/default/V1/customers/search",
      "/rest/default/V1/customers/7",
      "/rest/default/V1/customerGroups/search",
    ]);
    expect(urls[0]?.searchParams.get("fields")).toContain("email");
    expect(urls[0]?.searchParams.get("fields")).not.toContain("password");
    expect(urls[0]?.searchParams.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe(
      "email",
    );
    expect(urls[1]?.searchParams.get("fields")).not.toContain("taxvat");
  });

  it("uses fixed product, attribute, category, and inventory endpoints", async () => {
    const urls: URL[] = [];
    const transport = client((input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.includes("get-product-salable-quantity")) {
        return Promise.resolve(jsonResponse(12));
      }
      if (url.pathname.includes("is-product-salable")) return Promise.resolve(jsonResponse(true));
      if (url.pathname.endsWith("/products/SKU%2F1")) {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            sku: "SKU/1",
            name: "Product",
            attribute_set_id: 4,
            price: 10,
            status: 1,
            visibility: 4,
            type_id: "simple",
            created_at: "2026-09-01 10:00:00",
            updated_at: "2026-09-01 10:00:00",
          }),
        );
      }
      if (url.pathname.endsWith("/products/attributes/color")) {
        return Promise.resolve(jsonResponse({ ...rawAttribute, options: [] }));
      }
      if (url.pathname.endsWith("/products/attributes")) {
        return Promise.resolve(jsonResponse({ items: [rawAttribute], total_count: 1 }));
      }
      if (url.pathname.endsWith("/categories")) {
        return Promise.resolve(
          jsonResponse({
            id: 2,
            parent_id: 1,
            name: "Root",
            is_active: true,
            position: 1,
            level: 1,
            product_count: 0,
            children_data: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ items: [], total_count: 0 }));
    });
    const details = new MagentoProductDetails(transport);
    const inventory = new MagentoInventory(transport);
    const signal = new AbortController().signal;
    await details.getProduct("SKU/1", signal);
    const attributes = await details.searchProductAttributes(
      { pageSize: 10, currentPage: 1 },
      signal,
    );
    const attribute = await details.getProductAttribute("color", signal);
    await details.getCategoryTree(2, 3, signal);
    await inventory.getInventory("SKU/1", 2, new AbortController().signal);
    await inventory.searchInventorySources(
      { pageSize: 10, currentPage: 1 },
      new AbortController().signal,
    );
    await inventory.searchInventoryStocks(
      { pageSize: 10, currentPage: 1 },
      new AbortController().signal,
    );

    expect(attributes.items[0]).toMatchObject({
      is_unique: false,
      is_visible_on_front: true,
      used_in_product_listing: true,
      is_searchable: false,
      is_comparable: false,
    });
    expect(attribute).toMatchObject({
      is_unique: false,
      is_visible_on_front: true,
      used_in_product_listing: true,
      is_searchable: false,
      is_comparable: false,
    });

    expect(urls.map((url) => url.pathname)).toEqual(
      expect.arrayContaining([
        "/rest/default/V1/inventory/get-product-salable-quantity/SKU%2F1/2",
        "/rest/default/V1/inventory/is-product-salable/SKU%2F1/2",
        "/rest/default/V1/inventory/sources",
        "/rest/default/V1/inventory/stocks",
        "/rest/default/V1/products/SKU%2F1",
        "/rest/default/V1/products/attributes",
        "/rest/default/V1/products/attributes/color",
        "/rest/default/V1/categories",
      ]),
    );
    expect(
      urls.find((url) => url.pathname.endsWith("/products/SKU%2F1"))?.searchParams.get("fields"),
    ).not.toContain("custom_attributes");
    expect(
      urls.find((url) => url.pathname.endsWith("/categories"))?.searchParams.get("rootCategoryId"),
    ).toBe("2");
    expect(
      urls.find((url) => url.pathname.endsWith("/categories"))?.searchParams.get("depth"),
    ).toBe("3");
    expect(
      urls.find((url) => url.pathname.endsWith("/sources"))?.searchParams.get("fields"),
    ).not.toContain("email");
  });

  it("rejects malformed upstream data at every domain boundary", async () => {
    const broken = client(() => Promise.resolve(jsonResponse({ secret: "raw" })));
    const signal = new AbortController().signal;
    await expect(new MagentoCustomers(broken).getCustomer(1, signal)).rejects.toMatchObject({
      code: "UPSTREAM_INVALID_RESPONSE",
    });
    await expect(new MagentoProductDetails(broken).getProduct("SKU", signal)).rejects.toMatchObject(
      { code: "UPSTREAM_INVALID_RESPONSE" },
    );
    await expect(
      new MagentoInventory(broken).searchInventoryStocks({ pageSize: 1, currentPage: 1 }, signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });

  it.each([
    { scenario: "a non-array addresses value", addresses: "invalid" },
    { scenario: "an address with a non-positive ID", addresses: [{ id: 0 }] },
  ])("rejects $scenario", async ({ addresses }) => {
    const customers = new MagentoCustomers(
      client(() => Promise.resolve(jsonResponse({ ...rawCustomer, addresses }))),
    );

    await expect(customers.getCustomer(7, new AbortController().signal)).rejects.toMatchObject({
      code: ERROR_CODE.UPSTREAM_INVALID_RESPONSE,
    });
  });
});

interface Harness {
  readonly client: Client;
  readonly server: McpServer;
  readonly audits: AuditInput[];
}

const harnesses: Harness[] = [];

async function harness(fetchOverride?: MagentoFetch): Promise<Harness> {
  const audits: AuditInput[] = [];
  const fetchImplementation: MagentoFetch = (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/customers/search")) {
      return Promise.resolve(jsonResponse({ items: [rawCustomer], total_count: 1 }));
    }
    if (path.endsWith("/customers/7")) {
      return Promise.resolve(
        jsonResponse({
          ...rawCustomer,
          default_billing: "4",
          addresses: [
            {
              id: 4,
              firstname: "Jane",
              lastname: "Doe",
              company: "Acme Inc",
              street: ["1 Main Street"],
              city: "Paris",
              region: { region_code: "IDF", region: "Ile-de-France", region_id: 1 },
              postcode: "75001",
              country_id: "FR",
              telephone: "+33123456789",
              default_billing: true,
            },
          ],
        }),
      );
    }
    if (path.endsWith("/customerGroups/search")) {
      return Promise.resolve(
        jsonResponse({ items: [{ id: 1, code: "General", tax_class_id: 3 }], total_count: 1 }),
      );
    }
    if (path.endsWith("/products/SKU-1")) {
      return Promise.resolve(
        jsonResponse({
          id: 11,
          sku: "SKU-1",
          name: "Shoe",
          attribute_set_id: 4,
          price: 79,
          status: 1,
          visibility: 4,
          type_id: "simple",
          weight: 1,
          created_at: "2026-09-01 10:00:00",
          updated_at: "2026-09-02 10:00:00",
          extension_attributes: { category_links: [{ category_id: "3", position: -1 }] },
          custom_attributes: [{ attribute_code: "secret", value: "discarded" }],
        }),
      );
    }
    if (path.endsWith("/products/attributes/color")) {
      return Promise.resolve(
        jsonResponse({ ...rawAttribute, options: [{ label: "Blue", value: "50" }] }),
      );
    }
    if (path.endsWith("/products/attributes")) {
      return Promise.resolve(jsonResponse({ items: [rawAttribute], total_count: 1 }));
    }
    if (path.endsWith("/categories")) {
      return Promise.resolve(
        jsonResponse({
          id: 2,
          parent_id: 1,
          name: "Default Category",
          is_active: true,
          position: 1,
          level: 1,
          product_count: 1,
          children_data: [],
        }),
      );
    }
    if (path.includes("get-product-salable-quantity")) return Promise.resolve(jsonResponse(12));
    if (path.includes("is-product-salable")) return Promise.resolve(jsonResponse(true));
    if (path.endsWith("/inventory/sources")) {
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              source_code: "default",
              name: "Default Source",
              enabled: true,
              description: null,
              country_id: "US",
              email: "private@example.com",
            },
          ],
          total_count: 1,
        }),
      );
    }
    if (path.endsWith("/inventory/stocks")) {
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              stock_id: 1,
              name: "Default Stock",
              extension_attributes: {
                sales_channels: [{ type: "website", code: "base" }],
              },
            },
          ],
          total_count: 1,
        }),
      );
    }
    return Promise.resolve(jsonResponse({}, 404));
  };
  const audit: AuditWriter = {
    write(input) {
      audits.push(input);
      return Promise.resolve();
    },
  };
  const dependencies = {
    client: client(fetchOverride ?? fetchImplementation),
    audit,
    maxPageSize: 10,
    cursorKey: new Uint8Array(32).fill(4),
  } as ToolDependencies;
  const server = new McpServer({ name: "business-read-test", version: "0.1.0" });
  const registerTool = createRateLimitedRegisterTool(server, createToolCallLimiter());
  registerCustomerTools(registerTool, dependencies);
  registerProductGet(registerTool, dependencies);
  registerProductAttributeSearch(registerTool, dependencies);
  registerProductAttributeGet(registerTool, dependencies);
  registerCategoryTreeGet(registerTool, dependencies);
  registerInventoryGet(registerTool, dependencies);
  registerInventorySourceSearch(registerTool, dependencies);
  registerInventoryStockSearch(registerTool, dependencies);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcpClient = new Client({ name: "business-read-client", version: "0.1.0" });
  await mcpClient.connect(clientTransport);
  const value = { client: mcpClient, server, audits };
  harnesses.push(value);
  return value;
}

afterEach(async () => {
  for (const item of harnesses.splice(0)) {
    await item.client.close();
    await item.server.close();
  }
});

describe("business read MCP contracts", () => {
  it("sends the bounded default depth for an empty category tree request", async () => {
    let requestedUrl: URL | undefined;
    const { client: mcpClient } = await harness((input) => {
      requestedUrl = new URL(String(input));
      return Promise.resolve(
        jsonResponse({
          id: 2,
          parent_id: 1,
          name: "Default Category",
          is_active: true,
          position: 1,
          level: 1,
          product_count: 0,
          children_data: [],
        }),
      );
    });

    const result = await mcpClient.callTool({ name: "category_tree_get", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(requestedUrl?.searchParams.get("depth")).toBe("10");
  });

  it("returns no saved customer addresses for upstream null", async () => {
    const { client: mcpClient, audits } = await harness(() =>
      Promise.resolve(jsonResponse({ ...rawCustomer, addresses: null })),
    );

    const result = await mcpClient.callTool({
      name: CUSTOMER_GET_TOOL,
      arguments: { customer_id: 7 },
    });

    expect(CustomerGetOutputSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { customer_id: 7, addresses: [] },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent) },
    ]);
    expect(audits).toEqual([
      expect.objectContaining({
        tool: AUDIT_TOOL.CUSTOMER_GET,
        outcome: AUDIT_OUTCOME.SUCCESS,
        attempt_count: 1,
      }),
    ]);
  });

  it("lists all ten tools with read-only annotations and strict inputs", async () => {
    const { client: mcpClient } = await harness();
    const listed = await mcpClient.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "category_tree_get",
        "customer_get",
        "customer_group_search",
        "customer_search",
        "inventory_get",
        "inventory_source_search",
        "inventory_stock_search",
        "product_attribute_get",
        "product_attribute_search",
        "product_get",
      ].sort(),
    );
    for (const tool of listed.tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true });
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("returns schema-valid structured data and mirrors JSON for every tool", async () => {
    const { client: mcpClient, audits } = await harness();
    const calls = [
      ["customer_search", {}, CustomerSearchOutputSchema],
      ["customer_get", { customer_id: 7 }, CustomerGetOutputSchema],
      ["customer_group_search", {}, CustomerGroupSearchOutputSchema],
      ["product_get", { sku: "SKU-1" }, ProductGetOutputSchema],
      ["product_attribute_search", {}, ProductAttributeSearchOutputSchema],
      ["product_attribute_get", { attribute_code: "color" }, ProductAttributeGetOutputSchema],
      ["category_tree_get", { depth: 2 }, CategoryTreeGetOutputSchema],
      ["inventory_get", { sku: "SKU-1", stock_id: 1 }, InventoryGetOutputSchema],
      ["inventory_source_search", {}, InventorySourceSearchOutputSchema],
      ["inventory_stock_search", {}, InventoryStockSearchOutputSchema],
    ] as const;

    for (const [name, args, schema] of calls) {
      const result = await mcpClient.callTool({ name, arguments: args });
      expect(schema.safeParse(result.structuredContent).success, name).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(result.structuredContent) },
      ]);
      expect(result.isError).not.toBe(true);
    }

    expect(audits).toHaveLength(10);
    expect(JSON.stringify(audits)).not.toContain("jane@example.com");
    expect(JSON.stringify(audits)).not.toContain("SKU-1");
  });

  it("returns allowlisted customer PII while excluding it from audit and other domains", async () => {
    const { client: mcpClient, audits } = await harness();
    const customerSearch = await mcpClient.callTool({
      name: "customer_search",
      arguments: {},
    });
    expect(customerSearch.structuredContent).toMatchObject({
      ok: true,
      data: {
        customers: [{ first_name: "Jane", last_name: "Doe", email: "jane@example.com" }],
      },
    });
    expect(customerSearch.content).toEqual([
      { type: "text", text: JSON.stringify(customerSearch.structuredContent) },
    ]);

    const customer = await mcpClient.callTool({
      name: "customer_get",
      arguments: { customer_id: 7 },
    });
    expect(customer.structuredContent).toMatchObject({
      ok: true,
      data: {
        first_name: "Jane",
        last_name: "Doe",
        email: "jane@example.com",
        addresses: [
          {
            first_name: "Jane",
            last_name: "Doe",
            company: "Acme Inc",
            street: ["1 Main Street"],
            city: "Paris",
            region: "Ile-de-France",
            postcode: "75001",
            telephone: "+33123456789",
          },
        ],
      },
    });
    expect(customer.content).toEqual([
      { type: "text", text: JSON.stringify(customer.structuredContent) },
    ]);
    for (const privateValue of ["jane@example.com", "1 Main Street", "+33123456789"]) {
      expect(JSON.stringify(audits)).not.toContain(privateValue);
    }

    const source = await mcpClient.callTool({
      name: "inventory_source_search",
      arguments: {},
    });
    expect(JSON.stringify(source.structuredContent)).not.toContain("private@example.com");

    const product = await mcpClient.callTool({ name: "product_get", arguments: { sku: "SKU-1" } });
    expect(JSON.stringify(product.structuredContent)).not.toContain("custom_attributes");
    expect(JSON.stringify(product.structuredContent)).not.toContain("secret");
  });
});
