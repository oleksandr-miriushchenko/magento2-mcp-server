import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import {
  MAGENTO_ORDER_SEARCH_SORT,
  type MagentoOrderSearchRequest,
  type MagentoOrderSearchSort,
  type OrderSearcher,
} from "../../../magento/orders.js";
import { mapOrderSearchItem } from "./mapper.js";
import { ORDER_SEARCH_SORT, type OrderSearchData, type OrderSearchInput } from "./schemas.js";

const CURSOR_KIND = "order_search";

const SORT_MAP: Readonly<Record<OrderSearchInput["sort"], MagentoOrderSearchSort>> = {
  [ORDER_SEARCH_SORT.NEWEST]: MAGENTO_ORDER_SEARCH_SORT.CREATED_DESCENDING,
  [ORDER_SEARCH_SORT.OLDEST]: MAGENTO_ORDER_SEARCH_SORT.CREATED_ASCENDING,
  [ORDER_SEARCH_SORT.TOTAL_HIGH_TO_LOW]: MAGENTO_ORDER_SEARCH_SORT.TOTAL_DESCENDING,
  [ORDER_SEARCH_SORT.TOTAL_LOW_TO_HIGH]: MAGENTO_ORDER_SEARCH_SORT.TOTAL_ASCENDING,
};

function cursorCriteria(input: OrderSearchInput): unknown {
  return {
    increment_id: input.increment_id ?? null,
    customer_email: input.customer_email ?? null,
    customer_id: input.customer_id ?? null,
    status: input.status ?? null,
    created_from: input.created_from ?? null,
    created_to: input.created_to ?? null,
    grand_total_min: input.grand_total_min ?? null,
    grand_total_max: input.grand_total_max ?? null,
    sort: input.sort,
    page_size: input.page_size,
  };
}

function magentoRequest(input: OrderSearchInput, currentPage: number): MagentoOrderSearchRequest {
  return {
    ...(input.increment_id === undefined ? {} : { incrementId: input.increment_id }),
    ...(input.customer_email === undefined ? {} : { customerEmail: input.customer_email }),
    ...(input.customer_id === undefined ? {} : { customerId: input.customer_id }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.created_from === undefined ? {} : { createdFrom: `${input.created_from} 00:00:00` }),
    ...(input.created_to === undefined ? {} : { createdTo: `${input.created_to} 23:59:59` }),
    ...(input.grand_total_min === undefined ? {} : { grandTotalMin: input.grand_total_min }),
    ...(input.grand_total_max === undefined ? {} : { grandTotalMax: input.grand_total_max }),
    sort: SORT_MAP[input.sort],
    pageSize: input.page_size,
    currentPage,
  };
}

export interface OrderSearchWorkflow {
  execute(
    input: OrderSearchInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<OrderSearchData>;
}

export function createOrderSearchWorkflow(
  orders: OrderSearcher,
  cursorKey: Uint8Array,
): OrderSearchWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND });

  return {
    async execute(input, signal, onAttempt) {
      const criteria = cursorCriteria(input);
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const result = await orders.searchOrders(
        magentoRequest(input, currentPage),
        signal,
        onAttempt,
      );
      const hasNextPage =
        result.items.length > 0 && currentPage * input.page_size < result.total_count;
      return {
        orders: result.items.map(mapOrderSearchItem),
        total_count: result.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage ? cursor.encode(currentPage + 1, criteria) : null,
      };
    },
  };
}
