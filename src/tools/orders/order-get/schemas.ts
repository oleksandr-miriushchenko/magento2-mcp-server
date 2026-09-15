import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const ORDER_GET_TOOL = "order_get";

export const ORDER_GET_ERROR_CODE = RESOURCE_ERROR_CODE;

const OrderTotalsSchema = z.strictObject({
  subtotal: z.number(),
  discount_amount: z.number(),
  shipping_amount: z.number(),
  tax_amount: z.number(),
  grand_total: z.number(),
  total_paid: z.number().nullable(),
  total_refunded: z.number().nullable(),
});

const OrderCustomerSchema = z.strictObject({
  is_guest: z.boolean(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
});

const OrderAddressSchema = z.strictObject({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  company: z.string().nullable(),
  street: z.array(z.string()).nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postcode: z.string().nullable(),
  country_code: z.string().nullable(),
  telephone: z.string().nullable(),
  email: z.string().nullable(),
});

const OrderItemSchema = z.strictObject({
  item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  quantity_ordered: z.number().nonnegative(),
  quantity_invoiced: z.number().nonnegative(),
  quantity_shipped: z.number().nonnegative(),
  quantity_canceled: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
});

const OrderStatusHistorySchema = z.strictObject({
  history_id: z.number().int().positive(),
  created_at: MagentoDateTimeOutputSchema,
  status: z.string().nullable(),
  is_customer_notified: z.boolean().nullable(),
  is_visible_on_front: z.boolean(),
  has_comment: z.boolean(),
});

const OrderGetDataSchema = z.strictObject({
  order_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  store_id: z.number().int().nonnegative(),
  status: z.string().min(1).nullable(),
  state: z.string().min(1).nullable(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  totals: OrderTotalsSchema,
  customer: OrderCustomerSchema,
  billing_address: OrderAddressSchema.nullable(),
  shipping_address: OrderAddressSchema.nullable(),
  items: z.array(OrderItemSchema),
  status_history: z.array(OrderStatusHistorySchema),
  payment_method: z.string().min(1).nullable(),
});

export const OrderGetErrorCodeSchema = z.enum(ORDER_GET_ERROR_CODE);

export const OrderGetInputSchema = z.strictObject({
  order_id: z.number().int().positive(),
});

const OrderGetResultSchemas = createToolResultSchemas(OrderGetDataSchema, OrderGetErrorCodeSchema);
export const OrderGetOutputSchema = OrderGetResultSchemas.output;

export type OrderGetInput = z.infer<typeof OrderGetInputSchema>;
export type OrderGetData = z.infer<typeof OrderGetDataSchema>;
export type OrderGetSuccess = z.infer<typeof OrderGetResultSchemas.success>;
export type OrderGetFailure = z.infer<typeof OrderGetResultSchemas.failure>;
export type OrderGetOutput = z.infer<typeof OrderGetOutputSchema>;
