import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createOrderGetHandler } from "./handler.js";
import { ORDER_GET_TOOL, OrderGetInputSchema, OrderGetOutputSchema } from "./schemas.js";

const ORDER_GET_DESCRIPTION =
  "Retrieve one Magento order by its positive numeric entity ID, not its increment or order number.";

export function registerOrderGet(registerTool: RegisterTool, dependencies: ToolDependencies): void {
  registerTool(
    ORDER_GET_TOOL,
    {
      title: "Get Magento Order",
      description: ORDER_GET_DESCRIPTION,
      annotations: { readOnlyHint: true },
      inputSchema: OrderGetInputSchema,
      outputSchema: OrderGetOutputSchema,
    },
    createOrderGetHandler(dependencies),
  );
}
