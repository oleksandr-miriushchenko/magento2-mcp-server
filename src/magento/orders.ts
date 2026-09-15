import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
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

const MagentoFlagSchema = z.boolean().or(z.literal(0)).or(z.literal(1));

const RawAddressSchema = z.object({
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  company: z.string().nullish(),
  street: z.array(z.string()).nullish(),
  city: z.string().nullish(),
  region: z.string().nullish(),
  postcode: z.string().nullish(),
  country_id: z.string().nullish(),
  telephone: z.string().nullish(),
  email: z.string().nullish(),
});

const RawOrderItemSchema = z.object({
  item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  qty_ordered: z.number().nonnegative(),
  qty_invoiced: z.number().nonnegative(),
  qty_shipped: z.number().nonnegative(),
  qty_canceled: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
});

const RawHistorySchema = z.object({
  entity_id: z.number().int().positive(),
  created_at: MagentoDateTimeSchema,
  status: z.string().nullish(),
  is_customer_notified: MagentoFlagSchema.nullish(),
  is_visible_on_front: MagentoFlagSchema,
  comment: z.string().nullish(),
});

const RawPaymentSchema = z.object({
  method: z.string().min(1).nullish(),
});

const RawOrderSearchItemSchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  store_id: z.number().int().nonnegative(),
  status: z.string().min(1).nullish(),
  state: z.string().min(1).nullish(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  order_currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
  total_paid: z.number().nullish(),
  total_refunded: z.number().nullish(),
  total_item_count: z.number().int().nonnegative(),
  customer_is_guest: MagentoFlagSchema,
  customer_firstname: z.string().nullish(),
  customer_lastname: z.string().nullish(),
  customer_email: z.string().nullish(),
});

const RawOrderSearchResponseSchema = z.object({
  // Magento's sparse fields filter serializes an empty collection as null.
  items: z
    .array(RawOrderSearchItemSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export const RawOrderSchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  store_id: z.number().int().nonnegative(),
  status: z.string().min(1).nullish(),
  state: z.string().min(1).nullish(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  order_currency_code: z.string().regex(/^[A-Z]{3}$/),
  subtotal: z.number(),
  discount_amount: z.number(),
  shipping_amount: z.number(),
  tax_amount: z.number(),
  grand_total: z.number(),
  total_paid: z.number().nullish(),
  total_refunded: z.number().nullish(),
  customer_is_guest: MagentoFlagSchema,
  customer_firstname: z.string().nullish(),
  customer_lastname: z.string().nullish(),
  customer_email: z.string().nullish(),
  billing_address: RawAddressSchema.nullish(),
  extension_attributes: z
    .object({
      shipping_assignments: z
        .array(
          z.object({
            shipping: z.object({ address: RawAddressSchema.nullish() }).nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
  items: z.array(RawOrderItemSchema),
  status_histories: z.array(RawHistorySchema),
  payment: RawPaymentSchema.nullish(),
});

export type RawOrder = z.infer<typeof RawOrderSchema>;
export type RawOrderSearchItem = z.infer<typeof RawOrderSearchItemSchema>;
export type RawOrderSearchResponse = z.infer<typeof RawOrderSearchResponseSchema>;

export const MAGENTO_ORDER_SEARCH_SORT = {
  CREATED_DESCENDING: "created_descending",
  CREATED_ASCENDING: "created_ascending",
  TOTAL_DESCENDING: "total_descending",
  TOTAL_ASCENDING: "total_ascending",
} as const;

export type MagentoOrderSearchSort =
  (typeof MAGENTO_ORDER_SEARCH_SORT)[keyof typeof MAGENTO_ORDER_SEARCH_SORT];

export interface MagentoOrderSearchRequest {
  readonly incrementId?: string;
  readonly customerEmail?: string;
  readonly customerId?: number;
  readonly status?: string;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly grandTotalMin?: number;
  readonly grandTotalMax?: number;
  readonly sort: MagentoOrderSearchSort;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface OrderReader {
  getOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawOrder>;
}

export interface OrderCommentWriter {
  addComment(
    orderId: number,
    comment: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void>;
}

export interface OrderSearcher {
  searchOrders(
    request: MagentoOrderSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawOrderSearchResponse>;
}

const ORDER_FIELD = {
  ENTITY_ID: "entity_id",
  INCREMENT_ID: "increment_id",
  CUSTOMER_EMAIL: "customer_email",
  CUSTOMER_ID: "customer_id",
  STATUS: "status",
  CREATED_AT: "created_at",
  GRAND_TOTAL: "grand_total",
} as const;

const ORDER_SEARCH_FIELDS =
  "items[entity_id,increment_id,store_id,status,state,created_at,updated_at," +
  "order_currency_code,grand_total,total_paid,total_refunded,total_item_count," +
  "customer_is_guest,customer_firstname,customer_lastname,customer_email],total_count";

function orderSortOrders(
  sort: MagentoOrderSearchSort,
): readonly [MagentoSearchSortOrder, ...MagentoSearchSortOrder[]] {
  switch (sort) {
    case MAGENTO_ORDER_SEARCH_SORT.CREATED_DESCENDING:
      return [
        { field: ORDER_FIELD.CREATED_AT, direction: "DESC" },
        { field: ORDER_FIELD.ENTITY_ID, direction: "DESC" },
      ];
    case MAGENTO_ORDER_SEARCH_SORT.CREATED_ASCENDING:
      return [
        { field: ORDER_FIELD.CREATED_AT, direction: "ASC" },
        { field: ORDER_FIELD.ENTITY_ID, direction: "ASC" },
      ];
    case MAGENTO_ORDER_SEARCH_SORT.TOTAL_DESCENDING:
      return [
        { field: ORDER_FIELD.GRAND_TOTAL, direction: "DESC" },
        { field: ORDER_FIELD.ENTITY_ID, direction: "DESC" },
      ];
    case MAGENTO_ORDER_SEARCH_SORT.TOTAL_ASCENDING:
      return [
        { field: ORDER_FIELD.GRAND_TOTAL, direction: "ASC" },
        { field: ORDER_FIELD.ENTITY_ID, direction: "ASC" },
      ];
  }
}

function orderFilterGroups(request: MagentoOrderSearchRequest): MagentoSearchFilterGroup[] {
  const groups: MagentoSearchFilterGroup[] = [];
  const add = (
    field: (typeof ORDER_FIELD)[keyof typeof ORDER_FIELD],
    value: string | number | undefined,
    condition: MagentoSearchCondition = MAGENTO_SEARCH_CONDITION.EQUALS,
  ): void => {
    if (value !== undefined) groups.push({ filters: [{ field, value, condition }] });
  };

  add(ORDER_FIELD.INCREMENT_ID, request.incrementId);
  add(ORDER_FIELD.CUSTOMER_EMAIL, request.customerEmail);
  add(ORDER_FIELD.CUSTOMER_ID, request.customerId);
  add(ORDER_FIELD.STATUS, request.status);
  add(ORDER_FIELD.CREATED_AT, request.createdFrom, MAGENTO_SEARCH_CONDITION.GREATER_THAN_OR_EQUAL);
  add(ORDER_FIELD.CREATED_AT, request.createdTo, MAGENTO_SEARCH_CONDITION.LESS_THAN_OR_EQUAL);
  add(
    ORDER_FIELD.GRAND_TOTAL,
    request.grandTotalMin,
    MAGENTO_SEARCH_CONDITION.GREATER_THAN_OR_EQUAL,
  );
  add(ORDER_FIELD.GRAND_TOTAL, request.grandTotalMax, MAGENTO_SEARCH_CONDITION.LESS_THAN_OR_EQUAL);
  return groups;
}

export class MagentoOrders implements OrderReader, OrderCommentWriter, OrderSearcher {
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async getOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawOrder> {
    const json = await this.#client.getJson(
      ["V1", "orders", String(orderId)],
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    const parsed = RawOrderSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async searchOrders(
    request: MagentoOrderSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawOrderSearchResponse> {
    const query = buildMagentoSearchParams({
      filterGroups: orderFilterGroups(request),
      sortOrders: orderSortOrders(request.sort),
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: ORDER_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "orders"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawOrderSearchResponseSchema, json, request.pageSize);
  }

  async addComment(
    orderId: number,
    comment: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    const json = await this.#client.postJson(
      ["V1", "orders", String(orderId), "comments"],
      {
        statusHistory: {
          comment,
          is_customer_notified: 0,
          is_visible_on_front: 0,
        },
      },
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    if (!z.literal(true).safeParse(json).success) {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }
  }
}
