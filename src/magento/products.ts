import { z } from "zod";

import type { MagentoClient } from "./client.js";
import {
  buildMagentoSearchParams,
  MAGENTO_SEARCH_CONDITION,
  parseMagentoPage,
  type MagentoSearchCondition,
  type MagentoSearchFilterGroup,
  type MagentoSearchSortOrder,
} from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const RawProductSearchItemSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  attribute_set_id: z.number().int().positive(),
  price: z.number().nullable(),
  status: z.union([z.literal(1), z.literal(2)]),
  visibility: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  type_id: z.string().min(1),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
});

const RawProductSearchResponseSchema = z.object({
  // Magento's sparse fields filter serializes an empty collection as null.
  items: z
    .array(RawProductSearchItemSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawProductSearchItem = z.infer<typeof RawProductSearchItemSchema>;
export type RawProductSearchResponse = z.infer<typeof RawProductSearchResponseSchema>;

export const MAGENTO_PRODUCT_SEARCH_SORT = {
  CREATED_DESCENDING: "created_descending",
  CREATED_ASCENDING: "created_ascending",
  NAME_ASCENDING: "name_ascending",
  NAME_DESCENDING: "name_descending",
  PRICE_ASCENDING: "price_ascending",
  PRICE_DESCENDING: "price_descending",
} as const;

export type MagentoProductSearchSort =
  (typeof MAGENTO_PRODUCT_SEARCH_SORT)[keyof typeof MAGENTO_PRODUCT_SEARCH_SORT];

export interface MagentoProductSearchRequest {
  readonly search?: string;
  readonly sku?: string;
  readonly status?: 1 | 2;
  readonly visibility?: 1 | 2 | 3 | 4;
  readonly productType?: string;
  readonly priceMin?: number;
  readonly priceMax?: number;
  readonly sort: MagentoProductSearchSort;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface ProductSearcher {
  searchProducts(
    request: MagentoProductSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductSearchResponse>;
}

const PRODUCT_FIELD = {
  ENTITY_ID: "entity_id",
  SKU: "sku",
  NAME: "name",
  STATUS: "status",
  VISIBILITY: "visibility",
  TYPE_ID: "type_id",
  PRICE: "price",
  CREATED_AT: "created_at",
} as const;

const PRODUCT_SEARCH_FIELDS =
  "items[id,sku,name,attribute_set_id,price,status,visibility,type_id,created_at,updated_at]," +
  "total_count";

function productSortOrders(
  sort: MagentoProductSearchSort,
): readonly [MagentoSearchSortOrder, ...MagentoSearchSortOrder[]] {
  switch (sort) {
    case MAGENTO_PRODUCT_SEARCH_SORT.CREATED_DESCENDING:
      return [
        { field: PRODUCT_FIELD.CREATED_AT, direction: "DESC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "DESC" },
      ];
    case MAGENTO_PRODUCT_SEARCH_SORT.CREATED_ASCENDING:
      return [
        { field: PRODUCT_FIELD.CREATED_AT, direction: "ASC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "ASC" },
      ];
    case MAGENTO_PRODUCT_SEARCH_SORT.NAME_ASCENDING:
      return [
        { field: PRODUCT_FIELD.NAME, direction: "ASC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "ASC" },
      ];
    case MAGENTO_PRODUCT_SEARCH_SORT.NAME_DESCENDING:
      return [
        { field: PRODUCT_FIELD.NAME, direction: "DESC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "DESC" },
      ];
    case MAGENTO_PRODUCT_SEARCH_SORT.PRICE_ASCENDING:
      return [
        { field: PRODUCT_FIELD.PRICE, direction: "ASC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "ASC" },
      ];
    case MAGENTO_PRODUCT_SEARCH_SORT.PRICE_DESCENDING:
      return [
        { field: PRODUCT_FIELD.PRICE, direction: "DESC" },
        { field: PRODUCT_FIELD.ENTITY_ID, direction: "DESC" },
      ];
  }
}

function productFilterGroups(request: MagentoProductSearchRequest): MagentoSearchFilterGroup[] {
  const groups: MagentoSearchFilterGroup[] = [];
  if (request.search !== undefined) {
    const value = `%${request.search}%`;
    groups.push({
      filters: [
        { field: PRODUCT_FIELD.NAME, value, condition: MAGENTO_SEARCH_CONDITION.LIKE },
        { field: PRODUCT_FIELD.SKU, value, condition: MAGENTO_SEARCH_CONDITION.LIKE },
      ],
    });
  }
  const add = (
    field: (typeof PRODUCT_FIELD)[keyof typeof PRODUCT_FIELD],
    value: string | number | undefined,
    condition: MagentoSearchCondition = MAGENTO_SEARCH_CONDITION.EQUALS,
  ): void => {
    if (value !== undefined) groups.push({ filters: [{ field, value, condition }] });
  };
  add(PRODUCT_FIELD.SKU, request.sku);
  add(PRODUCT_FIELD.STATUS, request.status);
  add(PRODUCT_FIELD.VISIBILITY, request.visibility);
  add(PRODUCT_FIELD.TYPE_ID, request.productType);
  add(PRODUCT_FIELD.PRICE, request.priceMin, MAGENTO_SEARCH_CONDITION.GREATER_THAN_OR_EQUAL);
  add(PRODUCT_FIELD.PRICE, request.priceMax, MAGENTO_SEARCH_CONDITION.LESS_THAN_OR_EQUAL);
  return groups;
}

export class MagentoProducts implements ProductSearcher {
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async searchProducts(
    request: MagentoProductSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductSearchResponse> {
    const query = buildMagentoSearchParams({
      filterGroups: productFilterGroups(request),
      sortOrders: productSortOrders(request.sort),
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: PRODUCT_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "products"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawProductSearchResponseSchema, json, request.pageSize);
  }
}
