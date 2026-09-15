import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import {
  MAGENTO_PRODUCT_SEARCH_SORT,
  type MagentoProductSearchRequest,
  type MagentoProductSearchSort,
  type ProductSearcher,
} from "../../../magento/products.js";
import { mapProductSearchItem } from "./mapper.js";
import {
  PRODUCT_SEARCH_SORT,
  PRODUCT_STATUS,
  PRODUCT_VISIBILITY,
  type ProductSearchData,
  type ProductSearchInput,
} from "./schemas.js";

const CURSOR_KIND = "product_search";

const SORT_MAP: Readonly<Record<ProductSearchInput["sort"], MagentoProductSearchSort>> = {
  [PRODUCT_SEARCH_SORT.NEWEST]: MAGENTO_PRODUCT_SEARCH_SORT.CREATED_DESCENDING,
  [PRODUCT_SEARCH_SORT.OLDEST]: MAGENTO_PRODUCT_SEARCH_SORT.CREATED_ASCENDING,
  [PRODUCT_SEARCH_SORT.NAME_A_TO_Z]: MAGENTO_PRODUCT_SEARCH_SORT.NAME_ASCENDING,
  [PRODUCT_SEARCH_SORT.NAME_Z_TO_A]: MAGENTO_PRODUCT_SEARCH_SORT.NAME_DESCENDING,
  [PRODUCT_SEARCH_SORT.PRICE_LOW_TO_HIGH]: MAGENTO_PRODUCT_SEARCH_SORT.PRICE_ASCENDING,
  [PRODUCT_SEARCH_SORT.PRICE_HIGH_TO_LOW]: MAGENTO_PRODUCT_SEARCH_SORT.PRICE_DESCENDING,
};

const STATUS_MAP: Readonly<Record<NonNullable<ProductSearchInput["status"]>, 1 | 2>> = {
  [PRODUCT_STATUS.ENABLED]: 1,
  [PRODUCT_STATUS.DISABLED]: 2,
};

const VISIBILITY_MAP: Readonly<
  Record<NonNullable<ProductSearchInput["visibility"]>, 1 | 2 | 3 | 4>
> = {
  [PRODUCT_VISIBILITY.NOT_VISIBLE]: 1,
  [PRODUCT_VISIBILITY.CATALOG]: 2,
  [PRODUCT_VISIBILITY.SEARCH]: 3,
  [PRODUCT_VISIBILITY.CATALOG_SEARCH]: 4,
};

function cursorCriteria(input: ProductSearchInput): unknown {
  return {
    search: input.search ?? null,
    sku: input.sku ?? null,
    status: input.status ?? null,
    visibility: input.visibility ?? null,
    product_type: input.product_type ?? null,
    price_min: input.price_min ?? null,
    price_max: input.price_max ?? null,
    sort: input.sort,
    page_size: input.page_size,
  };
}

function magentoRequest(
  input: ProductSearchInput,
  currentPage: number,
): MagentoProductSearchRequest {
  return {
    ...(input.search === undefined ? {} : { search: input.search }),
    ...(input.sku === undefined ? {} : { sku: input.sku }),
    ...(input.status === undefined ? {} : { status: STATUS_MAP[input.status] }),
    ...(input.visibility === undefined ? {} : { visibility: VISIBILITY_MAP[input.visibility] }),
    ...(input.product_type === undefined ? {} : { productType: input.product_type }),
    ...(input.price_min === undefined ? {} : { priceMin: input.price_min }),
    ...(input.price_max === undefined ? {} : { priceMax: input.price_max }),
    sort: SORT_MAP[input.sort],
    pageSize: input.page_size,
    currentPage,
  };
}

export interface ProductSearchWorkflow {
  execute(
    input: ProductSearchInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<ProductSearchData>;
}

export function createProductSearchWorkflow(
  products: ProductSearcher,
  cursorKey: Uint8Array,
): ProductSearchWorkflow {
  const cursor = createSearchCursorCodec({ key: cursorKey, kind: CURSOR_KIND });

  return {
    async execute(input, signal, onAttempt) {
      const criteria = cursorCriteria(input);
      const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
      const result = await products.searchProducts(
        magentoRequest(input, currentPage),
        signal,
        onAttempt,
      );
      const hasNextPage =
        result.items.length > 0 && currentPage * input.page_size < result.total_count;
      return {
        products: result.items.map(mapProductSearchItem),
        total_count: result.total_count,
        page_size: input.page_size,
        next_cursor: hasNextPage ? cursor.encode(currentPage + 1, criteria) : null,
      };
    },
  };
}
