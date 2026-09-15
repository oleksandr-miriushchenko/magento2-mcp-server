import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { CmsWriter, MagentoCmsPageUpdate } from "../../../magento/cms.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import {
  CMS_PAGE_UPDATE_TOOL,
  type CmsPageUpdateInput,
  type CmsPageUpdateSuccess,
} from "./schemas.js";

function fingerprint(input: CmsPageUpdateInput): string {
  return canonicalDigest({ page_id: input.page_id, changes: changes(input) });
}

function changes(input: CmsPageUpdateInput): MagentoCmsPageUpdate {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.active === undefined ? {} : { isActive: input.active }),
    ...(input.meta_title === undefined ? {} : { metaTitle: input.meta_title }),
    ...(input.meta_keywords === undefined ? {} : { metaKeywords: input.meta_keywords }),
    ...(input.meta_description === undefined ? {} : { metaDescription: input.meta_description }),
    ...(input.content_heading === undefined ? {} : { contentHeading: input.content_heading }),
  };
}

export type CmsPageUpdateWorkflow = IdempotentWriteWorkflow<
  CmsPageUpdateInput,
  CmsPageUpdateSuccess
>;

export function createCmsPageUpdateWorkflow(
  cms: CmsWriter,
  idempotency: IdempotencyStore<CmsPageUpdateSuccess>,
): CmsPageUpdateWorkflow {
  return createIdempotentWriteWorkflow({
    tool: CMS_PAGE_UPDATE_TOOL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await cms.updatePage(input.page_id, changes(input), signal, onAttempt);
      return { ok: true, data: { page_id: input.page_id, updated: true } };
    },
  });
}
