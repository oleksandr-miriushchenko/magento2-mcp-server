import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createCouponGenerateHandler } from "./handler.js";
import {
  COUPON_GENERATE_TOOL,
  CouponGenerateInputSchema,
  CouponGenerateOutputSchema,
} from "./schemas.js";

export function registerCouponGenerate(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    COUPON_GENERATE_TOOL,
    {
      title: "Generate Magento Coupons",
      description:
        "Generate up to 100 coupon codes in one Magento request for an auto-generation sales rule. Requires native user approval and an idempotency key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: CouponGenerateInputSchema,
      outputSchema: CouponGenerateOutputSchema,
    },
    createCouponGenerateHandler(dependencies),
  );
}
