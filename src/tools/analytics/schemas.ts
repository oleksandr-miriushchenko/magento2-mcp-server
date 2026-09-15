import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../shared/error-codes.js";
import { createToolResultSchemas } from "../shared/result-schemas.js";

export const ORDER_ANALYTICS_GET_TOOL = "order_analytics_get";
export const ORDER_ANALYTICS_GET_ERROR_CODE = RESOURCE_ERROR_CODE;

function isCalendarDate(value: string): boolean {
  const parts = value.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine(isCalendarDate);

export const OrderAnalyticsGetInputSchema = z
  .strictObject({
    created_from: CalendarDateSchema,
    created_to: CalendarDateSchema,
    status: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_-]+$/)
      .optional(),
  })
  .superRefine((input, context) => {
    const from = Date.parse(`${input.created_from}T00:00:00Z`);
    const to = Date.parse(`${input.created_to}T00:00:00Z`);
    if (to < from) {
      context.addIssue({
        code: "custom",
        path: ["created_to"],
        message: "created_to must not be earlier than created_from.",
      });
    } else if ((to - from) / 86_400_000 > 366) {
      context.addIssue({
        code: "custom",
        path: ["created_to"],
        message: "Date range must not exceed 366 days.",
      });
    }
  });

const OrderAnalyticsDataSchema = z.strictObject({
  created_from: CalendarDateSchema,
  created_to: CalendarDateSchema,
  status: z.string().nullable(),
  total_order_count: z.number().int().nonnegative(),
  scanned_order_count: z.number().int().nonnegative(),
  is_complete: z.boolean(),
  currencies: z.array(
    z.strictObject({
      currency_code: z.string().regex(/^[A-Z]{3}$/),
      order_count: z.number().int().nonnegative(),
      gross_order_value: z.number(),
      paid_amount: z.number(),
      refunded_amount: z.number(),
      net_collected_amount: z.number(),
      average_order_value: z.number(),
    }),
  ),
});

export const OrderAnalyticsGetErrorCodeSchema = z.enum(ORDER_ANALYTICS_GET_ERROR_CODE);

const OrderAnalyticsGetResultSchemas = createToolResultSchemas(
  OrderAnalyticsDataSchema,
  OrderAnalyticsGetErrorCodeSchema,
);
export const OrderAnalyticsGetOutputSchema = OrderAnalyticsGetResultSchemas.output;

export type OrderAnalyticsGetInput = z.infer<typeof OrderAnalyticsGetInputSchema>;
export type OrderAnalyticsData = z.infer<typeof OrderAnalyticsDataSchema>;
export type OrderAnalyticsGetFailure = z.infer<typeof OrderAnalyticsGetResultSchemas.failure>;
export type OrderAnalyticsGetOutput = z.infer<typeof OrderAnalyticsGetOutputSchema>;
