import { AUDIT_TOOL } from "../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../core/errors.js";
import { createSearchCursorCodec } from "../../core/search-cursor.js";
import { MagentoCms } from "../../magento/cms.js";
import type { RawCmsPage } from "../../magento/cms.js";
import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { createReadHandler, defaultReadFailure } from "../shared/read-handler.js";
import { registerCmsPageUpdate } from "./cms-page-update/register.js";
import {
  CMS_PAGE_GET_TOOL,
  CMS_PAGE_SEARCH_TOOL,
  type CmsPageGetData,
  type CmsPageGetFailure,
  CmsPageGetInputSchema,
  CmsPageGetOutputSchema,
  type CmsPageSearchData,
  type CmsPageSearchFailure,
  type CmsPageSearchInput,
  CmsPageSearchOutputSchema,
  createCmsPageSearchInputSchema,
} from "./schemas.js";

function flag(value: boolean | 0 | 1 | null | undefined): boolean | null {
  if (value == null) return null;
  return value === true || value === 1;
}

function sortOrder(value: string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function mapPage(page: RawCmsPage): CmsPageGetData {
  return {
    page_id: page.id,
    identifier: page.identifier,
    title: page.title ?? null,
    is_active: flag(page.active),
    created_at: page.creation_time ?? null,
    updated_at: page.update_time ?? null,
    sort_order: sortOrder(page.sort_order),
    page_layout: page.page_layout ?? null,
    meta_title: page.meta_title ?? null,
    meta_keywords: page.meta_keywords ?? null,
    meta_description: page.meta_description ?? null,
    content_heading: page.content_heading ?? null,
    content: page.content ?? null,
  };
}

function searchInternalFailure(): CmsPageSearchFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}

function getInternalFailure(): CmsPageGetFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}

function searchCriteria(input: CmsPageSearchInput): unknown {
  return {
    identifier: input.identifier ?? null,
    title: input.title ?? null,
    active: input.active ?? null,
    page_size: input.page_size,
  };
}

export function registerCmsTools(registerTool: RegisterTool, dependencies: ToolDependencies): void {
  const cms = new MagentoCms(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: CMS_PAGE_SEARCH_TOOL,
  });
  const searchInputSchema = createCmsPageSearchInputSchema(dependencies.maxPageSize);

  registerTool(
    CMS_PAGE_SEARCH_TOOL,
    {
      title: "Search Magento CMS Pages",
      description: "Search CMS pages by allowlisted metadata without returning page content.",
      annotations: { readOnlyHint: true },
      inputSchema: searchInputSchema,
      outputSchema: CmsPageSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CMS_PAGE_SEARCH,
      inputSchema: searchInputSchema,
      outputSchema: CmsPageSearchOutputSchema,
      internalFailure: searchInternalFailure,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => {
        const criteria = searchCriteria(input);
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await cms.searchPages(
          {
            ...(input.identifier === undefined ? {} : { identifier: input.identifier }),
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.active === undefined ? {} : { active: input.active }),
            pageSize: input.page_size,
            currentPage,
          },
          signal,
          onAttempt,
        );
        const data: CmsPageSearchData = {
          pages: response.items.map((page) => ({
            page_id: page.id,
            identifier: page.identifier,
            title: page.title ?? null,
            is_active: flag(page.active),
            created_at: page.creation_time ?? null,
            updated_at: page.update_time ?? null,
            sort_order: sortOrder(page.sort_order),
          })),
          total_count: response.total_count,
          page_size: input.page_size,
          next_cursor:
            response.items.length > 0 && currentPage * input.page_size < response.total_count
              ? cursor.encode(currentPage + 1, criteria)
              : null,
        };
        return { ok: true, data };
      },
    }),
  );

  registerTool(
    CMS_PAGE_GET_TOOL,
    {
      title: "Get Magento CMS Page",
      description:
        "Get one CMS page by numeric entity ID with only approved content and metadata fields.",
      annotations: { readOnlyHint: true },
      inputSchema: CmsPageGetInputSchema,
      outputSchema: CmsPageGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CMS_PAGE_GET,
      inputSchema: CmsPageGetInputSchema,
      outputSchema: CmsPageGetOutputSchema,
      internalFailure: getInternalFailure,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => ({
        ok: true,
        data: mapPage(await cms.getPage(input.page_id, signal, onAttempt)),
      }),
    }),
  );

  registerCmsPageUpdate(registerTool, dependencies);
}
