import { z } from "zod";

import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const ORDER_ADD_COMMENT_TOOL = "order_add_comment";

export const ORDER_ADD_COMMENT_ERROR_CODE = WRITE_ERROR_CODE;

const CommentSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return (code < 32 && code !== 9 && code !== 10) || code === 127;
      }),
  );

const OrderAddCommentDataSchema = z.strictObject({
  order_id: z.number().int().positive(),
  comment_added: z.literal(true),
  customer_notified: z.literal(false),
  visible_on_storefront: z.literal(false),
});

const OrderAddCommentErrorCodeSchema = z.enum(ORDER_ADD_COMMENT_ERROR_CODE);

export const OrderAddCommentInputSchema = z.strictObject({
  order_id: z.number().int().positive(),
  comment: CommentSchema,
  idempotency_key: z.uuid(),
});

const OrderAddCommentResultSchemas = createToolResultSchemas(
  OrderAddCommentDataSchema,
  OrderAddCommentErrorCodeSchema,
);
export const OrderAddCommentSuccessSchema = OrderAddCommentResultSchemas.success;
export const OrderAddCommentOutputSchema = OrderAddCommentResultSchemas.output;

export type OrderAddCommentInput = z.infer<typeof OrderAddCommentInputSchema>;
export type OrderAddCommentSuccess = z.infer<typeof OrderAddCommentSuccessSchema>;
export type OrderAddCommentOutput = z.infer<typeof OrderAddCommentOutputSchema>;
