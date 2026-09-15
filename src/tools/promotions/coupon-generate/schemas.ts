import { z } from "zod";

import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const COUPON_GENERATE_TOOL = "coupon_generate";

export const COUPON_FORMAT = {
  ALPHANUMERIC: "alphanum",
  ALPHABETICAL: "alpha",
  NUMERIC: "num",
} as const;

export const COUPON_GENERATE_ERROR_CODE = WRITE_ERROR_CODE;

const CouponAffixSchema = z
  .string()
  .max(32)
  .regex(/^[\x20-\x7e]*$/);

export const CouponGenerateInputSchema = z
  .strictObject({
    rule_id: z.number().int().positive(),
    quantity: z.number().int().min(1).max(100),
    length: z.number().int().min(4).max(64).default(12),
    format: z.enum(COUPON_FORMAT).default(COUPON_FORMAT.ALPHANUMERIC),
    prefix: CouponAffixSchema.optional(),
    suffix: CouponAffixSchema.optional(),
    delimiter_at_every: z.number().int().min(1).max(64).optional(),
    delimiter: z
      .string()
      .min(1)
      .max(4)
      .regex(/^[\x20-\x7e]+$/)
      .optional(),
    idempotency_key: z.uuid(),
  })
  .superRefine((input, context) => {
    if (input.delimiter !== undefined && input.delimiter_at_every === undefined) {
      context.addIssue({
        code: "custom",
        path: ["delimiter_at_every"],
        message: "delimiter_at_every is required when delimiter is provided.",
      });
    }
    const delimiterCount =
      input.delimiter_at_every === undefined
        ? 0
        : Math.floor((input.length - 1) / input.delimiter_at_every);
    const generatedLength =
      input.length +
      (input.prefix?.length ?? 0) +
      (input.suffix?.length ?? 0) +
      delimiterCount * (input.delimiter?.length ?? 1);
    if (generatedLength > 255) {
      context.addIssue({
        code: "custom",
        message: "Generated coupon codes must not exceed 255 characters.",
      });
    }
  });

const CouponGenerateDataSchema = z.strictObject({
  rule_id: z.number().int().positive(),
  quantity: z.number().int().min(1).max(100),
  coupons: z.array(z.string().min(1).max(255)).max(100),
});

const CouponGenerateErrorCodeSchema = z.enum(COUPON_GENERATE_ERROR_CODE);

const CouponGenerateResultSchemas = createToolResultSchemas(
  CouponGenerateDataSchema,
  CouponGenerateErrorCodeSchema,
);
export const CouponGenerateSuccessSchema = CouponGenerateResultSchemas.success;
export const CouponGenerateOutputSchema = CouponGenerateResultSchemas.output;

export type CouponGenerateInput = z.infer<typeof CouponGenerateInputSchema>;
export type CouponGenerateSuccess = z.infer<typeof CouponGenerateSuccessSchema>;
export type CouponGenerateOutput = z.infer<typeof CouponGenerateOutputSchema>;
