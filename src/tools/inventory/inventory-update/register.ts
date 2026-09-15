import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createInventoryUpdateHandler } from "./handler.js";
import {
  INVENTORY_UPDATE_TOOL,
  InventoryUpdateInputSchema,
  InventoryUpdateOutputSchema,
} from "./schemas.js";

export function registerInventoryUpdate(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    INVENTORY_UPDATE_TOOL,
    {
      title: "Update Magento Inventory",
      description:
        "Update up to 100 inventory source items in one Magento request after native approval. Requires an idempotency key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: InventoryUpdateInputSchema,
      outputSchema: InventoryUpdateOutputSchema,
    },
    createInventoryUpdateHandler(dependencies),
  );
}
