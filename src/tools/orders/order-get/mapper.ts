import type { RawOrder } from "../../../magento/orders.js";
import type { OrderGetData } from "./schemas.js";

type MagentoFlag = boolean | 0 | 1;

function flag(value: MagentoFlag): boolean {
  return value === true || value === 1;
}

function nullableFlag(value: MagentoFlag | null | undefined): boolean | null {
  return value == null ? null : flag(value);
}

function nullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function mapAddress(address: RawOrder["billing_address"]): OrderGetData["billing_address"] {
  if (address == null) return null;
  return {
    first_name: nullable(address.firstname),
    last_name: nullable(address.lastname),
    company: nullable(address.company),
    street: address.street ?? null,
    city: nullable(address.city),
    region: nullable(address.region),
    postcode: nullable(address.postcode),
    country_code: nullable(address.country_id),
    telephone: nullable(address.telephone),
    email: nullable(address.email),
  };
}

export function mapOrder(raw: RawOrder): OrderGetData {
  return {
    order_id: raw.entity_id,
    increment_id: raw.increment_id,
    store_id: raw.store_id,
    status: raw.status ?? null,
    state: raw.state ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    currency_code: raw.order_currency_code,
    totals: {
      subtotal: raw.subtotal,
      discount_amount: raw.discount_amount,
      shipping_amount: raw.shipping_amount,
      tax_amount: raw.tax_amount,
      grand_total: raw.grand_total,
      total_paid: raw.total_paid ?? null,
      total_refunded: raw.total_refunded ?? null,
    },
    customer: {
      is_guest: flag(raw.customer_is_guest),
      first_name: nullable(raw.customer_firstname),
      last_name: nullable(raw.customer_lastname),
      email: nullable(raw.customer_email),
    },
    billing_address: mapAddress(raw.billing_address),
    shipping_address: mapAddress(
      raw.extension_attributes?.shipping_assignments?.[0]?.shipping?.address,
    ),
    items: raw.items.map((item) => ({
      item_id: item.item_id,
      sku: item.sku,
      name: item.name,
      quantity_ordered: item.qty_ordered,
      quantity_invoiced: item.qty_invoiced,
      quantity_shipped: item.qty_shipped,
      quantity_canceled: item.qty_canceled,
      price: item.price,
      row_total: item.row_total,
    })),
    status_history: raw.status_histories.map((history) => ({
      history_id: history.entity_id,
      created_at: history.created_at,
      status: nullable(history.status),
      is_customer_notified: nullableFlag(history.is_customer_notified),
      is_visible_on_front: flag(history.is_visible_on_front),
      has_comment: history.comment != null && history.comment.trim() !== "",
    })),
    payment_method: raw.payment?.method ?? null,
  };
}
