import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../shared/error-codes.js";
import { createToolResultSchemas } from "../shared/result-schemas.js";

export const STORE_HIERARCHY_GET_TOOL = "store_hierarchy_get";
export const STORE_HIERARCHY_GET_ERROR_CODE = RESOURCE_ERROR_CODE;

const StoreViewSchema = z.strictObject({
  store_view_id: z.number().int().nonnegative(),
  code: z.string().min(1),
  name: z.string().min(1),
  is_active: z.boolean(),
});

const StoreGroupSchema = z.strictObject({
  store_group_id: z.number().int().nonnegative(),
  name: z.string().min(1),
  root_category_id: z.number().int().nonnegative(),
  default_store_view_id: z.number().int().nonnegative(),
  store_views: z.array(StoreViewSchema),
});

const WebsiteSchema = z.strictObject({
  website_id: z.number().int().nonnegative(),
  code: z.string().min(1),
  name: z.string().min(1),
  default_store_group_id: z.number().int().nonnegative(),
  store_groups: z.array(StoreGroupSchema),
});

const StoreHierarchyDataSchema = z.strictObject({ websites: z.array(WebsiteSchema) });

export const StoreHierarchyGetErrorCodeSchema = z.enum(STORE_HIERARCHY_GET_ERROR_CODE);

export const StoreHierarchyGetInputSchema = z.strictObject({});
const StoreHierarchyGetResultSchemas = createToolResultSchemas(
  StoreHierarchyDataSchema,
  StoreHierarchyGetErrorCodeSchema,
);
export const StoreHierarchyGetOutputSchema = StoreHierarchyGetResultSchemas.output;

export type StoreHierarchyData = z.infer<typeof StoreHierarchyDataSchema>;
export type StoreHierarchyGetFailure = z.infer<typeof StoreHierarchyGetResultSchemas.failure>;
export type StoreHierarchyGetOutput = z.infer<typeof StoreHierarchyGetOutputSchema>;
