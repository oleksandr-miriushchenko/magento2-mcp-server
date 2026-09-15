import { z } from "zod";

import { AUDIT_TOOL } from "../../../core/audit.js";
import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { PRODUCT_STATUS, PRODUCT_VISIBILITY } from "../product-search/schemas.js";

export const PRODUCT_UPDATE_TOOL = AUDIT_TOOL.PRODUCT_UPDATE;

export const PRODUCT_UPDATE_ERROR_CODE = WRITE_ERROR_CODE;

export const PRODUCT_UPDATE_CHANGED_FIELD = {
  NAME: "name",
  PRICE: "price",
  STATUS: "status",
  VISIBILITY: "visibility",
  WEIGHT: "weight",
} as const;

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 32 && code !== 9) || code === 127;
  });
}

export const ProductUpdateInputSchema = z
  .strictObject({
    sku: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((value) => !hasUnsafeControl(value)),
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !hasUnsafeControl(value))
      .optional(),
    price: z.number().nonnegative().optional(),
    status: z.enum(PRODUCT_STATUS).optional(),
    visibility: z.enum(PRODUCT_VISIBILITY).optional(),
    weight: z.number().nonnegative().optional(),
    idempotency_key: z.uuid(),
  })
  .superRefine((input, context) => {
    if (
      input.name === undefined &&
      input.price === undefined &&
      input.status === undefined &&
      input.visibility === undefined &&
      input.weight === undefined
    ) {
      context.addIssue({ code: "custom", message: "At least one product field must be updated." });
    }
  });

const ProductUpdateDataSchema = z.strictObject({
  sku: z.string().min(1),
  updated: z.literal(true),
  changed_fields: z.array(z.enum(PRODUCT_UPDATE_CHANGED_FIELD)).min(1).max(5),
});

const ProductUpdateResultSchemas = createToolResultSchemas(
  ProductUpdateDataSchema,
  z.enum(PRODUCT_UPDATE_ERROR_CODE),
);
export const ProductUpdateSuccessSchema = ProductUpdateResultSchemas.success;
export const ProductUpdateOutputSchema = ProductUpdateResultSchemas.output;

export type ProductUpdateInput = z.infer<typeof ProductUpdateInputSchema>;
export type ProductUpdateSuccess = z.infer<typeof ProductUpdateSuccessSchema>;
export type ProductUpdateOutput = z.infer<typeof ProductUpdateOutputSchema>;
