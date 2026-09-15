import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const ORDER_SEARCH_TOOL = "order_search";

export const ORDER_SEARCH_SORT = {
  NEWEST: "newest",
  OLDEST: "oldest",
  TOTAL_HIGH_TO_LOW: "total_high_to_low",
  TOTAL_LOW_TO_HIGH: "total_low_to_high",
} as const;

export const ORDER_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

function isCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  if (yearText === undefined || monthText === undefined || dayText === undefined) return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine(isCalendarDate);

const OrderSearchCustomerSchema = z.strictObject({
  is_guest: z.boolean(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
});

const OrderSearchItemSchema = z.strictObject({
  order_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  store_id: z.number().int().nonnegative(),
  status: z.string().min(1).nullable(),
  state: z.string().min(1).nullable(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
  total_paid: z.number().nullable(),
  total_refunded: z.number().nullable(),
  total_item_count: z.number().int().nonnegative(),
  customer: OrderSearchCustomerSchema,
});

const OrderSearchDataSchema = z.strictObject({
  orders: z.array(OrderSearchItemSchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const OrderSearchErrorCodeSchema = z.enum(ORDER_SEARCH_ERROR_CODE);

export function createOrderSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z
    .strictObject({
      increment_id: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .optional()
        .describe("Exact Magento order increment ID."),
      customer_email: z
        .string()
        .trim()
        .pipe(z.email().max(254))
        .optional()
        .describe("Exact customer email."),
      customer_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Exact Magento customer entity ID."),
      status: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_-]+$/)
        .optional()
        .describe("Exact Magento order status code, including custom status codes."),
      created_from: CalendarDateSchema.optional().describe(
        "Include orders created on or after this calendar date (YYYY-MM-DD).",
      ),
      created_to: CalendarDateSchema.optional().describe(
        "Include orders created on or before this calendar date (YYYY-MM-DD).",
      ),
      grand_total_min: z
        .number()
        .nonnegative()
        .optional()
        .describe("Minimum order grand total, inclusive."),
      grand_total_max: z
        .number()
        .nonnegative()
        .optional()
        .describe("Maximum order grand total, inclusive."),
      sort: z
        .enum(ORDER_SEARCH_SORT)
        .default(ORDER_SEARCH_SORT.NEWEST)
        .describe("Semantic order sorting; Magento field names are not accepted."),
      ...page.shape,
    })
    .superRefine((input, context) => {
      const hasFilter = [
        input.increment_id,
        input.customer_email,
        input.customer_id,
        input.status,
        input.created_from,
        input.created_to,
        input.grand_total_min,
        input.grand_total_max,
      ].some((value) => value !== undefined);
      if (!hasFilter) {
        context.addIssue({ code: "custom", message: "At least one order filter is required." });
      }
      if (
        input.created_from !== undefined &&
        input.created_to !== undefined &&
        input.created_from > input.created_to
      ) {
        context.addIssue({
          code: "custom",
          path: ["created_to"],
          message: "created_to must not be earlier than created_from.",
        });
      }
      if (
        input.grand_total_min !== undefined &&
        input.grand_total_max !== undefined &&
        input.grand_total_min > input.grand_total_max
      ) {
        context.addIssue({
          code: "custom",
          path: ["grand_total_max"],
          message: "grand_total_max must not be less than grand_total_min.",
        });
      }
    });
}

const OrderSearchResultSchemas = createToolResultSchemas(
  OrderSearchDataSchema,
  OrderSearchErrorCodeSchema,
);
export const OrderSearchOutputSchema = OrderSearchResultSchemas.output;

export type OrderSearchInputSchema = ReturnType<typeof createOrderSearchInputSchema>;
export type OrderSearchInput = z.infer<OrderSearchInputSchema>;
export type OrderSearchData = z.infer<typeof OrderSearchDataSchema>;
export type OrderSearchFailure = z.infer<typeof OrderSearchResultSchemas.failure>;
export type OrderSearchOutput = z.infer<typeof OrderSearchOutputSchema>;
