import type { ToolCallback } from "@modelcontextprotocol/server";

import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoOrders } from "../../../magento/orders.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  ORDER_SEARCH_ERROR_CODE,
  ORDER_SEARCH_TOOL,
  type OrderSearchFailure,
  type OrderSearchInputSchema,
  OrderSearchOutputSchema,
} from "./schemas.js";
import { createOrderSearchWorkflow } from "./workflow.js";

function internalFailure(): OrderSearchFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: {
      code: ORDER_SEARCH_ERROR_CODE.INTERNAL_ERROR,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function createOrderSearchHandler(
  dependencies: ToolDependencies,
  inputSchema: OrderSearchInputSchema,
): ToolCallback<OrderSearchInputSchema> {
  const workflow = createOrderSearchWorkflow(
    new MagentoOrders(dependencies.client),
    dependencies.cursorKey,
  );

  return createReadHandler({
    dependencies,
    tool: ORDER_SEARCH_TOOL,
    inputSchema,
    outputSchema: OrderSearchOutputSchema,
    internalFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}
