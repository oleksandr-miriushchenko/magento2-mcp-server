import { z } from "zod";

import { AUDIT_TOOL } from "../../../core/audit.js";
import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas, type ToolFailure } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const FULFILLMENT_READ_TOOL = {
  ORDER_TRACKING_GET: AUDIT_TOOL.ORDER_TRACKING_GET,
  INVOICE_SEARCH: AUDIT_TOOL.INVOICE_SEARCH,
  INVOICE_GET: AUDIT_TOOL.INVOICE_GET,
  SHIPMENT_SEARCH: AUDIT_TOOL.SHIPMENT_SEARCH,
  SHIPMENT_GET: AUDIT_TOOL.SHIPMENT_GET,
  CREDIT_MEMO_SEARCH: AUDIT_TOOL.CREDIT_MEMO_SEARCH,
  CREDIT_MEMO_GET: AUDIT_TOOL.CREDIT_MEMO_GET,
} as const;

export const FULFILLMENT_SORT = {
  NEWEST: "newest",
  OLDEST: "oldest",
} as const;

export const INVOICE_STATE = {
  OPEN: "open",
  PAID: "paid",
  CANCELED: "canceled",
} as const;

export const CREDIT_MEMO_STATE = {
  OPEN: "open",
  REFUNDED: "refunded",
  CANCELED: "canceled",
} as const;

const SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

export const FulfillmentReadErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
export const FulfillmentSearchErrorCodeSchema = z.enum(SEARCH_ERROR_CODE);

const InvoiceStateOutputSchema = z.enum([...Object.values(INVOICE_STATE), "unknown"]);
const CreditMemoStateOutputSchema = z.enum([...Object.values(CREDIT_MEMO_STATE), "unknown"]);

const InvoiceSummarySchema = z.strictObject({
  invoice_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  state: InvoiceStateOutputSchema,
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
  total_quantity: z.number().nonnegative(),
});

const InvoiceItemSchema = z.strictObject({
  invoice_item_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
  tax_amount: z.number(),
  discount_amount: z.number(),
});

const InvoiceGetDataSchema = z.strictObject({
  ...InvoiceSummarySchema.shape,
  totals: z.strictObject({
    subtotal: z.number(),
    discount_amount: z.number(),
    shipping_amount: z.number(),
    tax_amount: z.number(),
    grand_total: z.number(),
  }),
  items: z.array(InvoiceItemSchema),
});

const InvoiceSearchDataSchema = z.strictObject({
  invoices: z.array(InvoiceSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

const ShipmentSummarySchema = z.strictObject({
  shipment_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  total_quantity: z.number().nonnegative(),
});

const TrackingSchema = z.strictObject({
  tracking_number: z.string().min(1),
  title: z.string().min(1).nullable(),
  carrier_code: z.string().min(1).nullable(),
});

const ShipmentTrackingSchema = z.strictObject({
  shipment_id: z.number().int().positive(),
  shipment_increment_id: z.string().min(1),
  created_at: MagentoDateTimeOutputSchema,
  tracks: z.array(TrackingSchema),
});

const ShipmentItemSchema = z.strictObject({
  shipment_item_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().nonnegative(),
});

const ShipmentGetDataSchema = z.strictObject({
  ...ShipmentSummarySchema.shape,
  total_weight: z.number().nonnegative().nullable(),
  shipment_status: z.number().int().nullable(),
  items: z.array(ShipmentItemSchema),
  tracks: z.array(TrackingSchema),
});

const ShipmentSearchDataSchema = z.strictObject({
  shipments: z.array(ShipmentSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

const OrderTrackingDataSchema = z.strictObject({
  order_id: z.number().int().positive(),
  shipments: z.array(ShipmentTrackingSchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

const CreditMemoSummarySchema = z.strictObject({
  credit_memo_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  invoice_id: z.number().int().positive().nullable(),
  state: CreditMemoStateOutputSchema,
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
});

const CreditMemoItemSchema = z.strictObject({
  credit_memo_item_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
  tax_amount: z.number(),
  discount_amount: z.number(),
});

const CreditMemoGetDataSchema = z.strictObject({
  ...CreditMemoSummarySchema.shape,
  totals: z.strictObject({
    subtotal: z.number(),
    discount_amount: z.number(),
    shipping_amount: z.number(),
    tax_amount: z.number(),
    adjustment_positive: z.number(),
    adjustment_negative: z.number(),
    grand_total: z.number(),
  }),
  items: z.array(CreditMemoItemSchema),
});

const CreditMemoSearchDataSchema = z.strictObject({
  credit_memos: z.array(CreditMemoSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const InvoiceGetInputSchema = z.strictObject({
  invoice_id: z.number().int().positive(),
});

export const ShipmentGetInputSchema = z.strictObject({
  shipment_id: z.number().int().positive(),
});

export const CreditMemoGetInputSchema = z.strictObject({
  credit_memo_id: z.number().int().positive(),
});

export function createInvoiceSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z
    .strictObject({
      order_id: z.number().int().positive().optional(),
      state: z.enum(INVOICE_STATE).optional(),
      sort: z.enum(FULFILLMENT_SORT).default(FULFILLMENT_SORT.NEWEST),
      ...page.shape,
    })
    .refine((input) => input.order_id !== undefined || input.state !== undefined, {
      error: "At least one invoice filter is required.",
    });
}

export function createShipmentSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    order_id: z.number().int().positive(),
    sort: z.enum(FULFILLMENT_SORT).default(FULFILLMENT_SORT.NEWEST),
    ...page.shape,
  });
}

export function createCreditMemoSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z
    .strictObject({
      order_id: z.number().int().positive().optional(),
      state: z.enum(CREDIT_MEMO_STATE).optional(),
      sort: z.enum(FULFILLMENT_SORT).default(FULFILLMENT_SORT.NEWEST),
      ...page.shape,
    })
    .refine((input) => input.order_id !== undefined || input.state !== undefined, {
      error: "At least one credit memo filter is required.",
    });
}

export function createOrderTrackingInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    order_id: z.number().int().positive(),
    ...page.shape,
  });
}

export const InvoiceSearchOutputSchema = createToolResultSchemas(
  InvoiceSearchDataSchema,
  FulfillmentSearchErrorCodeSchema,
).output;

export const InvoiceGetOutputSchema = createToolResultSchemas(
  InvoiceGetDataSchema,
  FulfillmentReadErrorCodeSchema,
).output;

export const ShipmentSearchOutputSchema = createToolResultSchemas(
  ShipmentSearchDataSchema,
  FulfillmentSearchErrorCodeSchema,
).output;

export const ShipmentGetOutputSchema = createToolResultSchemas(
  ShipmentGetDataSchema,
  FulfillmentReadErrorCodeSchema,
).output;

export const CreditMemoSearchOutputSchema = createToolResultSchemas(
  CreditMemoSearchDataSchema,
  FulfillmentSearchErrorCodeSchema,
).output;

export const CreditMemoGetOutputSchema = createToolResultSchemas(
  CreditMemoGetDataSchema,
  FulfillmentReadErrorCodeSchema,
).output;

export const OrderTrackingOutputSchema = createToolResultSchemas(
  OrderTrackingDataSchema,
  FulfillmentSearchErrorCodeSchema,
).output;

export type InvoiceSearchInputSchema = ReturnType<typeof createInvoiceSearchInputSchema>;
export type ShipmentSearchInputSchema = ReturnType<typeof createShipmentSearchInputSchema>;
export type CreditMemoSearchInputSchema = ReturnType<typeof createCreditMemoSearchInputSchema>;
export type OrderTrackingInputSchema = ReturnType<typeof createOrderTrackingInputSchema>;
export type InvoiceSearchInput = z.infer<InvoiceSearchInputSchema>;
export type ShipmentSearchInput = z.infer<ShipmentSearchInputSchema>;
export type CreditMemoSearchInput = z.infer<CreditMemoSearchInputSchema>;
export type OrderTrackingInput = z.infer<OrderTrackingInputSchema>;
export type InvoiceGetInput = z.infer<typeof InvoiceGetInputSchema>;
export type ShipmentGetInput = z.infer<typeof ShipmentGetInputSchema>;
export type CreditMemoGetInput = z.infer<typeof CreditMemoGetInputSchema>;
export type InvoiceSearchData = z.infer<typeof InvoiceSearchDataSchema>;
export type InvoiceGetData = z.infer<typeof InvoiceGetDataSchema>;
export type ShipmentSearchData = z.infer<typeof ShipmentSearchDataSchema>;
export type ShipmentGetData = z.infer<typeof ShipmentGetDataSchema>;
export type CreditMemoSearchData = z.infer<typeof CreditMemoSearchDataSchema>;
export type CreditMemoGetData = z.infer<typeof CreditMemoGetDataSchema>;
export type OrderTrackingData = z.infer<typeof OrderTrackingDataSchema>;
export type FulfillmentReadFailure = ToolFailure<typeof FulfillmentReadErrorCodeSchema>;
export type FulfillmentSearchFailure = ToolFailure<typeof FulfillmentSearchErrorCodeSchema>;
export type InvoiceSearchOutput = z.infer<typeof InvoiceSearchOutputSchema>;
export type InvoiceGetOutput = z.infer<typeof InvoiceGetOutputSchema>;
export type ShipmentSearchOutput = z.infer<typeof ShipmentSearchOutputSchema>;
export type ShipmentGetOutput = z.infer<typeof ShipmentGetOutputSchema>;
export type CreditMemoSearchOutput = z.infer<typeof CreditMemoSearchOutputSchema>;
export type CreditMemoGetOutput = z.infer<typeof CreditMemoGetOutputSchema>;
export type OrderTrackingOutput = z.infer<typeof OrderTrackingOutputSchema>;
