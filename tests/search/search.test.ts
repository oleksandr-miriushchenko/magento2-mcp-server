import { createSearchCursorCodec } from "../../src/core/search-cursor.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { MAGENTO_ORDER_SEARCH_SORT, MagentoOrders } from "../../src/magento/orders.js";
import { MAGENTO_PRODUCT_SEARCH_SORT, MagentoProducts } from "../../src/magento/products.js";
import { buildMagentoSearchParams, MAGENTO_SEARCH_CONDITION } from "../../src/magento/search.js";
import { createOrderSearchInputSchema } from "../../src/tools/orders/order-search/schemas.js";
import { createProductSearchInputSchema } from "../../src/tools/products/product-search/schemas.js";

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

describe("Magento search parameter builder", () => {
  it("serializes OR filters inside a group and AND groups with stable indexes", () => {
    const parameters = buildMagentoSearchParams({
      filterGroups: [
        {
          filters: [
            { field: "name", value: "%shoe%", condition: MAGENTO_SEARCH_CONDITION.LIKE },
            { field: "sku", value: "%shoe%", condition: MAGENTO_SEARCH_CONDITION.LIKE },
          ],
        },
        {
          filters: [{ field: "status", value: 1, condition: MAGENTO_SEARCH_CONDITION.EQUALS }],
        },
      ],
      sortOrders: [
        { field: "price", direction: "ASC" },
        { field: "entity_id", direction: "ASC" },
      ],
      pageSize: 10,
      currentPage: 2,
      fields: "items[id,sku],total_count",
    });

    expect(parameters.get("searchCriteria[filter_groups][0][filters][0][field]")).toBe("name");
    expect(parameters.get("searchCriteria[filter_groups][0][filters][1][field]")).toBe("sku");
    expect(parameters.get("searchCriteria[filter_groups][1][filters][0][field]")).toBe("status");
    expect(parameters.get("searchCriteria[sortOrders][0][field]")).toBe("price");
    expect(parameters.get("searchCriteria[sortOrders][1][field]")).toBe("entity_id");
    expect(parameters.get("searchCriteria[pageSize]")).toBe("10");
    expect(parameters.get("searchCriteria[currentPage]")).toBe("2");
    expect(parameters.get("fields")).toBe("items[id,sku],total_count");
  });
});

describe("search input contracts", () => {
  it("requires an order filter and validates real dates and ranges", () => {
    const schema = createOrderSearchInputSchema(25);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ status: "processing", created_from: "2026-02-29" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        status: "processing",
        created_from: "2026-03-02",
        created_to: "2026-03-01",
      }).success,
    ).toBe(false);
    const parsed = schema.safeParse({ status: "processing" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ sort: "newest", page_size: 25 });
    }
  });

  it("allows an unfiltered product list but rejects invalid ranges and page sizes", () => {
    const schema = createProductSearchInputSchema(10);
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ sort: "newest", page_size: 10 });
    expect(schema.safeParse({ price_min: 10, price_max: 9 }).success).toBe(false);
    expect(schema.safeParse({ page_size: 11 }).success).toBe(false);
    expect(schema.safeParse({ sort_field: "price" }).success).toBe(false);
  });
});

describe("search cursor policy", () => {
  it("binds the cursor to its domain and normalized criteria", () => {
    const key = new Uint8Array(32).fill(5);
    const orders = createSearchCursorCodec({ key, kind: "order_search" });
    const cursor = orders.encode(2, { status: "processing", page_size: 25 });

    expect(orders.decode(cursor, { status: "processing", page_size: 25 })).toBe(2);
    expect(() => orders.decode(cursor, { status: "complete", page_size: 25 })).toThrow(
      "Invalid or expired cursor.",
    );
    expect(() =>
      createSearchCursorCodec({ key, kind: "product_search" }).decode(cursor, {
        status: "processing",
        page_size: 25,
      }),
    ).toThrow("Invalid or expired cursor.");
  });
});

describe("Magento product search boundary", () => {
  it("uses fixed product fields, semantic sorting, and entity-specific response parsing", async () => {
    let requestedUrl: URL | undefined;
    const products = new MagentoProducts(
      client((input) => {
        requestedUrl = new URL(String(input));
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 3,
                sku: "SHOE-3",
                name: "Trail Shoe",
                attribute_set_id: 4,
                price: 70,
                status: 1,
                visibility: 4,
                type_id: "simple",
                created_at: "2026-08-20 10:00:00",
                updated_at: "2026-08-21 10:00:00",
                private_extension: "discarded",
              },
            ],
            total_count: 1,
            search_criteria: { private: true },
          }),
        );
      }),
    );

    const result = await products.searchProducts(
      {
        search: "shoe",
        status: 1,
        priceMin: 20,
        sort: MAGENTO_PRODUCT_SEARCH_SORT.PRICE_ASCENDING,
        pageSize: 5,
        currentPage: 2,
      },
      new AbortController().signal,
    );

    expect(requestedUrl?.pathname).toBe("/rest/default/V1/products");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][0][filters][0][field]"),
    ).toBe("name");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][0][filters][1][field]"),
    ).toBe("sku");
    expect(requestedUrl?.searchParams.get("searchCriteria[sortOrders][0][field]")).toBe("price");
    expect(requestedUrl?.searchParams.get("searchCriteria[sortOrders][1][field]")).toBe(
      "entity_id",
    );
    expect(requestedUrl?.searchParams.get("searchCriteria[currentPage]")).toBe("2");
    expect(requestedUrl?.searchParams.get("fields")).toBe(
      "items[id,sku,name,attribute_set_id,price,status,visibility,type_id,created_at,updated_at],total_count",
    );
    expect(result.items[0]).not.toHaveProperty("private_extension");
    expect(result).not.toHaveProperty("search_criteria");
  });

  it("normalizes Magento's sparse empty collection from null to an empty array", async () => {
    const result = await new MagentoProducts(
      client(() => Promise.resolve(jsonResponse({ items: null, total_count: 0 }))),
    ).searchProducts(
      {
        sort: MAGENTO_PRODUCT_SEARCH_SORT.CREATED_DESCENDING,
        pageSize: 25,
        currentPage: 1,
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ items: [], total_count: 0 });
  });

  it("still rejects a collection response with a missing items field", async () => {
    await expect(
      new MagentoProducts(
        client(() => Promise.resolve(jsonResponse({ total_count: 0 }))),
      ).searchProducts(
        {
          sort: MAGENTO_PRODUCT_SEARCH_SORT.CREATED_DESCENDING,
          pageSize: 25,
          currentPage: 1,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });

  it("rejects a valid Magento page containing more items than requested", async () => {
    const item = {
      id: 3,
      sku: "SHOE-3",
      name: "Trail Shoe",
      attribute_set_id: 4,
      price: 70,
      status: 1,
      visibility: 4,
      type_id: "simple",
      created_at: "2026-08-20 10:00:00",
      updated_at: "2026-08-21 10:00:00",
    };
    await expect(
      new MagentoProducts(
        client(() =>
          Promise.resolve(
            jsonResponse({
              items: [item, { ...item, id: 4, sku: "SHOE-4" }],
              total_count: 2,
            }),
          ),
        ),
      ).searchProducts(
        {
          sort: MAGENTO_PRODUCT_SEARCH_SORT.CREATED_DESCENDING,
          pageSize: 1,
          currentPage: 1,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });
});

describe("Magento order search boundary", () => {
  it("uses separate AND groups for date bounds and returns only validated summary fields", async () => {
    let requestedUrl: URL | undefined;
    const orders = new MagentoOrders(
      client((input) => {
        requestedUrl = new URL(String(input));
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                entity_id: 9,
                increment_id: "000000009",
                store_id: 0,
                state: "processing",
                created_at: "2026-03-01 10:00:00",
                updated_at: "2026-03-01 11:00:00",
                order_currency_code: "USD",
                grand_total: 15,
                total_paid: null,
                total_refunded: null,
                total_item_count: 2,
                customer_is_guest: 1,
                customer_firstname: null,
                customer_lastname: null,
                customer_email: null,
                billing_address: { private: true },
              },
            ],
            total_count: 1,
          }),
        );
      }),
    );

    const result = await orders.searchOrders(
      {
        status: "processing",
        createdFrom: "2026-03-01 00:00:00",
        createdTo: "2026-03-31 23:59:59",
        sort: MAGENTO_ORDER_SEARCH_SORT.CREATED_DESCENDING,
        pageSize: 25,
        currentPage: 1,
      },
      new AbortController().signal,
    );

    expect(requestedUrl?.pathname).toBe("/rest/default/V1/orders");
    expect(
      requestedUrl?.searchParams.get(
        "searchCriteria[filter_groups][1][filters][0][condition_type]",
      ),
    ).toBe("gteq");
    expect(
      requestedUrl?.searchParams.get(
        "searchCriteria[filter_groups][2][filters][0][condition_type]",
      ),
    ).toBe("lteq");
    expect(requestedUrl?.searchParams.get("fields")).toContain("customer_email");
    expect(result.items[0]).not.toHaveProperty("billing_address");
    expect(result.items[0]?.status).toBeUndefined();
  });

  it("normalizes Magento's sparse empty collection from null to an empty array", async () => {
    const result = await new MagentoOrders(
      client(() => Promise.resolve(jsonResponse({ items: null, total_count: 0 }))),
    ).searchOrders(
      {
        status: "processing",
        sort: MAGENTO_ORDER_SEARCH_SORT.CREATED_DESCENDING,
        pageSize: 25,
        currentPage: 1,
      },
      new AbortController().signal,
    );

    expect(result).toEqual({ items: [], total_count: 0 });
  });

  it("rejects a schema-invalid collection response safely", async () => {
    await expect(
      new MagentoOrders(
        client(() => Promise.resolve(jsonResponse({ items: [{}], total_count: 1 }))),
      ).searchOrders(
        {
          status: "processing",
          sort: MAGENTO_ORDER_SEARCH_SORT.CREATED_DESCENDING,
          pageSize: 25,
          currentPage: 1,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });
});
