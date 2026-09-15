import {
  MAGENTO_CREDIT_MEMO_STATE,
  MAGENTO_INVOICE_STATE,
  type RawCreditMemo,
  type RawCreditMemoSummary,
  type RawInvoice,
  type RawInvoiceSummary,
  type RawShipment,
  type RawShipmentSummary,
  type RawShipmentTrackingSummary,
} from "../../../magento/fulfillment.js";
import {
  CREDIT_MEMO_STATE,
  type CreditMemoGetData,
  type CreditMemoSearchData,
  INVOICE_STATE,
  type InvoiceGetData,
  type InvoiceSearchData,
  type OrderTrackingData,
  type ShipmentGetData,
  type ShipmentSearchData,
} from "./schemas.js";

function mapInvoiceState(state: number): InvoiceSearchData["invoices"][number]["state"] {
  switch (state) {
    case MAGENTO_INVOICE_STATE.OPEN:
      return INVOICE_STATE.OPEN;
    case MAGENTO_INVOICE_STATE.PAID:
      return INVOICE_STATE.PAID;
    case MAGENTO_INVOICE_STATE.CANCELED:
      return INVOICE_STATE.CANCELED;
    default:
      return "unknown";
  }
}

function mapCreditMemoState(state: number): CreditMemoSearchData["credit_memos"][number]["state"] {
  switch (state) {
    case MAGENTO_CREDIT_MEMO_STATE.OPEN:
      return CREDIT_MEMO_STATE.OPEN;
    case MAGENTO_CREDIT_MEMO_STATE.REFUNDED:
      return CREDIT_MEMO_STATE.REFUNDED;
    case MAGENTO_CREDIT_MEMO_STATE.CANCELED:
      return CREDIT_MEMO_STATE.CANCELED;
    default:
      return "unknown";
  }
}

export function mapInvoiceSummary(raw: RawInvoiceSummary): InvoiceSearchData["invoices"][number] {
  return {
    invoice_id: raw.entity_id,
    increment_id: raw.increment_id,
    order_id: raw.order_id,
    state: mapInvoiceState(raw.state),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    currency_code: raw.order_currency_code,
    grand_total: raw.grand_total,
    total_quantity: raw.total_qty,
  };
}

export function mapInvoice(raw: RawInvoice): InvoiceGetData {
  return {
    ...mapInvoiceSummary(raw),
    totals: {
      subtotal: raw.subtotal,
      discount_amount: raw.discount_amount,
      shipping_amount: raw.shipping_amount,
      tax_amount: raw.tax_amount,
      grand_total: raw.grand_total,
    },
    items: raw.items.map((item) => ({
      invoice_item_id: item.entity_id,
      order_item_id: item.order_item_id,
      sku: item.sku,
      name: item.name,
      quantity: item.qty,
      price: item.price,
      row_total: item.row_total,
      tax_amount: item.tax_amount,
      discount_amount: item.discount_amount,
    })),
  };
}

export function mapShipmentSummary(
  raw: RawShipmentSummary,
): ShipmentSearchData["shipments"][number] {
  return {
    shipment_id: raw.entity_id,
    increment_id: raw.increment_id,
    order_id: raw.order_id,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    total_quantity: raw.total_qty,
  };
}

function mapTrack(raw: RawShipment["tracks"][number]): ShipmentGetData["tracks"][number] {
  return {
    tracking_number: raw.track_number,
    title: raw.title ?? null,
    carrier_code: raw.carrier_code ?? null,
  };
}

export function mapShipmentTracking(
  raw: RawShipmentTrackingSummary,
): OrderTrackingData["shipments"][number] {
  return {
    shipment_id: raw.entity_id,
    shipment_increment_id: raw.increment_id,
    created_at: raw.created_at,
    tracks: raw.tracks.map(mapTrack),
  };
}

export function mapShipment(raw: RawShipment): ShipmentGetData {
  return {
    ...mapShipmentSummary(raw),
    total_weight: raw.total_weight ?? null,
    shipment_status: raw.shipment_status ?? null,
    items: raw.items.map((item) => ({
      shipment_item_id: item.entity_id,
      order_item_id: item.order_item_id,
      sku: item.sku,
      name: item.name,
      quantity: item.qty,
    })),
    tracks: raw.tracks.map(mapTrack),
  };
}

export function mapCreditMemoSummary(
  raw: RawCreditMemoSummary,
): CreditMemoSearchData["credit_memos"][number] {
  return {
    credit_memo_id: raw.entity_id,
    increment_id: raw.increment_id,
    order_id: raw.order_id,
    invoice_id:
      raw.invoice_id === undefined || raw.invoice_id === null || raw.invoice_id === 0
        ? null
        : raw.invoice_id,
    state: mapCreditMemoState(raw.state),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    currency_code: raw.order_currency_code,
    grand_total: raw.grand_total,
  };
}

export function mapCreditMemo(raw: RawCreditMemo): CreditMemoGetData {
  return {
    ...mapCreditMemoSummary(raw),
    totals: {
      subtotal: raw.subtotal,
      discount_amount: raw.discount_amount,
      shipping_amount: raw.shipping_amount,
      tax_amount: raw.tax_amount,
      adjustment_positive: raw.adjustment_positive,
      adjustment_negative: raw.adjustment_negative,
      grand_total: raw.grand_total,
    },
    items: raw.items.map((item) => ({
      credit_memo_item_id: item.entity_id,
      order_item_id: item.order_item_id,
      sku: item.sku,
      name: item.name,
      quantity: item.qty,
      price: item.price,
      row_total: item.row_total,
      tax_amount: item.tax_amount,
      discount_amount: item.discount_amount,
    })),
  };
}
