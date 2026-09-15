import { RawOrderSchema, type RawOrder } from "../../src/magento/orders.js";
import { mapOrder } from "../../src/tools/orders/order-get/mapper.js";
import { createOrderGetWorkflow } from "../../src/tools/orders/order-get/workflow.js";

function rawOrder(overrides: Record<string, unknown> = {}): RawOrder {
  const parsed = RawOrderSchema.safeParse({
    entity_id: 7,
    increment_id: "000000007",
    store_id: 0,
    status: "processing",
    state: "processing",
    created_at: "2026-08-27 10:00:00",
    updated_at: "2026-08-27 11:00:00",
    order_currency_code: "USD",
    subtotal: 10,
    discount_amount: -1,
    shipping_amount: 2,
    tax_amount: 1,
    grand_total: 12,
    customer_is_guest: 1,
    customer_firstname: "Alice",
    customer_lastname: "Example",
    customer_email: "alice@example.com",
    customer_ip: "192.0.2.1",
    billing_address: {
      firstname: "Alice",
      lastname: "Example",
      company: "Acme",
      street: ["1 Secret Street"],
      city: "Sofia",
      region: "Sofia",
      postcode: "1000",
      country_id: "BG",
      telephone: "+359 1234",
      email: "billing@example.com",
      extension_attributes: { secret: "hidden" },
    },
    items: [
      {
        item_id: 9,
        sku: "SKU-1",
        name: "Widget",
        qty_ordered: 2,
        qty_invoiced: 1,
        qty_shipped: 1,
        qty_canceled: 0,
        price: 5,
        row_total: 10,
        product_option: { secret: true },
      },
    ],
    status_histories: [
      {
        entity_id: 3,
        created_at: "2026-08-27 10:30:00",
        status: null,
        is_customer_notified: 0,
        is_visible_on_front: 1,
        comment: "private operator comment",
      },
    ],
    payment: {
      method: "checkmo",
      cc_last4: "1234",
      additional_information: ["secret"],
    },
    extension_attributes: { shipping_assignments: [{ tracks: ["secret"] }] },
    ...overrides,
  });
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("test boundary object is invalid");
  return parsed.data;
}

describe("order boundary and workflow", () => {
  it("maps only the allowlist, returns PII, and converts nullable values", () => {
    const mapped = mapOrder(
      rawOrder({ total_paid: null, payment: null, status: undefined, state: null }),
    );
    expect(mapped).toMatchObject({ status: null, state: null });
    expect(mapped.customer).toEqual({
      is_guest: true,
      first_name: "Alice",
      last_name: "Example",
      email: "alice@example.com",
    });
    expect(mapped.billing_address).toEqual({
      first_name: "Alice",
      last_name: "Example",
      company: "Acme",
      street: ["1 Secret Street"],
      city: "Sofia",
      region: "Sofia",
      postcode: "1000",
      country_code: "BG",
      telephone: "+359 1234",
      email: "billing@example.com",
    });
    expect(mapped.totals.total_paid).toBeNull();
    expect(mapped.totals.total_refunded).toBeNull();
    expect(mapped.payment_method).toBeNull();
    expect(mapped.status_history[0]).toEqual({
      history_id: 3,
      created_at: "2026-08-27 10:30:00",
      status: null,
      is_customer_notified: false,
      is_visible_on_front: true,
      has_comment: true,
    });
    const serialized = JSON.stringify(mapped);
    for (const forbidden of [
      "private operator comment",
      "192.0.2.1",
      "cc_last4",
      "additional_information",
      "extension_attributes",
      "product_option",
      "shipment",
      "tracking",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("maps the order store ID without a second scope check", async () => {
    const workflow = createOrderGetWorkflow({
      getOrder: () => Promise.resolve(rawOrder({ store_id: 2 })),
    });
    await expect(workflow.execute(7, new AbortController().signal)).resolves.toMatchObject({
      order_id: 7,
      store_id: 2,
    });
  });

  it("maps the first shipping address independently of billing", () => {
    const mapped = mapOrder(
      rawOrder({
        extension_attributes: {
          shipping_assignments: [
            {
              shipping: {
                address: {
                  firstname: "Bob",
                  lastname: "Recipient",
                  company: "Shipping company",
                  street: ["Private street", "Private unit"],
                  city: "Private city",
                  region: "Private region",
                  postcode: "12345",
                  country_id: "US",
                  telephone: "+1 555 010 5678",
                  email: "shipping@example.com",
                  vat_id: "private-tax-id",
                  extension_attributes: { secret: "private-extension" },
                },
                method: "private-method",
              },
              items: [{ private: true }],
            },
            { shipping: { address: { country_id: "CA" } } },
          ],
        },
      }),
    );

    expect(mapped.shipping_address).toEqual({
      first_name: "Bob",
      last_name: "Recipient",
      company: "Shipping company",
      street: ["Private street", "Private unit"],
      city: "Private city",
      region: "Private region",
      postcode: "12345",
      country_code: "US",
      telephone: "+1 555 010 5678",
      email: "shipping@example.com",
    });
    expect(mapped.billing_address?.country_code).toBe("BG");
    expect(JSON.stringify(mapped)).not.toContain("private-");
  });

  it.each([
    undefined,
    null,
    {},
    { shipping_assignments: null },
    { shipping_assignments: [] },
    { shipping_assignments: [{}] },
    { shipping_assignments: [{ shipping: null }] },
    { shipping_assignments: [{ shipping: {} }] },
    { shipping_assignments: [{ shipping: { address: null } }] },
  ])("returns null for absent shipping data without copying billing: %j", (extensionAttributes) => {
    const mapped = mapOrder(rawOrder({ extension_attributes: extensionAttributes }));
    expect(mapped.shipping_address).toBeNull();
    expect(mapped.billing_address).not.toBeNull();
  });

  it("normalizes missing shipping fields to null", () => {
    const mapped = mapOrder(
      rawOrder({
        extension_attributes: {
          shipping_assignments: [{ shipping: { address: { country_id: "US", street: null } } }],
        },
      }),
    );
    expect(mapped.shipping_address).toEqual({
      first_name: null,
      last_name: null,
      company: null,
      street: null,
      city: null,
      region: null,
      postcode: null,
      country_code: "US",
      telephone: null,
      email: null,
    });
  });

  it("fetches one order per call and counts only actual Magento attempts", async () => {
    let attempts = 0;
    const workflow = createOrderGetWorkflow({
      getOrder: (_id, _signal, onAttempt) => {
        onAttempt?.();
        return Promise.resolve(rawOrder());
      },
    });
    await workflow.execute(7, new AbortController().signal, () => {
      attempts += 1;
    });
    await workflow.execute(7, new AbortController().signal, () => {
      attempts += 1;
    });
    expect(attempts).toBe(2);
  });
});
