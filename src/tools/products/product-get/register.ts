import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoProductDetails } from "../../../magento/product-details.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import { PRODUCT_STATUS, PRODUCT_VISIBILITY } from "../product-search/schemas.js";
import {
  PRODUCT_GET_TOOL,
  ProductGetInputSchema,
  ProductGetOutputSchema,
  type ProductGetOutput,
} from "./schemas.js";

function internalFailure(): ProductGetOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerProductGet(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const products = new MagentoProductDetails(dependencies.client);
  registerTool(
    PRODUCT_GET_TOOL,
    {
      title: "Get Magento Product",
      description: "Retrieve one product by exact SKU with a fixed allowlist of catalog fields.",
      annotations: { readOnlyHint: true },
      inputSchema: ProductGetInputSchema,
      outputSchema: ProductGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.PRODUCT_GET,
      inputSchema: ProductGetInputSchema,
      outputSchema: ProductGetOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as ProductGetOutput,
      async execute(input, signal, onAttempt) {
        const product = await products.getProduct(input.sku, signal, onAttempt);
        const status = product.status === 1 ? PRODUCT_STATUS.ENABLED : PRODUCT_STATUS.DISABLED;
        const visibility = {
          1: PRODUCT_VISIBILITY.NOT_VISIBLE,
          2: PRODUCT_VISIBILITY.CATALOG,
          3: PRODUCT_VISIBILITY.SEARCH,
          4: PRODUCT_VISIBILITY.CATALOG_SEARCH,
        }[product.visibility];
        return {
          ok: true,
          data: {
            product_id: product.id,
            sku: product.sku,
            name: product.name,
            product_type: product.type_id,
            attribute_set_id: product.attribute_set_id,
            price: product.price,
            weight: product.weight ?? null,
            status,
            visibility,
            created_at: product.created_at,
            updated_at: product.updated_at,
            category_links: (product.extension_attributes?.category_links ?? []).map((link) => ({
              category_id: Number(link.category_id),
              position: link.position ?? null,
            })),
          },
        };
      },
    }),
  );
}
