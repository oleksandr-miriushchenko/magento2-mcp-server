import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoProductDetails } from "../../../magento/product-details.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  PRODUCT_UPDATE_TOOL,
  type ProductUpdateInput,
  ProductUpdateInputSchema,
  ProductUpdateOutputSchema,
  type ProductUpdateSuccess,
} from "./schemas.js";
import { createProductUpdateWorkflow } from "./workflow.js";

function approvalMessage(input: ProductUpdateInput): string {
  const fields = [
    ["Name", input.name],
    ["Price", input.price],
    ["Status", input.status],
    ["Visibility", input.visibility],
    ["Weight", input.weight],
  ] as const;
  const changes = fields
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `- ${label}: ${JSON.stringify(value)}`)
    .join("\n");
  return `Update Magento product ${JSON.stringify(input.sku)} with these values?\n${changes}`;
}

export function createProductUpdateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof ProductUpdateInputSchema> {
  const workflow = createProductUpdateWorkflow(
    new MagentoProductDetails(dependencies.client),
    dependencies.idempotency.forTool<ProductUpdateSuccess>(PRODUCT_UPDATE_TOOL),
  );
  return createWriteHandler({
    dependencies,
    tool: PRODUCT_UPDATE_TOOL,
    inputSchema: ProductUpdateInputSchema,
    outputSchema: ProductUpdateOutputSchema,
    workflow,
    approvalMessage,
  });
}
