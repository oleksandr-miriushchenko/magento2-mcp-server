import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import {
  buildMagentoSearchParams,
  MAGENTO_SEARCH_CONDITION,
  parseMagentoPage,
  type MagentoSearchCondition,
  type MagentoSearchFilterGroup,
} from "./search.js";

const RawInventorySourceSchema = z.object({
  source_code: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  description: z.string().nullish(),
  country_id: z.string().nullish(),
});

const RawInventorySourceSearchResponseSchema = z.object({
  items: z
    .array(RawInventorySourceSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawSalesChannelSchema = z.object({
  type: z.string().min(1),
  code: z.string().min(1),
});

const RawInventoryStockSchema = z.object({
  stock_id: z.number().int().positive(),
  name: z.string().min(1),
  extension_attributes: z
    .object({ sales_channels: z.array(RawSalesChannelSchema).nullish() })
    .nullish(),
});

const RawInventoryStockSearchResponseSchema = z.object({
  items: z
    .array(RawInventoryStockSchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawSalableQuantitySchema = z.number();
const RawSalableSchema = z.boolean();

export type RawInventorySource = z.infer<typeof RawInventorySourceSchema>;
export type RawInventorySourceSearchResponse = z.infer<
  typeof RawInventorySourceSearchResponseSchema
>;
export type RawInventoryStock = z.infer<typeof RawInventoryStockSchema>;
export type RawInventoryStockSearchResponse = z.infer<typeof RawInventoryStockSearchResponseSchema>;

export interface InventoryReader {
  getInventory(
    sku: string,
    stockId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<{ readonly salableQuantity: number; readonly salable: boolean }>;
}

export interface MagentoInventorySourceSearchRequest {
  readonly sourceCode?: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly countryCode?: string;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface InventorySourceSearcher {
  searchInventorySources(
    request: MagentoInventorySourceSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventorySourceSearchResponse>;
}

export interface InventorySourceReader {
  getInventorySource(
    sourceCode: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventorySource>;
}

export interface MagentoInventoryStockSearchRequest {
  readonly name?: string;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface InventoryStockSearcher {
  searchInventoryStocks(
    request: MagentoInventoryStockSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventoryStockSearchResponse>;
}

export interface MagentoSourceItemUpdate {
  readonly sku: string;
  readonly sourceCode: string;
  readonly quantity: number;
  readonly status: 0 | 1;
}

export interface InventoryWriter {
  updateSourceItems(
    items: readonly MagentoSourceItemUpdate[],
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void>;
}

const SOURCE_SEARCH_FIELDS = "items[source_code,name,enabled,description,country_id],total_count";
const STOCK_SEARCH_FIELDS =
  "items[stock_id,name,extension_attributes[sales_channels[type,code]]],total_count";

export class MagentoInventory
  implements
    InventoryReader,
    InventorySourceReader,
    InventorySourceSearcher,
    InventoryStockSearcher,
    InventoryWriter
{
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async getInventory(
    sku: string,
    stockId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<{ readonly salableQuantity: number; readonly salable: boolean }> {
    const options = onAttempt === undefined ? { signal } : { signal, onAttempt };
    const [quantityJson, salableJson] = await Promise.all([
      this.#client.getJson(
        ["V1", "inventory", "get-product-salable-quantity", sku, String(stockId)],
        options,
      ),
      this.#client.getJson(
        ["V1", "inventory", "is-product-salable", sku, String(stockId)],
        options,
      ),
    ]);
    const quantity = RawSalableQuantitySchema.safeParse(quantityJson);
    const salable = RawSalableSchema.safeParse(salableJson);
    if (!quantity.success || !salable.success) {
      throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    }
    return { salableQuantity: quantity.data, salable: salable.data };
  }

  async searchInventorySources(
    request: MagentoInventorySourceSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventorySourceSearchResponse> {
    const filters: MagentoSearchFilterGroup[] = [];
    const add = (
      field: "source_code" | "name" | "enabled" | "country_id",
      value: string | number | undefined,
      condition: MagentoSearchCondition = MAGENTO_SEARCH_CONDITION.EQUALS,
    ): void => {
      if (value !== undefined) filters.push({ filters: [{ field, value, condition }] });
    };
    add("source_code", request.sourceCode);
    add(
      "name",
      request.name === undefined ? undefined : `%${request.name}%`,
      MAGENTO_SEARCH_CONDITION.LIKE,
    );
    add("enabled", request.enabled === undefined ? undefined : request.enabled ? 1 : 0);
    add("country_id", request.countryCode);
    const query = buildMagentoSearchParams({
      filterGroups: filters,
      sortOrders: [
        { field: "name", direction: "ASC" },
        { field: "source_code", direction: "ASC" },
      ],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: SOURCE_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "inventory", "sources"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawInventorySourceSearchResponseSchema, json, request.pageSize);
  }

  async getInventorySource(
    sourceCode: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventorySource> {
    const query = new URLSearchParams({
      fields: "source_code,name,enabled,description,country_id",
    });
    const json = await this.#client.getJson(
      ["V1", "inventory", "sources", sourceCode],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    const parsed = RawInventorySourceSchema.safeParse(json);
    if (!parsed.success || parsed.data.source_code !== sourceCode) {
      throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    }
    return parsed.data;
  }

  async searchInventoryStocks(
    request: MagentoInventoryStockSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInventoryStockSearchResponse> {
    const filters: MagentoSearchFilterGroup[] = [];
    if (request.name !== undefined) {
      filters.push({
        filters: [
          {
            field: "name",
            value: `%${request.name}%`,
            condition: MAGENTO_SEARCH_CONDITION.LIKE,
          },
        ],
      });
    }
    const query = buildMagentoSearchParams({
      filterGroups: filters,
      sortOrders: [
        { field: "name", direction: "ASC" },
        { field: "stock_id", direction: "ASC" },
      ],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: STOCK_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "inventory", "stocks"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawInventoryStockSearchResponseSchema, json, request.pageSize);
  }

  async updateSourceItems(
    items: readonly MagentoSourceItemUpdate[],
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    const json = await this.#client.postJson(
      ["V1", "inventory", "source-items"],
      {
        sourceItems: items.map((item) => ({
          sku: item.sku,
          source_code: item.sourceCode,
          quantity: item.quantity,
          status: item.status,
        })),
      },
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    const parsed = z.tuple([]).safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
  }
}
