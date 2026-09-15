import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const CUSTOMER_SEARCH_TOOL = "customer_search";
export const CUSTOMER_SEARCH_SORT = {
  NEWEST: "newest",
  OLDEST: "oldest",
  NAME_A_TO_Z: "name_a_to_z",
  NAME_Z_TO_A: "name_z_to_a",
} as const;

export const CUSTOMER_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

const CustomerSummarySchema = z.strictObject({
  customer_id: z.number().int().positive(),
  group_id: z.number().int().nonnegative(),
  store_id: z.number().int().nonnegative(),
  website_id: z.number().int().nonnegative(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
});

const CustomerSearchDataSchema = z.strictObject({
  customers: z.array(CustomerSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export function createCustomerSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    customer_id: z.number().int().positive().optional(),
    email: z.email().trim().max(254).optional(),
    name: z.string().trim().min(1).max(100).optional(),
    group_id: z.number().int().nonnegative().optional(),
    website_id: z.number().int().nonnegative().optional(),
    sort: z.enum(CUSTOMER_SEARCH_SORT).default(CUSTOMER_SEARCH_SORT.NEWEST),
    ...page.shape,
  });
}

export const CustomerSearchOutputSchema = createToolResultSchemas(
  CustomerSearchDataSchema,
  z.enum(CUSTOMER_SEARCH_ERROR_CODE),
).output;

export type CustomerSearchInputSchema = ReturnType<typeof createCustomerSearchInputSchema>;
export type CustomerSearchInput = z.infer<CustomerSearchInputSchema>;
export type CustomerSearchData = z.infer<typeof CustomerSearchDataSchema>;
export type CustomerSearchOutput = z.infer<typeof CustomerSearchOutputSchema>;
