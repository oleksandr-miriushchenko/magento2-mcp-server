import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import {
  buildMagentoSearchParams,
  MAGENTO_SEARCH_CONDITION,
  parseMagentoPage,
  type MagentoSearchFilterGroup,
  type MagentoSearchSortOrder,
} from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const RawCustomerAddressSchema = z.object({
  id: z.number().int().positive(),
  customer_id: z.number().int().positive().optional(),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  company: z.string().nullish(),
  street: z.array(z.string()).nullish(),
  city: z.string().nullish(),
  region: z
    .object({
      region_code: z.string().nullish(),
      region: z.string().nullish(),
      region_id: z.number().int().nonnegative().nullish(),
    })
    .nullish(),
  region_id: z.number().int().nonnegative().nullish(),
  postcode: z.string().nullish(),
  country_id: z.string().nullish(),
  telephone: z.string().nullish(),
  default_shipping: z.boolean().nullish(),
  default_billing: z.boolean().nullish(),
});

const RawCustomerSummarySchema = z.object({
  id: z.number().int().positive(),
  group_id: z.number().int().nonnegative(),
  store_id: z.number().int().nonnegative(),
  website_id: z.number().int().nonnegative(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  email: z.string().min(1),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
});

const RawCustomerSchema = RawCustomerSummarySchema.extend({
  default_billing: z.string().nullish(),
  default_shipping: z.string().nullish(),
  addresses: z
    .array(RawCustomerAddressSchema)
    .nullable()
    .default([])
    .transform((addresses) => addresses ?? []),
});

const RawCustomerSearchResponseSchema = z.object({
  items: z
    .array(RawCustomerSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawCustomerGroupSchema = z.object({
  id: z.number().int().nonnegative(),
  code: z.string().min(1),
  tax_class_id: z.number().int().nonnegative(),
});

const RawCustomerGroupSearchResponseSchema = z.object({
  items: z
    .array(RawCustomerGroupSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawCustomer = z.infer<typeof RawCustomerSchema>;
export type RawCustomerSummary = z.infer<typeof RawCustomerSummarySchema>;
export type RawCustomerSearchResponse = z.infer<typeof RawCustomerSearchResponseSchema>;
export type RawCustomerGroup = z.infer<typeof RawCustomerGroupSchema>;
export type RawCustomerGroupSearchResponse = z.infer<typeof RawCustomerGroupSearchResponseSchema>;

export const MAGENTO_CUSTOMER_SORT = {
  CREATED_DESCENDING: "created_descending",
  CREATED_ASCENDING: "created_ascending",
  NAME_ASCENDING: "name_ascending",
  NAME_DESCENDING: "name_descending",
} as const;

export type MagentoCustomerSort =
  (typeof MAGENTO_CUSTOMER_SORT)[keyof typeof MAGENTO_CUSTOMER_SORT];

export interface MagentoCustomerSearchRequest {
  readonly customerId?: number;
  readonly email?: string;
  readonly name?: string;
  readonly groupId?: number;
  readonly websiteId?: number;
  readonly sort: MagentoCustomerSort;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface MagentoCustomerGroupSearchRequest {
  readonly code?: string;
  readonly sort: "id_ascending" | "name_ascending" | "name_descending";
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface CustomerReader {
  getCustomer(
    customerId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomer>;
}

export interface CustomerSearcher {
  searchCustomers(
    request: MagentoCustomerSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomerSearchResponse>;
}

export interface CustomerGroupSearcher {
  searchCustomerGroups(
    request: MagentoCustomerGroupSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomerGroupSearchResponse>;
}

const CUSTOMER_FIELD = {
  ID: "id",
  EMAIL: "email",
  FIRST_NAME: "firstname",
  LAST_NAME: "lastname",
  GROUP_ID: "group_id",
  WEBSITE_ID: "website_id",
  CREATED_AT: "created_at",
} as const;

const CUSTOMER_SEARCH_FIELDS =
  "items[id,group_id,store_id,website_id,created_at,updated_at,email,firstname,lastname]," +
  "total_count";
const CUSTOMER_GET_FIELDS =
  "id,group_id,store_id,website_id,created_at,updated_at,email,firstname,lastname," +
  "default_billing,default_shipping,addresses[id,customer_id,firstname,lastname,company,street," +
  "city,region[region_code,region,region_id],region_id,postcode,country_id,telephone," +
  "default_shipping,default_billing]";
const CUSTOMER_GROUP_FIELDS = "items[id,code,tax_class_id],total_count";

function customerSortOrders(
  sort: MagentoCustomerSort,
): readonly [MagentoSearchSortOrder, ...MagentoSearchSortOrder[]] {
  switch (sort) {
    case MAGENTO_CUSTOMER_SORT.CREATED_DESCENDING:
      return [
        { field: CUSTOMER_FIELD.CREATED_AT, direction: "DESC" },
        { field: CUSTOMER_FIELD.ID, direction: "DESC" },
      ];
    case MAGENTO_CUSTOMER_SORT.CREATED_ASCENDING:
      return [
        { field: CUSTOMER_FIELD.CREATED_AT, direction: "ASC" },
        { field: CUSTOMER_FIELD.ID, direction: "ASC" },
      ];
    case MAGENTO_CUSTOMER_SORT.NAME_ASCENDING:
      return [
        { field: CUSTOMER_FIELD.LAST_NAME, direction: "ASC" },
        { field: CUSTOMER_FIELD.ID, direction: "ASC" },
      ];
    case MAGENTO_CUSTOMER_SORT.NAME_DESCENDING:
      return [
        { field: CUSTOMER_FIELD.LAST_NAME, direction: "DESC" },
        { field: CUSTOMER_FIELD.ID, direction: "DESC" },
      ];
  }
}

function customerFilters(request: MagentoCustomerSearchRequest): MagentoSearchFilterGroup[] {
  const groups: MagentoSearchFilterGroup[] = [];
  if (request.name !== undefined) {
    const value = `%${request.name}%`;
    groups.push({
      filters: [
        { field: CUSTOMER_FIELD.FIRST_NAME, value, condition: MAGENTO_SEARCH_CONDITION.LIKE },
        { field: CUSTOMER_FIELD.LAST_NAME, value, condition: MAGENTO_SEARCH_CONDITION.LIKE },
      ],
    });
  }
  const add = (
    field: (typeof CUSTOMER_FIELD)[keyof typeof CUSTOMER_FIELD],
    value: string | number | undefined,
  ): void => {
    if (value !== undefined) {
      groups.push({ filters: [{ field, value, condition: MAGENTO_SEARCH_CONDITION.EQUALS }] });
    }
  };
  add(CUSTOMER_FIELD.ID, request.customerId);
  add(CUSTOMER_FIELD.EMAIL, request.email);
  add(CUSTOMER_FIELD.GROUP_ID, request.groupId);
  add(CUSTOMER_FIELD.WEBSITE_ID, request.websiteId);
  return groups;
}

export class MagentoCustomers implements CustomerReader, CustomerSearcher, CustomerGroupSearcher {
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async getCustomer(
    customerId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomer> {
    const query = new URLSearchParams({ fields: CUSTOMER_GET_FIELDS });
    const json = await this.#client.getJson(
      ["V1", "customers", String(customerId)],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    const parsed = RawCustomerSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async searchCustomers(
    request: MagentoCustomerSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomerSearchResponse> {
    const query = buildMagentoSearchParams({
      filterGroups: customerFilters(request),
      sortOrders: customerSortOrders(request.sort),
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: CUSTOMER_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "customers", "search"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawCustomerSearchResponseSchema, json, request.pageSize);
  }

  async searchCustomerGroups(
    request: MagentoCustomerGroupSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCustomerGroupSearchResponse> {
    const filters: MagentoSearchFilterGroup[] = [];
    if (request.code !== undefined) {
      filters.push({
        filters: [
          {
            field: "code",
            value: `%${request.code}%`,
            condition: MAGENTO_SEARCH_CONDITION.LIKE,
          },
        ],
      });
    }
    const primary = request.sort === "id_ascending" ? "id" : "code";
    const direction = request.sort === "name_descending" ? "DESC" : "ASC";
    const query = buildMagentoSearchParams({
      filterGroups: filters,
      sortOrders: [
        { field: primary, direction },
        ...(primary === "id" ? [] : [{ field: "id", direction: "ASC" as const }]),
      ],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: CUSTOMER_GROUP_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "customerGroups", "search"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawCustomerGroupSearchResponseSchema, json, request.pageSize);
  }
}
