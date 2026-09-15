import type { RawOrderSearchItem } from "../../../magento/orders.js";
import type { OrderSearchData } from "./schemas.js";

function flag(value: boolean | 0 | 1): boolean {
  return value === true || value === 1;
}

export function mapOrderSearchItem(raw: RawOrderSearchItem): OrderSearchData["orders"][number] {
  return {
    order_id: raw.entity_id,
    increment_id: raw.increment_id,
    store_id: raw.store_id,
    status: raw.status ?? null,
    state: raw.state ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    currency_code: raw.order_currency_code,
    grand_total: raw.grand_total,
    total_paid: raw.total_paid ?? null,
    total_refunded: raw.total_refunded ?? null,
    total_item_count: raw.total_item_count,
    customer: {
      is_guest: flag(raw.customer_is_guest),
      first_name: raw.customer_firstname ?? null,
      last_name: raw.customer_lastname ?? null,
      email: raw.customer_email ?? null,
    },
  };
}
