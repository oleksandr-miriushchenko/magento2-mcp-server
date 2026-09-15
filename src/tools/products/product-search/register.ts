import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createProductSearchHandler } from "./handler.js";
import {
  createProductSearchInputSchema,
  PRODUCT_SEARCH_TOOL,
  ProductSearchOutputSchema,
} from "./schemas.js";

const PRODUCT_SEARCH_DESCRIPTION =
  "Search the Magento admin product collection with allowlisted catalog filters and semantic " +
  "sorting. Includes disabled and non-storefront-visible products.";

export function registerProductSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createProductSearchInputSchema(dependencies.maxPageSize);
  registerTool(
    PRODUCT_SEARCH_TOOL,
    {
      title: "Search Magento Products",
      description: PRODUCT_SEARCH_DESCRIPTION,
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: ProductSearchOutputSchema,
    },
    createProductSearchHandler(dependencies, inputSchema),
  );
}
