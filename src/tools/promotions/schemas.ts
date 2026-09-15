import { z } from "zod";

import { createPageInputSchema } from "../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../shared/error-codes.js";
import { createToolResultSchemas } from "../shared/result-schemas.js";

export const SALES_RULE_SEARCH_TOOL = "sales_rule_search";
export const SALES_RULE_GET_TOOL = "sales_rule_get";
export const COUPON_SEARCH_TOOL = "coupon_search";

export const SALES_RULE_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;
export const SALES_RULE_GET_ERROR_CODE = RESOURCE_ERROR_CODE;
export const COUPON_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

const SalesRuleSummarySchema = z.strictObject({
  rule_id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().nullable(),
  is_active: z.boolean(),
  from_date: z.string().nullable(),
  to_date: z.string().nullable(),
  sort_order: z.number().int(),
  simple_action: z.string().min(1),
  discount_amount: z.number(),
  coupon_type: z.string(),
  times_used: z.number().int().nonnegative(),
});

const SalesRuleSchema = SalesRuleSummarySchema.extend({
  website_ids: z.array(z.number().int().nonnegative()),
  customer_group_ids: z.array(z.number().int().nonnegative()),
  uses_per_customer: z.number().int().nonnegative(),
  uses_per_coupon: z.number().int().nonnegative(),
  stop_rules_processing: z.boolean(),
  apply_to_shipping: z.boolean(),
  use_auto_generation: z.boolean(),
  discount_quantity: z.number().nullable(),
  discount_step: z.number().int().nonnegative(),
  free_shipping_mode: z.string().nullable(),
});

const CouponSchema = z.strictObject({
  coupon_id: z.number().int().positive(),
  rule_id: z.number().int().positive(),
  code: z.string().min(1).nullable(),
  usage_limit: z.number().int().nonnegative().nullable(),
  usage_per_customer: z.number().int().nonnegative().nullable(),
  times_used: z.number().int().nonnegative(),
  expiration_date: z.string().nullable(),
  is_primary: z.boolean().nullable(),
  type: z.number().int().nullable(),
});

const SalesRuleSearchDataSchema = z.strictObject({
  rules: z.array(SalesRuleSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const SalesRuleSearchErrorCodeSchema = z.enum(SALES_RULE_SEARCH_ERROR_CODE);

export function createSalesRuleSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    name: z.string().trim().min(1).max(255).optional(),
    active: z.boolean().optional(),
    ...page.shape,
  });
}

const SalesRuleSearchResultSchemas = createToolResultSchemas(
  SalesRuleSearchDataSchema,
  SalesRuleSearchErrorCodeSchema,
);
export const SalesRuleSearchOutputSchema = SalesRuleSearchResultSchemas.output;

export const SalesRuleGetInputSchema = z.strictObject({ rule_id: z.number().int().positive() });

export const SalesRuleGetErrorCodeSchema = z.enum(SALES_RULE_GET_ERROR_CODE);

const SalesRuleGetResultSchemas = createToolResultSchemas(
  SalesRuleSchema,
  SalesRuleGetErrorCodeSchema,
);
export const SalesRuleGetOutputSchema = SalesRuleGetResultSchemas.output;

const CouponSearchDataSchema = z.strictObject({
  coupons: z.array(CouponSchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const CouponSearchErrorCodeSchema = z.enum(COUPON_SEARCH_ERROR_CODE);

export function createCouponSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    rule_id: z.number().int().positive(),
    code: z.string().trim().min(1).max(255).optional(),
    ...page.shape,
  });
}

const CouponSearchResultSchemas = createToolResultSchemas(
  CouponSearchDataSchema,
  CouponSearchErrorCodeSchema,
);
export const CouponSearchOutputSchema = CouponSearchResultSchemas.output;

export type SalesRuleSearchInputSchema = ReturnType<typeof createSalesRuleSearchInputSchema>;
export type SalesRuleSearchInput = z.infer<SalesRuleSearchInputSchema>;
export type SalesRuleSearchData = z.infer<typeof SalesRuleSearchDataSchema>;
export type SalesRuleSearchFailure = z.infer<typeof SalesRuleSearchResultSchemas.failure>;
export type SalesRuleSearchOutput = z.infer<typeof SalesRuleSearchOutputSchema>;
export type SalesRuleGetData = z.infer<typeof SalesRuleSchema>;
export type SalesRuleGetFailure = z.infer<typeof SalesRuleGetResultSchemas.failure>;
export type SalesRuleGetOutput = z.infer<typeof SalesRuleGetOutputSchema>;
export type CouponSearchInputSchema = ReturnType<typeof createCouponSearchInputSchema>;
export type CouponSearchInput = z.infer<CouponSearchInputSchema>;
export type CouponSearchData = z.infer<typeof CouponSearchDataSchema>;
export type CouponSearchFailure = z.infer<typeof CouponSearchResultSchemas.failure>;
export type CouponSearchOutput = z.infer<typeof CouponSearchOutputSchema>;
