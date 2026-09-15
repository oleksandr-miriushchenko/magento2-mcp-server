import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createCmsPageUpdateHandler } from "./handler.js";
import {
  CMS_PAGE_UPDATE_TOOL,
  CmsPageUpdateInputSchema,
  CmsPageUpdateOutputSchema,
} from "./schemas.js";

export function registerCmsPageUpdate(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    CMS_PAGE_UPDATE_TOOL,
    {
      title: "Update Magento CMS Page",
      description:
        "Update explicitly allowlisted content or metadata fields on one CMS page. Requires native user approval and an idempotency key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: CmsPageUpdateInputSchema,
      outputSchema: CmsPageUpdateOutputSchema,
    },
    createCmsPageUpdateHandler(dependencies),
  );
}
