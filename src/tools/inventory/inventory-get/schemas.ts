import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const INVENTORY_GET_TOOL = "inventory_get";
const ErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
export const InventoryGetInputSchema = z.strictObject({
  sku: z.string().trim().min(1).max(64),
  stock_id: z.number().int().positive(),
});
export const InventoryGetOutputSchema = createToolResultSchemas(
  z.strictObject({
    sku: z.string().min(1),
    stock_id: z.number().int().positive(),
    salable_quantity: z.number(),
    is_salable: z.boolean(),
  }),
  ErrorCodeSchema,
).output;
export type InventoryGetOutput = z.infer<typeof InventoryGetOutputSchema>;
