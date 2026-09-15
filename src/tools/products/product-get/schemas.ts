import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";
import { PRODUCT_STATUS, PRODUCT_VISIBILITY } from "../product-search/schemas.js";

export const PRODUCT_GET_TOOL = "product_get";
const ErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
const ProductGetDataSchema = z.strictObject({
  product_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  product_type: z.string().min(1),
  attribute_set_id: z.number().int().positive(),
  price: z.number().nullable(),
  weight: z.number().nonnegative().nullable(),
  status: z.enum(PRODUCT_STATUS),
  visibility: z.enum(PRODUCT_VISIBILITY),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  category_links: z.array(
    z.strictObject({
      category_id: z.number().int().positive(),
      position: z.number().int().nullable(),
    }),
  ),
});
export const ProductGetInputSchema = z.strictObject({
  sku: z.string().trim().min(1).max(64),
});
export const ProductGetOutputSchema = createToolResultSchemas(
  ProductGetDataSchema,
  ErrorCodeSchema,
).output;
export type ProductGetOutput = z.infer<typeof ProductGetOutputSchema>;
