import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoOrders } from "../../../magento/orders.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  ORDER_ADD_COMMENT_TOOL,
  type OrderAddCommentInput,
  OrderAddCommentInputSchema,
  OrderAddCommentOutputSchema,
  type OrderAddCommentSuccess,
} from "./schemas.js";
import { createOrderAddCommentWorkflow } from "./workflow.js";

function approvalMessage(input: OrderAddCommentInput): string {
  return `Add a private comment to Magento order ${input.order_id}? The customer will not be notified, and the comment will not be visible on the storefront.`;
}

export function createOrderAddCommentHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderAddCommentInputSchema> {
  const workflow = createOrderAddCommentWorkflow(
    new MagentoOrders(dependencies.client),
    dependencies.idempotency.forTool<OrderAddCommentSuccess>(ORDER_ADD_COMMENT_TOOL),
  );

  return createWriteHandler({
    dependencies,
    tool: ORDER_ADD_COMMENT_TOOL,
    inputSchema: OrderAddCommentInputSchema,
    outputSchema: OrderAddCommentOutputSchema,
    workflow,
    approvalMessage,
    auditInput: (input, metrics) => ({
      requestId: metrics.requestId,
      tool: ORDER_ADD_COMMENT_TOOL,
      order_id: input.order_id,
      outcome: metrics.outcome,
      duration_ms: metrics.duration_ms,
      attempt_count: metrics.attempt_count,
      replayed: metrics.replayed,
    }),
  });
}
