import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import { MagentoProductDetails } from "../../../magento/product-details.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  createProductAttributeSearchInputSchema,
  PRODUCT_ATTRIBUTE_SEARCH_TOOL,
  ProductAttributeSearchOutputSchema,
  type ProductAttributeSearchOutput,
} from "./schemas.js";

function internalFailure(): ProductAttributeSearchOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerProductAttributeSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createProductAttributeSearchInputSchema(dependencies.maxPageSize);
  const products = new MagentoProductDetails(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: PRODUCT_ATTRIBUTE_SEARCH_TOOL,
  });
  registerTool(
    PRODUCT_ATTRIBUTE_SEARCH_TOOL,
    {
      title: "Search Magento Product Attributes",
      description: "Search product attribute definitions using fixed metadata filters.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: ProductAttributeSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.PRODUCT_ATTRIBUTE_SEARCH,
      inputSchema,
      outputSchema: ProductAttributeSearchOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as ProductAttributeSearchOutput,
      async execute(input, signal, onAttempt) {
        const criteria = {
          code: input.code ?? null,
          label: input.label ?? null,
          user_defined: input.user_defined ?? null,
          page_size: input.page_size,
        };
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await products.searchProductAttributes(
          {
            ...(input.code === undefined ? {} : { code: input.code }),
            ...(input.label === undefined ? {} : { label: input.label }),
            ...(input.user_defined === undefined ? {} : { userDefined: input.user_defined }),
            pageSize: input.page_size,
            currentPage,
          },
          signal,
          onAttempt,
        );
        const hasNext =
          response.items.length > 0 && currentPage * input.page_size < response.total_count;
        return {
          ok: true,
          data: {
            attributes: response.items.map((attribute) => ({
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
            })),
            total_count: response.total_count,
            page_size: input.page_size,
            next_cursor: hasNext ? cursor.encode(currentPage + 1, criteria) : null,
          },
        };
      },
    }),
  );
}
