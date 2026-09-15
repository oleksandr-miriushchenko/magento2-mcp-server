import { z } from "zod";

import { createPageInputSchema } from "../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../shared/error-codes.js";
import { createToolResultSchemas } from "../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../shared/schemas.js";

export const QUOTE_SEARCH_TOOL = "quote_search";
export const QUOTE_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

const CalendarDateSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/);

const QuoteSchema = z.strictObject({
  quote_id: z.number().int().positive(),
  store_id: z.number().int().nonnegative(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  is_active: z.boolean(),
  is_virtual: z.boolean(),
  items_count: z.number().int().nonnegative(),
  items_quantity: z.number().nonnegative(),
  currency_code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  customer: z.strictObject({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string().nullable(),
  }),
});

const QuoteSearchDataSchema = z.strictObject({
  quotes: z.array(QuoteSchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const QuoteSearchErrorCodeSchema = z.enum(QUOTE_SEARCH_ERROR_CODE);

export function createQuoteSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z
    .strictObject({
      active: z.boolean().default(true),
      customer_id: z.number().int().positive().optional(),
      updated_from: CalendarDateSchema.optional(),
      updated_to: CalendarDateSchema.optional(),
      ...page.shape,
    })
    .superRefine((input, context) => {
      if (
        input.updated_from !== undefined &&
        input.updated_to !== undefined &&
        input.updated_from > input.updated_to
      ) {
        context.addIssue({
          code: "custom",
          path: ["updated_to"],
          message: "updated_to must not be earlier than updated_from.",
        });
      }
    });
}

const QuoteSearchResultSchemas = createToolResultSchemas(
  QuoteSearchDataSchema,
  QuoteSearchErrorCodeSchema,
);
export const QuoteSearchOutputSchema = QuoteSearchResultSchemas.output;

export type QuoteSearchInputSchema = ReturnType<typeof createQuoteSearchInputSchema>;
export type QuoteSearchInput = z.infer<QuoteSearchInputSchema>;
export type QuoteSearchData = z.infer<typeof QuoteSearchDataSchema>;
export type QuoteSearchFailure = z.infer<typeof QuoteSearchResultSchemas.failure>;
export type QuoteSearchOutput = z.infer<typeof QuoteSearchOutputSchema>;
