import { createAppError, ERROR_CODE } from "../../src/core/errors.js";
import { InMemoryIdempotencyStore } from "../../src/core/idempotency.js";
import {
  OrderAddCommentInputSchema,
  type OrderAddCommentInput,
  type OrderAddCommentSuccess,
} from "../../src/tools/orders/order-add-comment/schemas.js";
import { createOrderAddCommentWorkflow } from "../../src/tools/orders/order-add-comment/workflow.js";

const input: OrderAddCommentInput = {
  order_id: 7,
  comment: "Private note",
  idempotency_key: "4f8ae949-6e10-4ea1-865d-32ea06b72d3f",
};

function writer(
  options: {
    addComment?: () => Promise<void>;
  } = {},
) {
  return {
    addComment: vi.fn(options.addComment ?? (() => Promise.resolve())),
  };
}

describe("order_add_comment workflow", () => {
  it("canonicalizes bounded text and rejects controls or a non-UUID key", () => {
    expect(
      OrderAddCommentInputSchema.parse({ ...input, comment: "  Private note  " }).comment,
    ).toBe("Private note");
    expect(
      OrderAddCommentInputSchema.safeParse({ ...input, comment: "bad\u0000note" }).success,
    ).toBe(false);
    expect(
      OrderAddCommentInputSchema.safeParse({ ...input, comment: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      OrderAddCommentInputSchema.safeParse({ ...input, idempotency_key: "same" }).success,
    ).toBe(false);
  });

  it("performs one write and replays without Magento calls", async () => {
    const orders = writer();
    const workflow = createOrderAddCommentWorkflow(
      orders,
      new InMemoryIdempotencyStore<OrderAddCommentSuccess>(),
    );
    const signal = new AbortController().signal;
    const onAttempt = vi.fn();

    expect(workflow.lookup(input)).toBeUndefined();
    await expect(workflow.execute(input, signal, onAttempt)).resolves.toEqual({
      ok: true,
      data: {
        order_id: 7,
        comment_added: true,
        customer_notified: false,
        visible_on_storefront: false,
      },
    });
    expect(orders.addComment).toHaveBeenCalledWith(7, "Private note", signal, onAttempt);

    orders.addComment.mockClear();
    expect(workflow.lookup(input)).toMatchObject({ ok: true, data: { order_id: 7 } });
    expect(orders.addComment).not.toHaveBeenCalled();
  });

  it("releases a reservation after a definite failure so the same key can retry", async () => {
    const orders = writer({
      addComment: () => Promise.reject(createAppError(ERROR_CODE.UPSTREAM_REJECTED)),
    });
    const workflow = createOrderAddCommentWorkflow(
      orders,
      new InMemoryIdempotencyStore<OrderAddCommentSuccess>(),
    );

    await expect(workflow.execute(input, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
    });
    expect(workflow.lookup(input)).toBeUndefined();
    await expect(workflow.execute(input, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
    });
    expect(orders.addComment).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous write pending and blocks duplicate execution", async () => {
    const orders = writer({
      addComment: () => Promise.reject(createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN)),
    });
    const workflow = createOrderAddCommentWorkflow(
      orders,
      new InMemoryIdempotencyStore<OrderAddCommentSuccess>(),
    );

    await expect(workflow.execute(input, new AbortController().signal)).rejects.toMatchObject({
      code: "UPSTREAM_OUTCOME_UNKNOWN",
    });
    expect(() => workflow.lookup(input)).toThrow("ongoing or unresolved operation");
    await expect(workflow.execute(input, new AbortController().signal)).rejects.toThrow(
      "ongoing or unresolved operation",
    );
    expect(orders.addComment).toHaveBeenCalledOnce();
  });

  it("rejects reuse of one key for different mutation arguments", async () => {
    const workflow = createOrderAddCommentWorkflow(
      writer(),
      new InMemoryIdempotencyStore<OrderAddCommentSuccess>(),
    );
    await workflow.execute(input, new AbortController().signal);

    expect(() => workflow.lookup({ ...input, comment: "Different note" })).toThrow(
      "another request",
    );
  });
});
