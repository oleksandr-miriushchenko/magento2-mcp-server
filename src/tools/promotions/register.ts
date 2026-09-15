import { AUDIT_TOOL } from "../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../core/errors.js";
import { createSearchCursorCodec } from "../../core/search-cursor.js";
import { MagentoPromotions, type RawSalesRule } from "../../magento/promotions.js";
import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { createReadHandler, defaultReadFailure } from "../shared/read-handler.js";
import { registerCouponGenerate } from "./coupon-generate/register.js";
import {
  COUPON_SEARCH_TOOL,
  type CouponSearchData,
  type CouponSearchFailure,
  type CouponSearchInput,
  CouponSearchOutputSchema,
  SALES_RULE_GET_TOOL,
  SALES_RULE_SEARCH_TOOL,
  type SalesRuleGetData,
  type SalesRuleGetFailure,
  SalesRuleGetInputSchema,
  SalesRuleGetOutputSchema,
  type SalesRuleSearchData,
  type SalesRuleSearchFailure,
  type SalesRuleSearchInput,
  SalesRuleSearchOutputSchema,
  createCouponSearchInputSchema,
  createSalesRuleSearchInputSchema,
} from "./schemas.js";

function flag(value: boolean | 0 | 1): boolean {
  return value === true || value === 1;
}

function internalError() {
  return createAppError(ERROR_CODE.INTERNAL_ERROR);
}

function ruleSearchInternal(): SalesRuleSearchFailure {
  const error = internalError();
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}
function ruleGetInternal(): SalesRuleGetFailure {
  const error = internalError();
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}
function couponInternal(): CouponSearchFailure {
  const error = internalError();
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}

function mapRuleSummary(rule: RawSalesRuleSearchItem): SalesRuleSearchData["rules"][number] {
  return {
    rule_id: rule.rule_id,
    name: rule.name,
    description: rule.description ?? null,
    is_active: flag(rule.is_active),
    from_date: rule.from_date ?? null,
    to_date: rule.to_date ?? null,
    sort_order: rule.sort_order,
    simple_action: rule.simple_action,
    discount_amount: rule.discount_amount,
    coupon_type: String(rule.coupon_type),
    times_used: rule.times_used,
  };
}

type RawSalesRuleSearchItem = Awaited<
  ReturnType<MagentoPromotions["searchSalesRules"]>
>["items"][number];

function mapRule(rule: RawSalesRule): SalesRuleGetData {
  return {
    ...mapRuleSummary(rule),
    website_ids: rule.website_ids,
    customer_group_ids: rule.customer_group_ids,
    uses_per_customer: rule.uses_per_customer,
    uses_per_coupon: rule.uses_per_coupon,
    stop_rules_processing: flag(rule.stop_rules_processing),
    apply_to_shipping: flag(rule.apply_to_shipping),
    use_auto_generation: flag(rule.use_auto_generation),
    discount_quantity: rule.discount_qty ?? null,
    discount_step: rule.discount_step,
    free_shipping_mode:
      rule.simple_free_shipping == null ? null : String(rule.simple_free_shipping),
  };
}

function searchCriteria(input: SalesRuleSearchInput): unknown {
  return { name: input.name ?? null, active: input.active ?? null, page_size: input.page_size };
}
function couponCriteria(input: CouponSearchInput): unknown {
  return { rule_id: input.rule_id, code: input.code ?? null, page_size: input.page_size };
}

export function registerPromotionTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const promotions = new MagentoPromotions(dependencies.client);
  const ruleCursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: SALES_RULE_SEARCH_TOOL,
  });
  const couponCursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: COUPON_SEARCH_TOOL,
  });
  const ruleSearchInputSchema = createSalesRuleSearchInputSchema(dependencies.maxPageSize);
  const couponSearchInputSchema = createCouponSearchInputSchema(dependencies.maxPageSize);

  registerTool(
    SALES_RULE_SEARCH_TOOL,
    {
      title: "Search Magento Sales Rules",
      description: "Search cart price rules by name or active state.",
      annotations: { readOnlyHint: true },
      inputSchema: ruleSearchInputSchema,
      outputSchema: SalesRuleSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.SALES_RULE_SEARCH,
      inputSchema: ruleSearchInputSchema,
      outputSchema: SalesRuleSearchOutputSchema,
      internalFailure: ruleSearchInternal,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => {
        const criteria = searchCriteria(input);
        const currentPage =
          input.cursor === undefined ? 1 : ruleCursor.decode(input.cursor, criteria);
        const response = await promotions.searchSalesRules(
          {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.active === undefined ? {} : { active: input.active }),
            pageSize: input.page_size,
            currentPage,
          },
          signal,
          onAttempt,
        );
        return {
          ok: true,
          data: {
            rules: response.items.map(mapRuleSummary),
            total_count: response.total_count,
            page_size: input.page_size,
            next_cursor:
              response.items.length > 0 && currentPage * input.page_size < response.total_count
                ? ruleCursor.encode(currentPage + 1, criteria)
                : null,
          },
        };
      },
    }),
  );

  registerTool(
    SALES_RULE_GET_TOOL,
    {
      title: "Get Magento Sales Rule",
      description: "Get one cart price rule by numeric entity ID.",
      annotations: { readOnlyHint: true },
      inputSchema: SalesRuleGetInputSchema,
      outputSchema: SalesRuleGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.SALES_RULE_GET,
      inputSchema: SalesRuleGetInputSchema,
      outputSchema: SalesRuleGetOutputSchema,
      internalFailure: ruleGetInternal,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => ({
        ok: true,
        data: mapRule(await promotions.getSalesRule(input.rule_id, signal, onAttempt)),
      }),
    }),
  );

  registerTool(
    COUPON_SEARCH_TOOL,
    {
      title: "Search Magento Coupons",
      description: "Search generated coupons for one cart price rule.",
      annotations: { readOnlyHint: true },
      inputSchema: couponSearchInputSchema,
      outputSchema: CouponSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.COUPON_SEARCH,
      inputSchema: couponSearchInputSchema,
      outputSchema: CouponSearchOutputSchema,
      internalFailure: couponInternal,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => {
        const criteria = couponCriteria(input);
        const currentPage =
          input.cursor === undefined ? 1 : couponCursor.decode(input.cursor, criteria);
        const response = await promotions.searchCoupons(
          {
            ruleId: input.rule_id,
            ...(input.code === undefined ? {} : { code: input.code }),
            pageSize: input.page_size,
            currentPage,
          },
          signal,
          onAttempt,
        );
        const data: CouponSearchData = {
          coupons: response.items.map((coupon) => ({
            coupon_id: coupon.coupon_id,
            rule_id: coupon.rule_id,
            code: coupon.code ?? null,
            usage_limit: coupon.usage_limit ?? null,
            usage_per_customer: coupon.usage_per_customer ?? null,
            times_used: coupon.times_used,
            expiration_date: coupon.expiration_date ?? null,
            is_primary: coupon.is_primary == null ? null : flag(coupon.is_primary),
            type: coupon.type ?? null,
          })),
          total_count: response.total_count,
          page_size: input.page_size,
          next_cursor:
            response.items.length > 0 && currentPage * input.page_size < response.total_count
              ? couponCursor.encode(currentPage + 1, criteria)
              : null,
        };
        return { ok: true, data };
      },
    }),
  );

  registerCouponGenerate(registerTool, dependencies);
}
