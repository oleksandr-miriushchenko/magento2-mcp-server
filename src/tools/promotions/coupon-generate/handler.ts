import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoPromotions } from "../../../magento/promotions.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  COUPON_GENERATE_TOOL,
  type CouponGenerateInput,
  CouponGenerateInputSchema,
  CouponGenerateOutputSchema,
  type CouponGenerateSuccess,
} from "./schemas.js";
import { createCouponGenerateWorkflow } from "./workflow.js";

function approvalMessage(input: CouponGenerateInput): string {
  const fields = [
    ["Length", input.length],
    ["Format", input.format],
    ["Prefix", input.prefix],
    ["Suffix", input.suffix],
    ["Delimiter interval", input.delimiter_at_every],
    ["Delimiter", input.delimiter],
  ] as const;
  const settings = fields
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `- ${label}: ${JSON.stringify(value)}`)
    .join("\n");
  return `Generate ${input.quantity} coupon code(s) for Magento sales rule ${input.rule_id}?\n${settings}`;
}

export function createCouponGenerateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof CouponGenerateInputSchema> {
  const workflow = createCouponGenerateWorkflow(
    new MagentoPromotions(dependencies.client),
    dependencies.idempotency.forTool<CouponGenerateSuccess>(COUPON_GENERATE_TOOL),
  );

  return createWriteHandler({
    dependencies,
    tool: COUPON_GENERATE_TOOL,
    inputSchema: CouponGenerateInputSchema,
    outputSchema: CouponGenerateOutputSchema,
    workflow,
    approvalMessage,
  });
}
