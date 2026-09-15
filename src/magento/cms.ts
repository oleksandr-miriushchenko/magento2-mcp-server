import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import { buildMagentoSearchParams, MAGENTO_SEARCH_CONDITION, parseMagentoPage } from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const MagentoFlagSchema = z.boolean().or(z.literal(0)).or(z.literal(1));
const NullableIntegerStringSchema = z
  .union([z.string().regex(/^-?\d{1,9}$/), z.number().int().transform(String)])
  .nullish();

const RawCmsPageSummarySchema = z.object({
  id: z.number().int().positive(),
  identifier: z.string().min(1),
  title: z.string().nullish(),
  active: MagentoFlagSchema.nullish(),
  creation_time: MagentoDateTimeSchema.nullish(),
  update_time: MagentoDateTimeSchema.nullish(),
  sort_order: NullableIntegerStringSchema,
});

const RawCmsPageSchema = RawCmsPageSummarySchema.extend({
  page_layout: z.string().nullish(),
  meta_title: z.string().nullish(),
  meta_keywords: z.string().nullish(),
  meta_description: z.string().nullish(),
  content_heading: z.string().nullish(),
  content: z.string().max(100_000).nullish(),
});

const RawCmsPageSearchResponseSchema = z.object({
  items: z
    .array(RawCmsPageSummarySchema)
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

export type RawCmsPage = z.infer<typeof RawCmsPageSchema>;
export type RawCmsPageSearchResponse = z.infer<typeof RawCmsPageSearchResponseSchema>;

export interface MagentoCmsPageSearchRequest {
  readonly identifier?: string;
  readonly title?: string;
  readonly active?: boolean;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface CmsReader {
  searchPages(
    request: MagentoCmsPageSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCmsPageSearchResponse>;
  getPage(pageId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawCmsPage>;
}

export interface MagentoCmsPageUpdate {
  readonly title?: string;
  readonly content?: string;
  readonly isActive?: boolean;
  readonly metaTitle?: string | null;
  readonly metaKeywords?: string | null;
  readonly metaDescription?: string | null;
  readonly contentHeading?: string | null;
}

export interface CmsWriter {
  updatePage(
    pageId: number,
    page: MagentoCmsPageUpdate,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void>;
}

const CMS_PAGE_SEARCH_FIELDS =
  "items[id,identifier,title,active,creation_time,update_time,sort_order],total_count";
const CMS_PAGE_FIELDS =
  "id,identifier,title,active,creation_time,update_time,sort_order,page_layout,meta_title," +
  "meta_keywords,meta_description,content_heading,content";

export class MagentoCms implements CmsReader, CmsWriter {
  constructor(private readonly client: MagentoClient) {}

  async searchPages(
    request: MagentoCmsPageSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCmsPageSearchResponse> {
    const filterGroups = [
      ...(request.identifier === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "identifier",
                  value: request.identifier,
                  condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                },
              ] as const,
            },
          ]),
      ...(request.title === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "title",
                  value: `%${request.title}%`,
                  condition: MAGENTO_SEARCH_CONDITION.LIKE,
                },
              ] as const,
            },
          ]),
      ...(request.active === undefined
        ? []
        : [
            {
              filters: [
                {
                  field: "is_active",
                  value: request.active ? 1 : 0,
                  condition: MAGENTO_SEARCH_CONDITION.EQUALS,
                },
              ] as const,
            },
          ]),
    ];
    const query = buildMagentoSearchParams({
      filterGroups,
      sortOrders: [
        { field: "update_time", direction: "DESC" },
        { field: "page_id", direction: "DESC" },
      ],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: CMS_PAGE_SEARCH_FIELDS,
    });
    const raw = await this.client.getJson(["V1", "cmsPage", "search"], {
      signal,
      query,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    });
    return parseMagentoPage(RawCmsPageSearchResponseSchema, raw, request.pageSize);
  }

  async getPage(pageId: number, signal: AbortSignal, onAttempt?: () => void): Promise<RawCmsPage> {
    const query = new URLSearchParams({ fields: CMS_PAGE_FIELDS });
    const raw = await this.client.getJson(["V1", "cmsPage", String(pageId)], {
      signal,
      query,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    });
    const parsed = RawCmsPageSchema.safeParse(raw);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async updatePage(
    pageId: number,
    page: MagentoCmsPageUpdate,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    const raw = await this.client.putJson(
      ["V1", "cmsPage", String(pageId)],
      {
        page: {
          id: pageId,
          ...(page.title === undefined ? {} : { title: page.title }),
          ...(page.content === undefined ? {} : { content: page.content }),
          ...(page.isActive === undefined ? {} : { active: page.isActive }),
          ...(page.metaTitle === undefined ? {} : { meta_title: page.metaTitle }),
          ...(page.metaKeywords === undefined ? {} : { meta_keywords: page.metaKeywords }),
          ...(page.metaDescription === undefined ? {} : { meta_description: page.metaDescription }),
          ...(page.contentHeading === undefined ? {} : { content_heading: page.contentHeading }),
        },
      },
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    const parsed = z.object({ id: z.number().int().positive() }).safeParse(raw);
    if (!parsed.success || parsed.data.id !== pageId) {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }
  }
}
