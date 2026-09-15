import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoCms } from "../../../magento/cms.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  CMS_PAGE_UPDATE_TOOL,
  type CmsPageUpdateInput,
  CmsPageUpdateInputSchema,
  CmsPageUpdateOutputSchema,
  type CmsPageUpdateSuccess,
} from "./schemas.js";
import { createCmsPageUpdateWorkflow } from "./workflow.js";

function approvalMessage(input: CmsPageUpdateInput): string {
  const fields = [
    ["Title", input.title],
    ["Content (replace entire page content)", input.content],
    ["Active", input.active],
    ["Meta title", input.meta_title],
    ["Meta keywords", input.meta_keywords],
    ["Meta description", input.meta_description],
    ["Content heading", input.content_heading],
  ] as const;
  const changes = fields
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `- ${label}: ${JSON.stringify(value)}`)
    .join("\n");
  return `Update Magento CMS page ${input.page_id} with these values?\n${changes}`;
}

export function createCmsPageUpdateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof CmsPageUpdateInputSchema> {
  const workflow = createCmsPageUpdateWorkflow(
    new MagentoCms(dependencies.client),
    dependencies.idempotency.forTool<CmsPageUpdateSuccess>(CMS_PAGE_UPDATE_TOOL),
  );

  return createWriteHandler({
    dependencies,
    tool: CMS_PAGE_UPDATE_TOOL,
    inputSchema: CmsPageUpdateInputSchema,
    outputSchema: CmsPageUpdateOutputSchema,
    workflow,
    approvalMessage,
  });
}
