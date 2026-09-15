import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoInventory } from "../../../magento/inventory.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  INVENTORY_GET_TOOL,
  InventoryGetInputSchema,
  InventoryGetOutputSchema,
  type InventoryGetOutput,
} from "./schemas.js";

function internalFailure(): InventoryGetOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerInventoryGet(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inventory = new MagentoInventory(dependencies.client);
  registerTool(
    INVENTORY_GET_TOOL,
    {
      title: "Get Magento Inventory",
      description: "Get salable quantity and salability for an exact SKU and numeric stock ID.",
      annotations: { readOnlyHint: true },
      inputSchema: InventoryGetInputSchema,
      outputSchema: InventoryGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.INVENTORY_GET,
      inputSchema: InventoryGetInputSchema,
      outputSchema: InventoryGetOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as InventoryGetOutput,
      async execute(input, signal, onAttempt) {
        const result = await inventory.getInventory(input.sku, input.stock_id, signal, onAttempt);
        return {
          ok: true,
          data: {
            sku: input.sku,
            stock_id: input.stock_id,
            salable_quantity: result.salableQuantity,
            is_salable: result.salable,
          },
        };
      },
    }),
  );
}
