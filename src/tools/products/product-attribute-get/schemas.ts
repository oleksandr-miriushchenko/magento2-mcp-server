import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { ProductAttributeSummarySchema } from "../product-attribute-search/schemas.js";

export const PRODUCT_ATTRIBUTE_GET_TOOL = "product_attribute_get";
const ErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
const DataSchema = ProductAttributeSummarySchema.extend({
  options: z.array(
    z.strictObject({
      label: z.string(),
      value: z.string(),
    }),
  ),
});
export const ProductAttributeGetInputSchema = z.strictObject({
  attribute_code: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z][a-z0-9_]*$/),
});
export const ProductAttributeGetOutputSchema = createToolResultSchemas(
  DataSchema,
  ErrorCodeSchema,
).output;
export type ProductAttributeGetOutput = z.infer<typeof ProductAttributeGetOutputSchema>;
