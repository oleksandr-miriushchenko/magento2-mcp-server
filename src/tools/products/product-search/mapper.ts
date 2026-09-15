import type { RawProductSearchItem } from "../../../magento/products.js";
import { PRODUCT_STATUS, PRODUCT_VISIBILITY, type ProductSearchData } from "./schemas.js";

function status(value: 1 | 2): ProductSearchData["products"][number]["status"] {
  return value === 1 ? PRODUCT_STATUS.ENABLED : PRODUCT_STATUS.DISABLED;
}

function visibility(value: 1 | 2 | 3 | 4): ProductSearchData["products"][number]["visibility"] {
  switch (value) {
    case 1:
      return PRODUCT_VISIBILITY.NOT_VISIBLE;
    case 2:
      return PRODUCT_VISIBILITY.CATALOG;
    case 3:
      return PRODUCT_VISIBILITY.SEARCH;
    case 4:
      return PRODUCT_VISIBILITY.CATALOG_SEARCH;
  }
}

export function mapProductSearchItem(
  raw: RawProductSearchItem,
): ProductSearchData["products"][number] {
  return {
    product_id: raw.id,
    sku: raw.sku,
    name: raw.name,
    product_type: raw.type_id,
    status: status(raw.status),
    visibility: visibility(raw.visibility),
    price: raw.price,
    attribute_set_id: raw.attribute_set_id,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}
