import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import {
  type FulfillmentReader,
  MAGENTO_CREDIT_MEMO_STATE,
  MAGENTO_FULFILLMENT_SORT,
  MAGENTO_INVOICE_STATE,
  type MagentoCreditMemoSearchRequest,
  type MagentoFulfillmentSort,
  type MagentoInvoiceSearchRequest,
  type MagentoShipmentSearchRequest,
} from "../../../magento/fulfillment.js";
import {
  mapCreditMemo,
  mapCreditMemoSummary,
  mapInvoice,
  mapInvoiceSummary,
  mapShipment,
  mapShipmentSummary,
  mapShipmentTracking,
} from "./mapper.js";
import {
  CREDIT_MEMO_STATE,
  type CreditMemoGetData,
  type CreditMemoSearchData,
  type CreditMemoSearchInput,
  FULFILLMENT_SORT,
  INVOICE_STATE,
  type InvoiceGetData,
  type InvoiceSearchData,
  type InvoiceSearchInput,
  type OrderTrackingData,
  type OrderTrackingInput,
  type ShipmentGetData,
  type ShipmentSearchData,
  type ShipmentSearchInput,
} from "./schemas.js";

const CURSOR_KIND = {
  ORDER_TRACKING: "order_tracking_get",
  INVOICE_SEARCH: "invoice_search",
  SHIPMENT_SEARCH: "shipment_search",
  CREDIT_MEMO_SEARCH: "credit_memo_search",
} as const;

const SORT_MAP: Readonly<Record<InvoiceSearchInput["sort"], MagentoFulfillmentSort>> = {
  [FULFILLMENT_SORT.NEWEST]: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
  [FULFILLMENT_SORT.OLDEST]: MAGENTO_FULFILLMENT_SORT.CREATED_ASCENDING,
};

type MagentoInvoiceState = NonNullable<MagentoInvoiceSearchRequest["state"]>;
type MagentoCreditMemoState = NonNullable<MagentoCreditMemoSearchRequest["state"]>;

const INVOICE_STATE_MAP: Readonly<
  Record<NonNullable<InvoiceSearchInput["state"]>, MagentoInvoiceState>
> = {
  [INVOICE_STATE.OPEN]: MAGENTO_INVOICE_STATE.OPEN,
  [INVOICE_STATE.PAID]: MAGENTO_INVOICE_STATE.PAID,
  [INVOICE_STATE.CANCELED]: MAGENTO_INVOICE_STATE.CANCELED,
};

const CREDIT_MEMO_STATE_MAP: Readonly<
  Record<NonNullable<CreditMemoSearchInput["state"]>, MagentoCreditMemoState>
> = {
  [CREDIT_MEMO_STATE.OPEN]: MAGENTO_CREDIT_MEMO_STATE.OPEN,
  [CREDIT_MEMO_STATE.REFUNDED]: MAGENTO_CREDIT_MEMO_STATE.REFUNDED,
  [CREDIT_MEMO_STATE.CANCELED]: MAGENTO_CREDIT_MEMO_STATE.CANCELED,
};

function hasNextPage(
  currentPage: number,
  pageSize: number,
  totalCount: number,
  itemCount: number,
): boolean {
  return itemCount > 0 && currentPage * pageSize < totalCount;
}

function searchCriteria(
  input: InvoiceSearchInput | CreditMemoSearchInput | ShipmentSearchInput,
): unknown {
  return {
    order_id: input.order_id ?? null,
    state: "state" in input ? (input.state ?? null) : null,
    sort: input.sort,
    page_size: input.page_size,
  };
}

export interface InvoiceSearchWorkflow {
  execute(
    input: InvoiceSearchInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<InvoiceSearchData>;
}

export function createInvoiceSearchWorkflow(
  fulfillment: FulfillmentReader,
  cursorKey: Uint8Array,
): InvoiceSearchWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND.INVOICE_SEARCH });
  return {
    async execute(input, signal, onAttempt) {
      const criteria = searchCriteria(input);
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const request: MagentoInvoiceSearchRequest = {
        ...(input.order_id === undefined ? {} : { orderId: input.order_id }),
        ...(input.state === undefined ? {} : { state: INVOICE_STATE_MAP[input.state] }),
        sort: SORT_MAP[input.sort],
        pageSize: input.page_size,
        currentPage,
      };
      const response = await fulfillment.searchInvoices(request, signal, onAttempt);
      return {
        invoices: response.items.map(mapInvoiceSummary),
        total_count: response.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage(
          currentPage,
          input.page_size,
          response.total_count,
          response.items.length,
        )
          ? cursor.encode(currentPage + 1, criteria)
          : null,
      };
    },
  };
}

export interface InvoiceGetWorkflow {
  execute(invoiceId: number, signal: AbortSignal, onAttempt?: () => void): Promise<InvoiceGetData>;
}

export function createInvoiceGetWorkflow(fulfillment: FulfillmentReader): InvoiceGetWorkflow {
  return {
    async execute(invoiceId, signal, onAttempt) {
      return mapInvoice(await fulfillment.getInvoice(invoiceId, signal, onAttempt));
    },
  };
}

export interface ShipmentSearchWorkflow {
  execute(
    input: ShipmentSearchInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<ShipmentSearchData>;
}

export function createShipmentSearchWorkflow(
  fulfillment: FulfillmentReader,
  cursorKey: Uint8Array,
): ShipmentSearchWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND.SHIPMENT_SEARCH });
  return {
    async execute(input, signal, onAttempt) {
      const criteria = searchCriteria(input);
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const request: MagentoShipmentSearchRequest = {
        orderId: input.order_id,
        sort: SORT_MAP[input.sort],
        pageSize: input.page_size,
        currentPage,
      };
      const response = await fulfillment.searchShipments(request, signal, onAttempt);
      return {
        shipments: response.items.map(mapShipmentSummary),
        total_count: response.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage(
          currentPage,
          input.page_size,
          response.total_count,
          response.items.length,
        )
          ? cursor.encode(currentPage + 1, criteria)
          : null,
      };
    },
  };
}

export interface ShipmentGetWorkflow {
  execute(
    shipmentId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<ShipmentGetData>;
}

export function createShipmentGetWorkflow(fulfillment: FulfillmentReader): ShipmentGetWorkflow {
  return {
    async execute(shipmentId, signal, onAttempt) {
      return mapShipment(await fulfillment.getShipment(shipmentId, signal, onAttempt));
    },
  };
}

export interface CreditMemoSearchWorkflow {
  execute(
    input: CreditMemoSearchInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<CreditMemoSearchData>;
}

export function createCreditMemoSearchWorkflow(
  fulfillment: FulfillmentReader,
  cursorKey: Uint8Array,
): CreditMemoSearchWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND.CREDIT_MEMO_SEARCH });
  return {
    async execute(input, signal, onAttempt) {
      const criteria = searchCriteria(input);
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const request: MagentoCreditMemoSearchRequest = {
        ...(input.order_id === undefined ? {} : { orderId: input.order_id }),
        ...(input.state === undefined ? {} : { state: CREDIT_MEMO_STATE_MAP[input.state] }),
        sort: SORT_MAP[input.sort],
        pageSize: input.page_size,
        currentPage,
      };
      const response = await fulfillment.searchCreditMemos(request, signal, onAttempt);
      return {
        credit_memos: response.items.map(mapCreditMemoSummary),
        total_count: response.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage(
          currentPage,
          input.page_size,
          response.total_count,
          response.items.length,
        )
          ? cursor.encode(currentPage + 1, criteria)
          : null,
      };
    },
  };
}

export interface CreditMemoGetWorkflow {
  execute(
    creditMemoId: number,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<CreditMemoGetData>;
}

export function createCreditMemoGetWorkflow(fulfillment: FulfillmentReader): CreditMemoGetWorkflow {
  return {
    async execute(creditMemoId, signal, onAttempt) {
      return mapCreditMemo(await fulfillment.getCreditMemo(creditMemoId, signal, onAttempt));
    },
  };
}

export interface OrderTrackingWorkflow {
  execute(
    input: OrderTrackingInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<OrderTrackingData>;
}

export function createOrderTrackingWorkflow(
  fulfillment: FulfillmentReader,
  cursorKey: Uint8Array,
): OrderTrackingWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND.ORDER_TRACKING });
  return {
    async execute(input, signal, onAttempt) {
      const criteria = { order_id: input.order_id, page_size: input.page_size };
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const response = await fulfillment.searchShipmentTracking(
        {
          orderId: input.order_id,
          sort: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
          pageSize: input.page_size,
          currentPage,
        },
        signal,
        onAttempt,
      );
      return {
        order_id: input.order_id,
        shipments: response.items.map(mapShipmentTracking),
        total_count: response.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage(
          currentPage,
          input.page_size,
          response.total_count,
          response.items.length,
        )
          ? cursor.encode(currentPage + 1, criteria)
          : null,
      };
    },
  };
}
