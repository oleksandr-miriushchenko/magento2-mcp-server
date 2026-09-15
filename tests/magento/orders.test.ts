import { type AppError, ERROR_CODE } from "../../src/core/errors.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { MagentoOrders } from "../../src/magento/orders.js";

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
  customer_ip: "192.0.2.1",
  billing_address: null,
  items: [],
  status_histories: [],
  payment: null,
  extension_attributes: {
    private: true,
    shipping_assignments: [
      {
        shipping: { address: { country_id: "BG", vat_id: "private" }, method: "private" },
        items: [{ private: true }],
      },
    ],
  },
};

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

describe("MagentoOrders", () => {
  it("uses the fixed order route and returns validated allowlisted data", async () => {
    let requestedUrl: string | undefined;
    const magentoClient = client((input) => {
      requestedUrl = String(input);
      return Promise.resolve(jsonResponse(rawOrder));
    });
    const signal = new AbortController().signal;
    const onAttempt = vi.fn();

    const result = await new MagentoOrders(magentoClient).getOrder(7, signal, onAttempt);

    expect(requestedUrl).toBe("https://shop.example/rest/default/V1/orders/7");
    expect(onAttempt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ entity_id: 7, increment_id: "000000007" });
    expect(result).not.toHaveProperty("customer_ip");
    expect(result.extension_attributes).toEqual({
      shipping_assignments: [{ shipping: { address: { country_id: "BG" } } }],
    });
  });

  it.each([
    { shipping_assignments: "private" },
    { shipping_assignments: [{ shipping: { address: "private" } }] },
    { shipping_assignments: [{ shipping: { address: { street: "private" } } }] },
    { shipping_assignments: [{ shipping: { address: { telephone: 123 } } }] },
  ])("rejects malformed shipping data at the Magento boundary: %j", async (extensionAttributes) => {
    const orders = new MagentoOrders(
      client(() =>
        Promise.resolve(jsonResponse({ ...rawOrder, extension_attributes: extensionAttributes })),
      ),
    );
    await expect(orders.getOrder(7, new AbortController().signal)).rejects.toMatchObject({
      code: ERROR_CODE.UPSTREAM_INVALID_RESPONSE,
      retryable: false,
    });
  });

  it("rejects schema-invalid JSON without exposing Magento values or Zod details", async () => {
    const privateValue = "private@example.com";
    let caught: unknown;
    try {
      await new MagentoOrders(
        client(() => Promise.resolve(jsonResponse({ entity_id: 7, customer_email: privateValue }))),
      ).getOrder(7, new AbortController().signal);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", retryable: false });
    expect((caught as AppError).message).not.toContain(privateValue);
    expect((caught as AppError).message).not.toContain("entity_id");
  });

  it("adds one private comment through the fixed route and fixed flags", async () => {
    let requestedUrl: string | undefined;
    let requestedInit: RequestInit | undefined;
    const magentoClient = client((input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return Promise.resolve(jsonResponse(true));
    });
    const signal = new AbortController().signal;
    const onAttempt = vi.fn();

    await new MagentoOrders(magentoClient).addComment(7, "Private note", signal, onAttempt);

    expect(requestedUrl).toBe("https://shop.example/rest/default/V1/orders/7/comments");
    expect(requestedInit?.method).toBe("POST");
    const requestBody = requestedInit?.body;
    if (typeof requestBody !== "string") throw new Error("expected JSON request body");
    expect(JSON.parse(requestBody)).toEqual({
      statusHistory: {
        comment: "Private note",
        is_customer_notified: 0,
        is_visible_on_front: 0,
      },
    });
    expect(requestBody).not.toContain('status"');
    expect(requestBody).not.toContain("parent_id");
    expect(onAttempt).toHaveBeenCalledOnce();
  });

  it("treats a non-true add-comment response as an unknown mutation outcome", async () => {
    await expect(
      new MagentoOrders(client(() => Promise.resolve(jsonResponse(false)))).addComment(
        7,
        "Private note",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN" });
  });
});
