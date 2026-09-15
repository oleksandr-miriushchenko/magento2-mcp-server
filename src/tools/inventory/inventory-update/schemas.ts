import { z } from "zod";

import { AUDIT_TOOL } from "../../../core/audit.js";
import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const INVENTORY_UPDATE_TOOL = AUDIT_TOOL.INVENTORY_UPDATE;

export const INVENTORY_UPDATE_STATUS = {
  OUT_OF_STOCK: "out_of_stock",
  IN_STOCK: "in_stock",
} as const;

export const INVENTORY_UPDATE_ERROR_CODE = WRITE_ERROR_CODE;

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const InventorySourceItemInputSchema = z.strictObject({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => !hasUnsafeControl(value)),
  source_code: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_-]+$/),
  quantity: z.number().nonnegative(),
  status: z.enum(INVENTORY_UPDATE_STATUS),
});

export const InventoryUpdateInputSchema = z
  .strictObject({
    source_items: z.array(InventorySourceItemInputSchema).min(1).max(100),
    idempotency_key: z.uuid(),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.source_items.forEach((item, index) => {
      const key = `${item.sku.length}:${item.sku}${item.source_code}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["source_items", index],
          message: "Duplicate SKU and source_code pair.",
        });
      }
      seen.add(key);
    });
  });

const InventoryUpdateResultSchemas = createToolResultSchemas(
  z.strictObject({ updated_count: z.number().int().min(1).max(100) }),
  z.enum(INVENTORY_UPDATE_ERROR_CODE),
);
export const InventoryUpdateSuccessSchema = InventoryUpdateResultSchemas.success;
export const InventoryUpdateOutputSchema = InventoryUpdateResultSchemas.output;

export type InventoryUpdateInput = z.infer<typeof InventoryUpdateInputSchema>;
export type InventoryUpdateSuccess = z.infer<typeof InventoryUpdateSuccessSchema>;
export type InventoryUpdateOutput = z.infer<typeof InventoryUpdateOutputSchema>;
