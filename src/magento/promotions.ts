import { z } from "zod";

import { AppError, createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import { buildMagentoSearchParams, MAGENTO_SEARCH_CONDITION, parseMagentoPage } from "./search.js";

const MagentoFlagSchema = z.boolean().or(z.literal(0)).or(z.literal(1));
const NullableDateSchema = z.string().nullish();

const RawSalesRuleSummarySchema = z.object({
  rule_id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().nullish(),
  is_active: MagentoFlagSchema,
  from_date: NullableDateSchema,
  to_date: NullableDateSchema,
  sort_order: z.number().int(),
  simple_action: z.string().min(1),
  discount_amount: z.number(),
  coupon_type: z.string().or(z.number()),
  times_used: z.number().int().nonnegative(),
});

const RawSalesRuleSchema = RawSalesRuleSummarySchema.extend({
  website_ids: z.array(z.number().int().nonnegative()),
  customer_group_ids: z.array(z.number().int().nonnegative()),
  uses_per_customer: z.number().int().nonnegative(),
  uses_per_coupon: z.number().int().nonnegative(),
  stop_rules_processing: MagentoFlagSchema,
  apply_to_shipping: MagentoFlagSchema,
  use_auto_generation: MagentoFlagSchema,
  discount_qty: z.number().nullish(),
  discount_step: z.number().int().nonnegative(),
  simple_free_shipping: z.string().or(z.number()).nullish(),
});

const RawCouponSchema = z.object({
  coupon_id: z.number().int().positive(),
  rule_id: z.number().int().positive(),
  code: z.string().min(1).nullish(),
  usage_limit: z.number().int().nonnegative().nullish(),
  usage_per_customer: z.number().int().nonnegative().nullish(),
  times_used: z.number().int().nonnegative(),
  expiration_date: z.string().nullish(),
  is_primary: MagentoFlagSchema.nullish(),
  type: z.number().int().nullish(),
});

function collectionSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z
      .array(item)
      .nullable()
      .transform((items) => items ?? []),
    total_count: z.number().int().nonnegative(),
  });
}

const RawSalesRuleSearchResponseSchema = collectionSchema(RawSalesRuleSummarySchema);
const RawCouponSearchResponseSchema = collectionSchema(RawCouponSchema);

export type RawSalesRule = z.infer<typeof RawSalesRuleSchema>;
export type RawSalesRuleSearchResponse = z.infer<typeof RawSalesRuleSearchResponseSchema>;
export type RawCouponSearchResponse = z.infer<typeof RawCouponSearchResponseSchema>;

export interface MagentoSalesRuleSearchRequest {
  readonly name?: string;
  readonly active?: boolean;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface MagentoCouponSearchRequest {
  readonly ruleId: number;
  readonly code?: string;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface PromotionReader {
  searchSalesRules(
    request: MagentoSalesRuleSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawSalesRuleSearchResponse>;
  getSalesRule(ruleId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawSalesRule>;
  searchCoupons(
    request: MagentoCouponSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCouponSearchResponse>;
}

export interface MagentoCouponGenerationSpec {
  readonly ruleId: number;
  readonly quantity: number;
  readonly length: number;
  readonly format: "alphanum" | "alpha" | "num";
  readonly prefix?: string;
  readonly suffix?: string;
  readonly delimiterAtEvery?: number;
  readonly delimiter?: string;
}

export interface PromotionWriter {
  generateCoupons(
    spec: MagentoCouponGenerationSpec,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<readonly string[]>;
}

const SALES_RULE_SUMMARY_FIELDS =
  "rule_id,name,description,is_active,from_date,to_date,sort_order,simple_action,discount_amount," +
  "coupon_type,times_used";
const SALES_RULE_FIELDS =
  `${SALES_RULE_SUMMARY_FIELDS},website_ids,customer_group_ids,uses_per_customer,uses_per_coupon,` +
  "stop_rules_processing,apply_to_shipping,use_auto_generation,discount_qty,discount_step," +
  "simple_free_shipping";
const COUPON_FIELDS =
  "coupon_id,rule_id,code,usage_limit,usage_per_customer,times_used,expiration_date,is_primary,type";

export class MagentoPromotions implements PromotionReader, PromotionWriter {
  constructor(private readonly client: MagentoClient) {}

  async searchSalesRules(
    request: MagentoSalesRuleSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawSalesRuleSearchResponse> {
    const filterGroups = [
      ...(request.name === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "name",
                  value: `%${request.name}%`,
                  condition: MAGENTO_SEARCH_CONDITION.LIKE,
                },
              ] as const,
            },
          ]),
      ...(request.active === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "is_active",
                  value: request.active ? 1 : 0,
                  condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                },
              ] as const,
            },
          ]),
    ];
    const query = buildMagentoSearchParams({
      filterGroups,
      sortOrders: [{ field: "rule_id", direction: "DESC" }],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: `items[${SALES_RULE_SUMMARY_FIELDS}],total_count`,
    });
    return this.getCollection(
      ["V1", "salesRules", "search"],
      query,
      RawSalesRuleSearchResponseSchema,
      request.pageSize,
      signal,
      onAttempt,
    );
  }

  async getSalesRule(
    ruleId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawSalesRule> {
    const query = new URLSearchParams({ fields: SALES_RULE_FIELDS });
    const raw = await this.client.getJson(["V1", "salesRules", String(ruleId)], {
      signal,
      query,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    });
    const parsed = RawSalesRuleSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((issue) => issue.path[0] === "use_auto_generation")) {
        throw new AppError(
          ERROR_CODE.UPSTREAM_INVALID_RESPONSE,
          "Magento returned a sales rule whose automatic-generation setting could not be verified.",
        );
      }
      throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    }
    return parsed.data;
  }

  async searchCoupons(
    request: MagentoCouponSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCouponSearchResponse> {
    const filterGroups = [
      {
        filters: [
          {
            field: "rule_id",
            value: request.ruleId,
            condition: MAGENTO_SEARCH_CONDITION.EQUALS,
          },
        ] as const,
      },
      ...(request.code === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "code",
                  value: request.code,
                  condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                },
              ] as const,
            },
          ]),
    ];
    const query = buildMagentoSearchParams({
      filterGroups,
      sortOrders: [{ field: "coupon_id", direction: "DESC" }],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: `items[${COUPON_FIELDS}],total_count`,
    });
    return this.getCollection(
      ["V1", "coupons", "search"],
      query,
      RawCouponSearchResponseSchema,
      request.pageSize,
      signal,
      onAttempt,
    );
  }

  async generateCoupons(
    spec: MagentoCouponGenerationSpec,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<readonly string[]> {
    const raw = await this.client.postJson(
      ["V1", "coupons", "generate"],
      {
        couponSpec: {
          rule_id: spec.ruleId,
          quantity: spec.quantity,
          length: spec.length,
          format: spec.format,
          ...(spec.prefix === undefined ? {} : { prefix: spec.prefix }),
          ...(spec.suffix === undefined ? {} : { suffix: spec.suffix }),
          ...(spec.delimiterAtEvery === undefined
            ? {}
            : { delimiter_at_every: spec.delimiterAtEvery }),
          ...(spec.delimiter === undefined ? {} : { delimiter: spec.delimiter }),
        },
      },
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    const parsed = z.array(z.string().min(1).max(255)).length(spec.quantity).safeParse(raw);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    return parsed.data;
  }

  private async getCollection<T extends { readonly items: readonly unknown[] }>(
    path: readonly [string, ...string[]],
    query: URLSearchParams,
    schema: z.ZodType<T>,
    pageSize: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<T> {
    const raw = await this.client.getJson(path, {
      signal,
      query,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    });
    return parseMagentoPage(schema, raw, pageSize);
  }
}
