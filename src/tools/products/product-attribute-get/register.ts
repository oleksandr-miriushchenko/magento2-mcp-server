import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoProductDetails } from "../../../magento/product-details.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  PRODUCT_ATTRIBUTE_GET_TOOL,
  ProductAttributeGetInputSchema,
  ProductAttributeGetOutputSchema,
  type ProductAttributeGetOutput,
} from "./schemas.js";

function internalFailure(): ProductAttributeGetOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerProductAttributeGet(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const products = new MagentoProductDetails(dependencies.client);
  registerTool(
    PRODUCT_ATTRIBUTE_GET_TOOL,
    {
      title: "Get Magento Product Attribute",
      description: "Retrieve one product attribute definition by exact attribute code.",
      annotations: { readOnlyHint: true },
      inputSchema: ProductAttributeGetInputSchema,
      outputSchema: ProductAttributeGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.PRODUCT_ATTRIBUTE_GET,
      inputSchema: ProductAttributeGetInputSchema,
      outputSchema: ProductAttributeGetOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as ProductAttributeGetOutput,
      async execute(input, signal, onAttempt) {
        const attribute = await products.getProductAttribute(
          input.attribute_code,
          signal,
          onAttempt,
        );
        return {
          ok: true,
          data: {
            attribute_id: attribute.attribute_id,
            attribute_code: attribute.attribute_code,
            label: attribute.default_frontend_label ?? null,
            input_type: attribute.frontend_input ?? null,
            scope: attribute.scope ?? null,
            is_required: attribute.is_required,
            is_unique: attribute.is_unique,
            is_user_defined: attribute.is_user_defined,
            is_visible_on_front: attribute.is_visible_on_front,
            used_in_product_listing: attribute.used_in_product_listing,
            is_filterable: attribute.is_filterable,
            is_filterable_in_search: attribute.is_filterable_in_search,
            is_searchable: attribute.is_searchable,
            is_comparable: attribute.is_comparable,
            options: attribute.options ?? [],
          },
        };
      },
    }),
  );
}
