import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createProductUpdateHandler } from "./handler.js";
import {
  PRODUCT_UPDATE_TOOL,
  ProductUpdateInputSchema,
  ProductUpdateOutputSchema,
} from "./schemas.js";

export function registerProductUpdate(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    PRODUCT_UPDATE_TOOL,
    {
      title: "Update Magento Product",
      description:
        "Update allowlisted standard product fields after native approval. Requires an idempotency key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: ProductUpdateInputSchema,
      outputSchema: ProductUpdateOutputSchema,
    },
    createProductUpdateHandler(dependencies),
  );
}
