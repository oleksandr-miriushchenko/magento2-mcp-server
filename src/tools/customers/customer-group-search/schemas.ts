import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const CUSTOMER_GROUP_SEARCH_TOOL = "customer_group_search";
export const CUSTOMER_GROUP_SEARCH_SORT = {
  ID_ASCENDING: "id_ascending",
  NAME_ASCENDING: "name_ascending",
  NAME_DESCENDING: "name_descending",
} as const;
const ErrorCodeSchema = z.enum({
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
});
const DataSchema = z.strictObject({
  groups: z.array(
    z.strictObject({
      group_id: z.number().int().nonnegative(),
      code: z.string().min(1),
      tax_class_id: z.number().int().nonnegative(),
    }),
  ),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});
export function createCustomerGroupSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    code: z.string().trim().min(1).max(255).optional(),
    sort: z.enum(CUSTOMER_GROUP_SEARCH_SORT).default(CUSTOMER_GROUP_SEARCH_SORT.ID_ASCENDING),
    ...page.shape,
  });
}
export const CustomerGroupSearchOutputSchema = createToolResultSchemas(
  DataSchema,
  ErrorCodeSchema,
).output;
export type CustomerGroupSearchOutput = z.infer<typeof CustomerGroupSearchOutputSchema>;
