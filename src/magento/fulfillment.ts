import { z } from "zod";

import { AppError, createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import { MagentoDateTimeSchema } from "./schemas.js";
import {
  buildMagentoSearchParams,
  MAGENTO_SEARCH_CONDITION,
  parseMagentoPage,
  type MagentoSearchFilterGroup,
} from "./search.js";

const RawAmountDefaultZeroSchema = z
  .number()
  .nullish()
  .transform((amount) => amount ?? 0);

const RawInvoiceSummarySchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  state: z.number().int(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  order_currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
  total_qty: z.number().nonnegative(),
});

const RawInvoiceItemSchema = z.object({
  entity_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
  tax_amount: z.number(),
  discount_amount: RawAmountDefaultZeroSchema,
});

export const RawInvoiceSchema = z.object({
  ...RawInvoiceSummarySchema.shape,
  subtotal: z.number(),
  discount_amount: z.number(),
  shipping_amount: z.number(),
  tax_amount: z.number(),
  items: z.array(RawInvoiceItemSchema),
});

const RawInvoiceSearchResponseSchema = z.object({
  items: z
    .array(RawInvoiceSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawShipmentTrackSchema = z.object({
  track_number: z.string().min(1),
  title: z.string().min(1).nullish(),
  carrier_code: z.string().min(1).nullish(),
});

const RawShipmentSummarySchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  total_qty: z.number().nonnegative(),
});

const RawShipmentTrackingSummarySchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  created_at: MagentoDateTimeSchema,
  tracks: z
    .array(RawShipmentTrackSchema)
    .nullable()
    .transform((tracks) => tracks ?? []),
});

const RawShipmentItemSchema = z.object({
  entity_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().nonnegative(),
});

export const RawShipmentSchema = z.object({
  ...RawShipmentSummarySchema.shape,
  total_weight: z.number().nonnegative().nullish(),
  shipment_status: z.number().int().nullish(),
  items: z.array(RawShipmentItemSchema),
  tracks: z
    .array(RawShipmentTrackSchema)
    .nullable()
    .transform((tracks) => tracks ?? []),
});

const RawShipmentSearchResponseSchema = z.object({
  items: z
    .array(RawShipmentSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawShipmentTrackingResponseSchema = z.object({
  items: z
    .array(RawShipmentTrackingSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawCreditMemoSummarySchema = z.object({
  entity_id: z.number().int().positive(),
  increment_id: z.string().min(1),
  order_id: z.number().int().positive(),
  invoice_id: z.number().int().nonnegative().nullish(),
  state: z.number().int(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  order_currency_code: z.string().regex(/^[A-Z]{3}$/),
  grand_total: z.number(),
});

const RawCreditMemoItemSchema = z.object({
  entity_id: z.number().int().positive(),
  order_item_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  qty: z.number().nonnegative(),
  price: z.number(),
  row_total: z.number(),
  tax_amount: z.number(),
  discount_amount: RawAmountDefaultZeroSchema,
});

export const RawCreditMemoSchema = z.object({
  ...RawCreditMemoSummarySchema.shape,
  subtotal: z.number(),
  discount_amount: z.number(),
  shipping_amount: z.number(),
  tax_amount: z.number(),
  adjustment_positive: RawAmountDefaultZeroSchema,
  adjustment_negative: RawAmountDefaultZeroSchema,
  items: z.array(RawCreditMemoItemSchema),
});

const RawCreditMemoSearchResponseSchema = z.object({
  items: z
    .array(RawCreditMemoSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawInvoice = z.infer<typeof RawInvoiceSchema>;
export type RawInvoiceSummary = z.infer<typeof RawInvoiceSummarySchema>;
export type RawShipment = z.infer<typeof RawShipmentSchema>;
export type RawShipmentSummary = z.infer<typeof RawShipmentSummarySchema>;
export type RawShipmentTrackingSummary = z.infer<typeof RawShipmentTrackingSummarySchema>;
export type RawCreditMemo = z.infer<typeof RawCreditMemoSchema>;
export type RawCreditMemoSummary = z.infer<typeof RawCreditMemoSummarySchema>;

export const MAGENTO_FULFILLMENT_SORT = {
  CREATED_DESCENDING: "created_descending",
  CREATED_ASCENDING: "created_ascending",
} as const;

export type MagentoFulfillmentSort =
  (typeof MAGENTO_FULFILLMENT_SORT)[keyof typeof MAGENTO_FULFILLMENT_SORT];

export const MAGENTO_INVOICE_STATE = {
  OPEN: 1,
  PAID: 2,
  CANCELED: 3,
} as const;

export const MAGENTO_CREDIT_MEMO_STATE = {
  OPEN: 1,
  REFUNDED: 2,
  CANCELED: 3,
} as const;

interface SearchPageRequest {
  readonly orderId?: number;
  readonly sort: MagentoFulfillmentSort;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface MagentoInvoiceSearchRequest extends SearchPageRequest {
  readonly state?: (typeof MAGENTO_INVOICE_STATE)[keyof typeof MAGENTO_INVOICE_STATE];
}

export type MagentoShipmentSearchRequest = SearchPageRequest;

export interface MagentoCreditMemoSearchRequest extends SearchPageRequest {
  readonly state?: (typeof MAGENTO_CREDIT_MEMO_STATE)[keyof typeof MAGENTO_CREDIT_MEMO_STATE];
}

export interface RawInvoiceSearchResponse {
  readonly items: RawInvoiceSummary[];
  readonly total_count: number;
}

export interface RawShipmentSearchResponse {
  readonly items: RawShipmentSummary[];
  readonly total_count: number;
}

export interface RawShipmentTrackingResponse {
  readonly items: RawShipmentTrackingSummary[];
  readonly total_count: number;
}

export interface RawCreditMemoSearchResponse {
  readonly items: RawCreditMemoSummary[];
  readonly total_count: number;
}

export interface FulfillmentReader {
  searchInvoices(
    request: MagentoInvoiceSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInvoiceSearchResponse>;
  getInvoice(invoiceId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawInvoice>;
  searchShipments(
    request: MagentoShipmentSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipmentSearchResponse>;
  searchShipmentTracking(
    request: MagentoShipmentSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipmentTrackingResponse>;
  getShipment(
    shipmentId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipment>;
  searchCreditMemos(
    request: MagentoCreditMemoSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCreditMemoSearchResponse>;
  getCreditMemo(
    creditMemoId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCreditMemo>;
}

export interface ShipmentTrackInput {
  readonly trackNumber: string;
  readonly carrierCode: string;
  readonly title: string;
}

export interface FulfillmentWriter {
  cancelOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void>;
  holdOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void>;
  unholdOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void>;
  sendOrderEmail(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void>;
  createInvoice(
    orderId: number,
    capture: boolean,
    notify: boolean,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<number>;
  createShipment(
    orderId: number,
    notify: boolean,
    tracks: readonly ShipmentTrackInput[],
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<number>;
}

const FULFILLMENT_FIELD = {
  ENTITY_ID: "entity_id",
  ORDER_ID: "order_id",
  STATE: "state",
  CREATED_AT: "created_at",
} as const;

const INVOICE_SEARCH_FIELDS =
  "items[entity_id,increment_id,order_id,state,created_at,updated_at," +
  "order_currency_code,grand_total,total_qty],total_count";
const SHIPMENT_SEARCH_FIELDS =
  "items[entity_id,increment_id,order_id,created_at,updated_at,total_qty],total_count";
const SHIPMENT_TRACKING_FIELDS =
  "items[entity_id,increment_id,order_id,created_at," +
  "tracks[track_number,title,carrier_code]],total_count";
const CREDIT_MEMO_SEARCH_FIELDS =
  "items[entity_id,increment_id,order_id,invoice_id,state,created_at,updated_at," +
  "order_currency_code,grand_total],total_count";

function filterGroups(orderId: number | undefined, state?: number): MagentoSearchFilterGroup[] {
  const groups: MagentoSearchFilterGroup[] = [];
  if (orderId !== undefined) {
    groups.push({
      filters: [
        {
          field: FULFILLMENT_FIELD.ORDER_ID,
          value: orderId,
          condition: MAGENTO_SEARCH_CONDITION.EQUALS,
        },
      ],
    });
  }
  if (state !== undefined) {
    groups.push({
      filters: [
        {
          field: FULFILLMENT_FIELD.STATE,
          value: state,
          condition: MAGENTO_SEARCH_CONDITION.EQUALS,
        },
      ],
    });
  }
  return groups;
}

function searchQuery(request: SearchPageRequest, fields: string, state?: number): URLSearchParams {
  const direction = request.sort === MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING ? "DESC" : "ASC";
  return buildMagentoSearchParams({
    filterGroups: filterGroups(request.orderId, state),
    sortOrders: [
      { field: FULFILLMENT_FIELD.CREATED_AT, direction },
      { field: FULFILLMENT_FIELD.ENTITY_ID, direction },
    ],
    pageSize: request.pageSize,
    currentPage: request.currentPage,
    fields,
  });
}

function clientOptions(signal: AbortSignal, query: URLSearchParams, onAttempt?: () => void) {
  return onAttempt === undefined ? { signal, query } : { signal, query, onAttempt };
}

function singleOptions(signal: AbortSignal, onAttempt?: () => void) {
  return onAttempt === undefined ? { signal } : { signal, onAttempt };
}

export class MagentoFulfillment implements FulfillmentReader, FulfillmentWriter {
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async searchInvoices(
    request: MagentoInvoiceSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInvoiceSearchResponse> {
    const query = searchQuery(request, INVOICE_SEARCH_FIELDS, request.state);
    const json = await this.#client.getJson(
      ["V1", "invoices"],
      clientOptions(signal, query, onAttempt),
    );
    return parseMagentoPage(RawInvoiceSearchResponseSchema, json, request.pageSize);
  }

  async getInvoice(
    invoiceId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawInvoice> {
    const json = await this.#client.getJson(
      ["V1", "invoices", String(invoiceId)],
      singleOptions(signal, onAttempt),
    );
    const parsed = RawInvoiceSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async searchShipments(
    request: MagentoShipmentSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipmentSearchResponse> {
    const query = searchQuery(request, SHIPMENT_SEARCH_FIELDS);
    const json = await this.#client.getJson(
      ["V1", "shipments"],
      clientOptions(signal, query, onAttempt),
    );
    return parseMagentoPage(RawShipmentSearchResponseSchema, json, request.pageSize);
  }

  async searchShipmentTracking(
    request: MagentoShipmentSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipmentTrackingResponse> {
    const query = searchQuery(request, SHIPMENT_TRACKING_FIELDS);
    const json = await this.#client.getJson(
      ["V1", "shipments"],
      clientOptions(signal, query, onAttempt),
    );
    return parseMagentoPage(RawShipmentTrackingResponseSchema, json, request.pageSize);
  }

  async getShipment(
    shipmentId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawShipment> {
    const json = await this.#client.getJson(
      ["V1", "shipment", String(shipmentId)],
      singleOptions(signal, onAttempt),
    );
    const parsed = RawShipmentSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async searchCreditMemos(
    request: MagentoCreditMemoSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCreditMemoSearchResponse> {
    const query = searchQuery(request, CREDIT_MEMO_SEARCH_FIELDS, request.state);
    const json = await this.#client.getJson(
      ["V1", "creditmemos"],
      clientOptions(signal, query, onAttempt),
    );
    return parseMagentoPage(RawCreditMemoSearchResponseSchema, json, request.pageSize);
  }

  async getCreditMemo(
    creditMemoId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCreditMemo> {
    const json = await this.#client.getJson(
      ["V1", "creditmemo", String(creditMemoId)],
      singleOptions(signal, onAttempt),
    );
    const parsed = RawCreditMemoSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async cancelOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void> {
    await this.#booleanMutation(["V1", "orders", String(orderId), "cancel"], {}, signal, onAttempt);
  }

  async holdOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void> {
    await this.#booleanMutation(["V1", "orders", String(orderId), "hold"], {}, signal, onAttempt);
  }

  async unholdOrder(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<void> {
    await this.#booleanMutation(["V1", "orders", String(orderId), "unhold"], {}, signal, onAttempt);
  }

  async sendOrderEmail(
    orderId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    await this.#booleanMutation(["V1", "orders", String(orderId), "emails"], {}, signal, onAttempt);
  }

  async createInvoice(
    orderId: number,
    capture: boolean,
    notify: boolean,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<number> {
    return this.#idMutation(
      ["V1", "order", String(orderId), "invoice"],
      { capture, notify },
      signal,
      onAttempt,
    );
  }

  async createShipment(
    orderId: number,
    notify: boolean,
    tracks: readonly ShipmentTrackInput[],
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<number> {
    return this.#idMutation(
      ["V1", "order", String(orderId), "ship"],
      {
        notify,
        tracks: tracks.map((track) => ({
          track_number: track.trackNumber,
          carrier_code: track.carrierCode,
          title: track.title,
        })),
      },
      signal,
      onAttempt,
    );
  }

  async #booleanMutation(
    path: readonly [string, ...string[]],
    body: unknown,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    const json = await this.#client.postJson(path, body, singleOptions(signal, onAttempt));
    const parsed = z.boolean().safeParse(json);
    if (!parsed.success) {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }
    if (!parsed.data) {
      throw new AppError(
        ERROR_CODE.UPSTREAM_REJECTED,
        "Magento returned false and did not confirm the requested operation.",
      );
    }
  }

  async #idMutation(
    path: readonly [string, ...string[]],
    body: unknown,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<number> {
    const json = await this.#client.postJson(path, body, singleOptions(signal, onAttempt));
    const parsed = z.number().int().positive().safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    return parsed.data;
  }
}
