import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { MagentoProductUpdate, ProductWriter } from "../../../magento/product-details.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import { PRODUCT_STATUS, PRODUCT_VISIBILITY } from "../product-search/schemas.js";
import {
  PRODUCT_UPDATE_CHANGED_FIELD,
  PRODUCT_UPDATE_TOOL,
  type ProductUpdateInput,
  type ProductUpdateSuccess,
} from "./schemas.js";

const STATUS_MAP = {
  [PRODUCT_STATUS.ENABLED]: 1,
  [PRODUCT_STATUS.DISABLED]: 2,
} as const;

const VISIBILITY_MAP = {
  [PRODUCT_VISIBILITY.NOT_VISIBLE]: 1,
  [PRODUCT_VISIBILITY.CATALOG]: 2,
  [PRODUCT_VISIBILITY.SEARCH]: 3,
  [PRODUCT_VISIBILITY.CATALOG_SEARCH]: 4,
} as const;

function changes(input: ProductUpdateInput): MagentoProductUpdate {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.price === undefined ? {} : { price: input.price }),
    ...(input.status === undefined ? {} : { status: STATUS_MAP[input.status] }),
    ...(input.visibility === undefined ? {} : { visibility: VISIBILITY_MAP[input.visibility] }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
  };
}

function changedFields(input: ProductUpdateInput): ProductUpdateSuccess["data"]["changed_fields"] {
  return [
    ...(input.name === undefined ? [] : [PRODUCT_UPDATE_CHANGED_FIELD.NAME]),
    ...(input.price === undefined ? [] : [PRODUCT_UPDATE_CHANGED_FIELD.PRICE]),
    ...(input.status === undefined ? [] : [PRODUCT_UPDATE_CHANGED_FIELD.STATUS]),
    ...(input.visibility === undefined ? [] : [PRODUCT_UPDATE_CHANGED_FIELD.VISIBILITY]),
    ...(input.weight === undefined ? [] : [PRODUCT_UPDATE_CHANGED_FIELD.WEIGHT]),
  ];
}

function fingerprint(input: ProductUpdateInput): string {
  return canonicalDigest({ sku: input.sku, changes: changes(input) });
}

export type ProductUpdateWorkflow = IdempotentWriteWorkflow<
  ProductUpdateInput,
  ProductUpdateSuccess
>;

export function createProductUpdateWorkflow(
  products: ProductWriter,
  idempotency: IdempotencyStore<ProductUpdateSuccess>,
): ProductUpdateWorkflow {
  return createIdempotentWriteWorkflow({
    tool: PRODUCT_UPDATE_TOOL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await products.updateProduct(input.sku, changes(input), signal, onAttempt);
      return {
        ok: true,
        data: { sku: input.sku, updated: true, changed_fields: changedFields(input) },
      };
    },
  });
}
