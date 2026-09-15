import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const INVENTORY_SOURCE_SEARCH_TOOL = "inventory_source_search";
const ErrorCodeSchema = z.enum({
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
});
const DataSchema = z.strictObject({
  sources: z.array(
    z.strictObject({
      source_code: z.string().min(1),
      name: z.string().min(1),
      enabled: z.boolean(),
      description: z.string().nullable(),
      country_code: z.string().nullable(),
    }),
  ),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});
export function createInventorySourceSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    source_code: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    enabled: z.boolean().optional(),
    country_code: z.string().trim().length(2).toUpperCase().optional(),
    ...page.shape,
  });
}
export const InventorySourceSearchOutputSchema = createToolResultSchemas(
  DataSchema,
  ErrorCodeSchema,
).output;
export type InventorySourceSearchOutput = z.infer<typeof InventorySourceSearchOutputSchema>;
