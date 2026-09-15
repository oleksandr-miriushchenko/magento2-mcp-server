import { z } from "zod";

import type { MagentoClient } from "./client.js";
import { buildMagentoSearchParams, MAGENTO_SEARCH_CONDITION, parseMagentoPage } from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const RawAnalyticsOrderSchema = z.object({
  entity_id: z.number().int().positive(),
  created_at: MagentoDateTimeSchema,
  order_currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
  total_paid: z.number().nullish(),
  total_refunded: z.number().nullish(),
});

const RawAnalyticsPageSchema = z.object({
  items: z
    .array(RawAnalyticsOrderSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawAnalyticsOrder = z.infer<typeof RawAnalyticsOrderSchema>;

export interface MagentoAnalyticsRequest {
  readonly createdFrom: string;
  readonly createdTo: string;
  readonly status?: string;
}

export interface RawAnalyticsResult {
  readonly orders: readonly RawAnalyticsOrder[];
  readonly totalCount: number;
  readonly isComplete: boolean;
}

export interface AnalyticsReader {
  getOrders(
    request: MagentoAnalyticsRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawAnalyticsResult>;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const ANALYTICS_FIELDS =
  "items[entity_id,created_at,order_currency_code,grand_total,total_paid,total_refunded],total_count";

export class MagentoAnalytics implements AnalyticsReader {
  constructor(private readonly client: MagentoClient) {}

  async getOrders(
    request: MagentoAnalyticsRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawAnalyticsResult> {
    const orders: RawAnalyticsOrder[] = [];
    let totalCount = 0;
    for (let currentPage = 1; currentPage <= MAX_PAGES; currentPage += 1) {
      const filterGroups = [
        {
          filters: [
            {
              field: "created_at",
              value: request.createdFrom,
              condition: MAGENTO_SEARCH_CONDITION.GREATER_THAN_OR_EQUAL,
            },
          ] as const,
        },
        {
          filters: [
            {
              field: "created_at",
              value: request.createdTo,
              condition: MAGENTO_SEARCH_CONDITION.LESS_THAN_OR_EQUAL,
            },
          ] as const,
        },
        ...(request.status === undefined
          ? []
          : [
              {
                filters: [
                  {
                    field: "status",
                    value: request.status,
                    condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                  },
                ] as const,
              },
            ]),
      ];
      const query = buildMagentoSearchParams({
        filterGroups,
        sortOrders: [{ field: "entity_id", direction: "ASC" }],
        pageSize: PAGE_SIZE,
        currentPage,
        fields: ANALYTICS_FIELDS,
      });
      const raw = await this.client.getJson(["V1", "orders"], {
        signal,
        query,
        ...(onAttempt === undefined ? {} : { onAttempt }),
      });
      const page = parseMagentoPage(RawAnalyticsPageSchema, raw, PAGE_SIZE);
      totalCount = page.total_count;
      orders.push(...page.items);
      if (orders.length >= totalCount || page.items.length === 0) break;
    }
    return { orders, totalCount, isComplete: orders.length >= totalCount };
  }
}
