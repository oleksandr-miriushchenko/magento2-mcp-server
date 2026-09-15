import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const PRODUCT_ATTRIBUTE_SEARCH_TOOL = "product_attribute_search";
const ErrorCodeSchema = z.enum({
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
});
export const ProductAttributeSummarySchema = z.strictObject({
  attribute_id: z.number().int().positive(),
  attribute_code: z.string().min(1),
  label: z.string().nullable(),
  input_type: z.string().nullable(),
  scope: z.string().nullable(),
  is_required: z.boolean(),
  is_unique: z.boolean(),
  is_user_defined: z.boolean(),
  is_visible_on_front: z.boolean(),
  used_in_product_listing: z.boolean(),
  is_filterable: z.boolean(),
  is_filterable_in_search: z.boolean(),
  is_searchable: z.boolean(),
  is_comparable: z.boolean(),
});
const DataSchema = z.strictObject({
  attributes: z.array(ProductAttributeSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});
export function createProductAttributeSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    code: z.string().trim().min(1).max(255).optional(),
    label: z.string().trim().min(1).max(255).optional(),
    user_defined: z.boolean().optional(),
    ...page.shape,
  });
}
export const ProductAttributeSearchOutputSchema = createToolResultSchemas(
  DataSchema,
  ErrorCodeSchema,
).output;
export type ProductAttributeSearchOutput = z.infer<typeof ProductAttributeSearchOutputSchema>;
