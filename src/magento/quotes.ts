import { z } from "zod";

import type { MagentoClient } from "./client.js";
import { buildMagentoSearchParams, MAGENTO_SEARCH_CONDITION, parseMagentoPage } from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const RawQuoteSchema = z.object({
  id: z.number().int().positive(),
  store_id: z.number().int().nonnegative(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  is_active: z.boolean(),
  is_virtual: z.boolean(),
  items_count: z.number().int().nonnegative(),
  items_qty: z.number().nonnegative(),
  customer: z
    .object({
      firstname: z.string().nullish(),
      lastname: z.string().nullish(),
      email: z.string().nullish(),
    })
    .nullish(),
  currency: z.object({ quote_currency_code: z.string().regex(/^[A-Z]{3}$/) }).nullish(),
});

const RawQuoteSearchResponseSchema = z.object({
  items: z
    .array(RawQuoteSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawQuote = z.infer<typeof RawQuoteSchema>;
export type RawQuoteSearchResponse = z.infer<typeof RawQuoteSearchResponseSchema>;

export interface MagentoQuoteSearchRequest {
  readonly active: boolean;
  readonly customerId?: number;
  readonly updatedFrom?: string;
  readonly updatedTo?: string;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface QuoteSearcher {
  searchQuotes(
    request: MagentoQuoteSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawQuoteSearchResponse>;
}

const QUOTE_SEARCH_FIELDS =
  "items[id,store_id,created_at,updated_at,is_active,is_virtual,items_count,items_qty," +
  "customer[firstname,lastname,email],currency[quote_currency_code]],total_count";

export class MagentoQuotes implements QuoteSearcher {
  constructor(private readonly client: MagentoClient) {}

  async searchQuotes(
    request: MagentoQuoteSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawQuoteSearchResponse> {
    const filters = [
      {
        filters: [
          {
            field: "is_active",
            value: request.active ? 1 : 0,
            condition: MAGENTO_SEARCH_CONDITION.EQUALS,
          },
        ] as const,
      },
      ...(request.customerId === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "customer_id",
                  value: request.customerId,
                  condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                },
              ] as const,
            },
          ]),
      ...(request.updatedFrom === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "updated_at",
                  value: request.updatedFrom,
                  condition: MAGENTO_SEARCH_CONDITION.GREATER_THAN_OR_EQUAL,
                },
              ] as const,
            },
          ]),
      ...(request.updatedTo === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "updated_at",
                  value: request.updatedTo,
                  condition: MAGENTO_SEARCH_CONDITION.LESS_THAN_OR_EQUAL,
                },
              ] as const,
            },
          ]),
    ];
    const query = buildMagentoSearchParams({
      filterGroups: filters,
      sortOrders: [
        { field: "updated_at", direction: "DESC" },
        { field: "entity_id", direction: "DESC" },
      ],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: QUOTE_SEARCH_FIELDS,
    });
    const raw = await this.client.getJson(["V1", "carts", "search"], {
      signal,
      query,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    });
    return parseMagentoPage(RawQuoteSearchResponseSchema, raw, request.pageSize);
  }
}
