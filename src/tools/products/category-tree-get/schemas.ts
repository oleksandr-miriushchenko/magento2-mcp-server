import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const CATEGORY_TREE_GET_TOOL = "category_tree_get";
const CATEGORY_TREE_MAX_DEPTH = 10;
const ErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
export interface CategoryNode {
  readonly category_id: number;
  readonly parent_id: number;
  readonly name: string;
  readonly is_active: boolean;
  readonly position: number;
  readonly level: number;
  readonly product_count: number;
  readonly children: readonly CategoryNode[];
}
export const CategoryNodeSchema: z.ZodType<CategoryNode> = z.lazy(() =>
  z.strictObject({
    category_id: z.number().int().positive(),
    parent_id: z.number().int().nonnegative(),
    name: z.string().min(1),
    is_active: z.boolean(),
    position: z.number().int().nonnegative(),
    level: z.number().int().nonnegative(),
    product_count: z.number().int().nonnegative(),
    children: z.array(CategoryNodeSchema),
  }),
);
export const CategoryTreeGetInputSchema = z.strictObject({
  root_category_id: z.number().int().positive().optional(),
  depth: z
    .number()
    .int()
    .min(1)
    .max(CATEGORY_TREE_MAX_DEPTH)
    .default(CATEGORY_TREE_MAX_DEPTH)
    .describe(`Maximum tree depth. Server limit and default: ${CATEGORY_TREE_MAX_DEPTH}.`),
});
export const CategoryTreeGetOutputSchema = createToolResultSchemas(
  z.strictObject({ root: CategoryNodeSchema }),
  ErrorCodeSchema,
).output;
export type CategoryTreeGetOutput = z.infer<typeof CategoryTreeGetOutputSchema>;
