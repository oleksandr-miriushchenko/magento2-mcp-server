import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createOrderAddCommentHandler } from "./handler.js";
import {
  ORDER_ADD_COMMENT_TOOL,
  OrderAddCommentInputSchema,
  OrderAddCommentOutputSchema,
} from "./schemas.js";

const ORDER_ADD_COMMENT_DESCRIPTION =
  "Add one private comment to a Magento order without changing its status, notifying the customer, or showing the comment on the storefront. Requires native user approval and an idempotency key.";

export function registerOrderAddComment(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    ORDER_ADD_COMMENT_TOOL,
    {
      title: "Add Private Magento Order Comment",
      description: ORDER_ADD_COMMENT_DESCRIPTION,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: OrderAddCommentInputSchema,
      outputSchema: OrderAddCommentOutputSchema,
    },
    createOrderAddCommentHandler(dependencies),
  );
}
