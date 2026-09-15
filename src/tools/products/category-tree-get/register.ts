import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoProductDetails, type RawCategory } from "../../../magento/product-details.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  CATEGORY_TREE_GET_TOOL,
  CategoryTreeGetInputSchema,
  CategoryTreeGetOutputSchema,
  type CategoryNode,
  type CategoryTreeGetOutput,
} from "./schemas.js";

function mapCategory(category: RawCategory): CategoryNode {
  return {
    category_id: category.id,
    parent_id: category.parent_id,
    name: category.name,
    is_active: category.is_active,
    position: category.position,
    level: category.level,
    product_count: category.product_count,
    children: category.children_data.map(mapCategory),
  };
}

function internalFailure(): CategoryTreeGetOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerCategoryTreeGet(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const products = new MagentoProductDetails(dependencies.client);
  registerTool(
    CATEGORY_TREE_GET_TOOL,
    {
      title: "Get Magento Category Tree",
      description: "Retrieve the category tree from an optional root category at bounded depth.",
      annotations: { readOnlyHint: true },
      inputSchema: CategoryTreeGetInputSchema,
      outputSchema: CategoryTreeGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CATEGORY_TREE_GET,
      inputSchema: CategoryTreeGetInputSchema,
      outputSchema: CategoryTreeGetOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as CategoryTreeGetOutput,
      async execute(input, signal, onAttempt) {
        const category = await products.getCategoryTree(
          input.root_category_id,
          input.depth,
          signal,
          onAttempt,
        );
        return { ok: true, data: { root: mapCategory(category) } };
      },
    }),
  );
}
