import type { ToolCallback } from "@modelcontextprotocol/server";

import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoOrders } from "../../../magento/orders.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  ORDER_GET_ERROR_CODE,
  ORDER_GET_TOOL,
  type OrderGetFailure,
  OrderGetInputSchema,
  OrderGetOutputSchema,
} from "./schemas.js";
import { createOrderGetWorkflow } from "./workflow.js";

function internalFailure(): OrderGetFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: {
      code: ORDER_GET_ERROR_CODE.INTERNAL_ERROR,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function createOrderGetHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderGetInputSchema> {
  const workflow = createOrderGetWorkflow(new MagentoOrders(dependencies.client));

  return createReadHandler({
    dependencies,
    tool: ORDER_GET_TOOL,
    inputSchema: OrderGetInputSchema,
    outputSchema: OrderGetOutputSchema,
    internalFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input.order_id, signal, onAttempt),
    }),
    auditInput: (input, metrics) => ({
      requestId: metrics.requestId,
      tool: ORDER_GET_TOOL,
      order_id: input.order_id,
      outcome: metrics.outcome,
      duration_ms: metrics.duration_ms,
      attempt_count: metrics.attempt_count,
    }),
  });
}
