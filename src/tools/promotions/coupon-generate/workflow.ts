import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { PromotionWriter } from "../../../magento/promotions.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import {
  COUPON_GENERATE_TOOL,
  type CouponGenerateInput,
  type CouponGenerateSuccess,
} from "./schemas.js";

function fingerprint(input: CouponGenerateInput): string {
  return canonicalDigest({
    rule_id: input.rule_id,
    quantity: input.quantity,
    length: input.length,
    format: input.format,
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
    ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
    ...(input.delimiter_at_every === undefined
      ? {}
      : { delimiter_at_every: input.delimiter_at_every }),
    ...(input.delimiter === undefined ? {} : { delimiter: input.delimiter }),
  });
}

export type CouponGenerateWorkflow = IdempotentWriteWorkflow<
  CouponGenerateInput,
  CouponGenerateSuccess
>;

export function createCouponGenerateWorkflow(
  promotions: PromotionWriter,
  idempotency: IdempotencyStore<CouponGenerateSuccess>,
): CouponGenerateWorkflow {
  return createIdempotentWriteWorkflow({
    tool: COUPON_GENERATE_TOOL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      const coupons = await promotions.generateCoupons(
        {
          ruleId: input.rule_id,
          quantity: input.quantity,
          length: input.length,
          format: input.format,
          ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
          ...(input.suffix === undefined ? {} : { suffix: input.suffix }),
          ...(input.delimiter_at_every === undefined
            ? {}
            : { delimiterAtEvery: input.delimiter_at_every }),
          ...(input.delimiter === undefined ? {} : { delimiter: input.delimiter }),
        },
        signal,
        onAttempt,
      );
      return {
        ok: true,
        data: { rule_id: input.rule_id, quantity: coupons.length, coupons: [...coupons] },
      };
    },
  });
}
