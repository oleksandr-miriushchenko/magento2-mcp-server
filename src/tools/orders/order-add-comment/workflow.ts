import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { OrderCommentWriter } from "../../../magento/orders.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import {
  ORDER_ADD_COMMENT_TOOL,
  type OrderAddCommentInput,
  type OrderAddCommentSuccess,
} from "./schemas.js";

export type OrderAddCommentWorkflow = IdempotentWriteWorkflow<
  OrderAddCommentInput,
  OrderAddCommentSuccess
>;

function fingerprint(input: OrderAddCommentInput): string {
  return canonicalDigest({ order_id: input.order_id, comment: input.comment });
}

export function createOrderAddCommentWorkflow(
  orders: OrderCommentWriter,
  idempotency: IdempotencyStore<OrderAddCommentSuccess>,
): OrderAddCommentWorkflow {
  return createIdempotentWriteWorkflow({
    tool: ORDER_ADD_COMMENT_TOOL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await orders.addComment(input.order_id, input.comment, signal, onAttempt);
      return {
        ok: true,
        data: {
          order_id: input.order_id,
          comment_added: true,
          customer_notified: false,
          visible_on_storefront: false,
        },
      };
    },
  });
}
