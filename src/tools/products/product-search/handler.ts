import type { ToolCallback } from "@modelcontextprotocol/server";

import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoProducts } from "../../../magento/products.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  PRODUCT_SEARCH_ERROR_CODE,
  PRODUCT_SEARCH_TOOL,
  type ProductSearchFailure,
  type ProductSearchInputSchema,
  ProductSearchOutputSchema,
} from "./schemas.js";
import { createProductSearchWorkflow } from "./workflow.js";

function internalFailure(): ProductSearchFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: {
      code: PRODUCT_SEARCH_ERROR_CODE.INTERNAL_ERROR,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function createProductSearchHandler(
  dependencies: ToolDependencies,
  inputSchema: ProductSearchInputSchema,
): ToolCallback<ProductSearchInputSchema> {
  const workflow = createProductSearchWorkflow(
    new MagentoProducts(dependencies.client),
    dependencies.cursorKey,
  );

  return createReadHandler({
    dependencies,
    tool: PRODUCT_SEARCH_TOOL,
    inputSchema,
    outputSchema: ProductSearchOutputSchema,
    internalFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}
