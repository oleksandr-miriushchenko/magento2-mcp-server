import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoInventory } from "../../../magento/inventory.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  INVENTORY_UPDATE_TOOL,
  type InventoryUpdateInput,
  InventoryUpdateInputSchema,
  InventoryUpdateOutputSchema,
  type InventoryUpdateSuccess,
} from "./schemas.js";
import { createInventoryUpdateWorkflow } from "./workflow.js";

function approvalMessage(input: InventoryUpdateInput): string {
  const changes = input.source_items
    .map(
      (item) =>
        `- SKU ${JSON.stringify(item.sku)}, source ${JSON.stringify(item.source_code)}: quantity ${item.quantity}, status ${item.status}`,
    )
    .join("\n");
  return `Update ${input.source_items.length} Magento inventory source item(s)? This overwrites quantity and stock status for each SKU/source pair:\n${changes}`;
}

export function createInventoryUpdateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof InventoryUpdateInputSchema> {
  const workflow = createInventoryUpdateWorkflow(
    new MagentoInventory(dependencies.client),
    dependencies.idempotency.forTool<InventoryUpdateSuccess>(INVENTORY_UPDATE_TOOL),
  );
  return createWriteHandler({
    dependencies,
    tool: INVENTORY_UPDATE_TOOL,
    inputSchema: InventoryUpdateInputSchema,
    outputSchema: InventoryUpdateOutputSchema,
    workflow,
    approvalMessage,
  });
}
