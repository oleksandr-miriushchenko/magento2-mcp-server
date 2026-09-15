import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const INVENTORY_STOCK_SEARCH_TOOL = "inventory_stock_search";
const ErrorCodeSchema = z.enum({
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
});
const DataSchema = z.strictObject({
  stocks: z.array(
    z.strictObject({
      stock_id: z.number().int().positive(),
      name: z.string().min(1),
      sales_channels: z.array(z.strictObject({ type: z.string().min(1), code: z.string().min(1) })),
    }),
  ),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});
export function createInventoryStockSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    name: z.string().trim().min(1).max(255).optional(),
    ...page.shape,
  });
}
export const InventoryStockSearchOutputSchema = createToolResultSchemas(
  DataSchema,
  ErrorCodeSchema,
).output;
export type InventoryStockSearchOutput = z.infer<typeof InventoryStockSearchOutputSchema>;
