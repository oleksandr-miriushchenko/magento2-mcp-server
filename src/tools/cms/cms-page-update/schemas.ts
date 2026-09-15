import { z } from "zod";

import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";

export const CMS_PAGE_UPDATE_TOOL = "cms_page_update";

export const CMS_PAGE_UPDATE_ERROR_CODE = WRITE_ERROR_CODE;

const NullableMetadataSchema = z.string().trim().max(255).nullable();

export const CmsPageUpdateInputSchema = z
  .strictObject({
    page_id: z.number().int().positive(),
    title: z.string().trim().min(1).max(255).optional(),
    content: z.string().max(100_000).optional(),
    active: z.boolean().optional(),
    meta_title: NullableMetadataSchema.optional(),
    meta_keywords: NullableMetadataSchema.optional(),
    meta_description: NullableMetadataSchema.optional(),
    content_heading: NullableMetadataSchema.optional(),
    idempotency_key: z.uuid(),
  })
  .superRefine((input, context) => {
    if (
      input.title === undefined &&
      input.content === undefined &&
      input.active === undefined &&
      input.meta_title === undefined &&
      input.meta_keywords === undefined &&
      input.meta_description === undefined &&
      input.content_heading === undefined
    ) {
      context.addIssue({ code: "custom", message: "At least one page field must be updated." });
    }
  });

const CmsPageUpdateDataSchema = z.strictObject({
  page_id: z.number().int().positive(),
  updated: z.literal(true),
});

const CmsPageUpdateErrorCodeSchema = z.enum(CMS_PAGE_UPDATE_ERROR_CODE);

const CmsPageUpdateResultSchemas = createToolResultSchemas(
  CmsPageUpdateDataSchema,
  CmsPageUpdateErrorCodeSchema,
);
export const CmsPageUpdateSuccessSchema = CmsPageUpdateResultSchemas.success;
export const CmsPageUpdateOutputSchema = CmsPageUpdateResultSchemas.output;

export type CmsPageUpdateInput = z.infer<typeof CmsPageUpdateInputSchema>;
export type CmsPageUpdateSuccess = z.infer<typeof CmsPageUpdateSuccessSchema>;
export type CmsPageUpdateOutput = z.infer<typeof CmsPageUpdateOutputSchema>;
