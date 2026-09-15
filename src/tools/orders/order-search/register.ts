import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createOrderSearchHandler } from "./handler.js";
import {
  createOrderSearchInputSchema,
  ORDER_SEARCH_TOOL,
  OrderSearchOutputSchema,
} from "./schemas.js";

const ORDER_SEARCH_DESCRIPTION =
  "Search Magento orders with allowlisted customer, status, date, and total filters. At least " +
  "one filter is required. Returns paginated summaries with allowlisted customer data.";

export function registerOrderSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createOrderSearchInputSchema(dependencies.maxPageSize);
  registerTool(
    ORDER_SEARCH_TOOL,
    {
      title: "Search Magento Orders",
      description: ORDER_SEARCH_DESCRIPTION,
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: OrderSearchOutputSchema,
    },
    createOrderSearchHandler(dependencies, inputSchema),
  );
}
