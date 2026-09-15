import { z } from "zod";

import { createPageInputSchema } from "../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../shared/error-codes.js";
import { createToolResultSchemas } from "../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../shared/schemas.js";

export const CMS_PAGE_SEARCH_TOOL = "cms_page_search";
export const CMS_PAGE_GET_TOOL = "cms_page_get";

export const CMS_PAGE_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;
export const CMS_PAGE_GET_ERROR_CODE = RESOURCE_ERROR_CODE;

const CmsPageSummarySchema = z.strictObject({
  page_id: z.number().int().positive(),
  identifier: z.string().min(1),
  title: z.string().nullable(),
  is_active: z.boolean().nullable(),
  created_at: MagentoDateTimeOutputSchema.nullable(),
  updated_at: MagentoDateTimeOutputSchema.nullable(),
  sort_order: z.number().int().nullable(),
});

const CmsPageSchema = CmsPageSummarySchema.extend({
  page_layout: z.string().nullable(),
  meta_title: z.string().nullable(),
  meta_keywords: z.string().nullable(),
  meta_description: z.string().nullable(),
  content_heading: z.string().nullable(),
  content: z.string().max(100_000).nullable(),
});

const CmsPageSearchDataSchema = z.strictObject({
  pages: z.array(CmsPageSummarySchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const CmsPageSearchErrorCodeSchema = z.enum(CMS_PAGE_SEARCH_ERROR_CODE);

export function createCmsPageSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z.strictObject({
    identifier: z.string().trim().min(1).max(255).optional(),
    title: z.string().trim().min(1).max(255).optional(),
    active: z.boolean().optional(),
    ...page.shape,
  });
}

const CmsPageSearchResultSchemas = createToolResultSchemas(
  CmsPageSearchDataSchema,
  CmsPageSearchErrorCodeSchema,
);
export const CmsPageSearchOutputSchema = CmsPageSearchResultSchemas.output;

export const CmsPageGetInputSchema = z.strictObject({ page_id: z.number().int().positive() });

export const CmsPageGetErrorCodeSchema = z.enum(CMS_PAGE_GET_ERROR_CODE);

const CmsPageGetResultSchemas = createToolResultSchemas(CmsPageSchema, CmsPageGetErrorCodeSchema);
export const CmsPageGetOutputSchema = CmsPageGetResultSchemas.output;

export type CmsPageSearchInputSchema = ReturnType<typeof createCmsPageSearchInputSchema>;
export type CmsPageSearchInput = z.infer<CmsPageSearchInputSchema>;
export type CmsPageSearchData = z.infer<typeof CmsPageSearchDataSchema>;
export type CmsPageSearchFailure = z.infer<typeof CmsPageSearchResultSchemas.failure>;
export type CmsPageSearchOutput = z.infer<typeof CmsPageSearchOutputSchema>;
export type CmsPageGetData = z.infer<typeof CmsPageSchema>;
export type CmsPageGetFailure = z.infer<typeof CmsPageGetResultSchemas.failure>;
export type CmsPageGetOutput = z.infer<typeof CmsPageGetOutputSchema>;
