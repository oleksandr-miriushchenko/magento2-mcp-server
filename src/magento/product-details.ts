import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";
import {
  buildMagentoSearchParams,
  MAGENTO_SEARCH_CONDITION,
  parseMagentoPage,
  type MagentoSearchFilterGroup,
} from "./search.js";
import { MagentoDateTimeSchema } from "./schemas.js";

const RawCategoryLinkSchema = z.object({
  category_id: z.string().regex(/^\d+$/),
  position: z.number().int().optional(),
});

const RawProductDetailsSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  attribute_set_id: z.number().int().positive(),
  price: z.number().nullable(),
  status: z.union([z.literal(1), z.literal(2)]),
  visibility: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  type_id: z.string().min(1),
  weight: z.number().nonnegative().nullish(),
  created_at: MagentoDateTimeSchema,
  updated_at: MagentoDateTimeSchema,
  extension_attributes: z
    .object({ category_links: z.array(RawCategoryLinkSchema).nullish() })
    .nullish(),
});

const RawAttributeOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const RawMagentoBooleanSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .transform((value) => value === true || value === 1 || value === "1");

const RawProductAttributeSchema = z.object({
  attribute_id: z.number().int().positive(),
  attribute_code: z.string().min(1),
  frontend_input: z.string().nullish(),
  default_frontend_label: z.string().nullish(),
  is_required: RawMagentoBooleanSchema.default(false),
  is_unique: RawMagentoBooleanSchema.default(false),
  is_user_defined: RawMagentoBooleanSchema.default(false),
  is_visible_on_front: RawMagentoBooleanSchema.default(false),
  used_in_product_listing: RawMagentoBooleanSchema.default(false),
  is_filterable: RawMagentoBooleanSchema.default(false),
  is_filterable_in_search: RawMagentoBooleanSchema.default(false),
  is_searchable: RawMagentoBooleanSchema.default(false),
  is_comparable: RawMagentoBooleanSchema.default(false),
  scope: z.string().nullish(),
  options: z.array(RawAttributeOptionSchema).nullish(),
});

const RawProductAttributeSearchResponseSchema = z.object({
  items: z
    .array(RawProductAttributeSchema.omit({ options: true }))
    .nullable()
    .transform((items) => items ?? []),
  total_count: z.number().int().nonnegative(),
});

const RawCategorySchema: z.ZodType<RawCategory> = z.lazy(() =>
  z.object({
    id: z.number().int().positive(),
    parent_id: z.number().int().nonnegative(),
    name: z.string().min(1),
    is_active: z.boolean(),
    position: z.number().int().nonnegative(),
    level: z.number().int().nonnegative(),
    product_count: z.number().int().nonnegative(),
    children_data: z.array(RawCategorySchema).default([]),
  }),
);

export interface RawCategory {
  readonly id: number;
  readonly parent_id: number;
  readonly name: string;
  readonly is_active: boolean;
  readonly position: number;
  readonly level: number;
  readonly product_count: number;
  readonly children_data: readonly RawCategory[];
}

export type RawProductDetails = z.infer<typeof RawProductDetailsSchema>;
export type RawProductAttribute = z.infer<typeof RawProductAttributeSchema>;
export type RawProductAttributeSearchResponse = z.infer<
  typeof RawProductAttributeSearchResponseSchema
>;

export interface MagentoProductAttributeSearchRequest {
  readonly code?: string;
  readonly label?: string;
  readonly userDefined?: boolean;
  readonly pageSize: number;
  readonly currentPage: number;
}

export interface ProductDetailsReader {
  getProduct(sku: string, signal: AbortSignal, onAttempt?: () => void): Promise<RawProductDetails>;
}

export interface ProductAttributeReader {
  getProductAttribute(
    attributeCode: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductAttribute>;
}

export interface ProductAttributeSearcher {
  searchProductAttributes(
    request: MagentoProductAttributeSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductAttributeSearchResponse>;
}

export interface CategoryTreeReader {
  getCategoryTree(
    rootCategoryId: number | undefined,
    depth: number | undefined,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCategory>;
}

export interface MagentoProductUpdate {
  readonly name?: string;
  readonly price?: number;
  readonly status?: 1 | 2;
  readonly visibility?: 1 | 2 | 3 | 4;
  readonly weight?: number;
}

export interface ProductWriter {
  updateProduct(
    sku: string,
    changes: MagentoProductUpdate,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void>;
}

const PRODUCT_FIELDS =
  "id,sku,name,attribute_set_id,price,status,visibility,type_id,weight,created_at,updated_at," +
  "extension_attributes[category_links[category_id,position]]";
const ATTRIBUTE_SEARCH_FIELDS =
  "items[attribute_id,attribute_code,frontend_input,default_frontend_label,is_required,is_unique," +
  "is_user_defined,is_visible_on_front,used_in_product_listing,is_filterable," +
  "is_filterable_in_search,is_searchable,is_comparable,scope],total_count";
const ATTRIBUTE_GET_FIELDS =
  "attribute_id,attribute_code,frontend_input,default_frontend_label,is_required,is_unique," +
  "is_user_defined,is_visible_on_front,used_in_product_listing,is_filterable," +
  "is_filterable_in_search,is_searchable,is_comparable,scope,options[label,value]";
const CATEGORY_FIELDS = "id,parent_id,name,is_active,position,level,product_count,children_data";

export class MagentoProductDetails
  implements
    ProductDetailsReader,
    ProductAttributeReader,
    ProductAttributeSearcher,
    CategoryTreeReader,
    ProductWriter
{
  readonly #client: MagentoClient;

  constructor(client: MagentoClient) {
    this.#client = client;
  }

  async getProduct(
    sku: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductDetails> {
    const query = new URLSearchParams({ fields: PRODUCT_FIELDS });
    const json = await this.#client.getJson(
      ["V1", "products", sku],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    const parsed = RawProductDetailsSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async searchProductAttributes(
    request: MagentoProductAttributeSearchRequest,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductAttributeSearchResponse> {
    const filters: MagentoSearchFilterGroup[] = [];
    const addLike = (field: "attribute_code" | "default_frontend_label", value?: string): void => {
      if (value !== undefined) {
        filters.push({
          filters: [{ field, value: `%${value}%`, condition: MAGENTO_SEARCH_CONDITION.LIKE }],
        });
      }
    };
    addLike("attribute_code", request.code);
    addLike("default_frontend_label", request.label);
    if (request.userDefined !== undefined) {
      filters.push({
        filters: [
          {
            field: "is_user_defined",
            value: request.userDefined ? 1 : 0,
            condition: MAGENTO_SEARCH_CONDITION.EQUALS,
          },
        ],
      });
    }
    const query = buildMagentoSearchParams({
      filterGroups: filters,
      sortOrders: [{ field: "attribute_id", direction: "ASC" }],
      pageSize: request.pageSize,
      currentPage: request.currentPage,
      fields: ATTRIBUTE_SEARCH_FIELDS,
    });
    const json = await this.#client.getJson(
      ["V1", "products", "attributes"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    return parseMagentoPage(RawProductAttributeSearchResponseSchema, json, request.pageSize);
  }

  async getProductAttribute(
    attributeCode: string,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawProductAttribute> {
    const query = new URLSearchParams({ fields: ATTRIBUTE_GET_FIELDS });
    const json = await this.#client.getJson(
      ["V1", "products", "attributes", attributeCode],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    const parsed = RawProductAttributeSchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async getCategoryTree(
    rootCategoryId: number | undefined,
    depth: number | undefined,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<RawCategory> {
    const query = new URLSearchParams({ fields: CATEGORY_FIELDS });
    if (rootCategoryId !== undefined) query.set("rootCategoryId", String(rootCategoryId));
    if (depth !== undefined) query.set("depth", String(depth));
    const json = await this.#client.getJson(
      ["V1", "categories"],
      onAttempt === undefined ? { signal, query } : { signal, onAttempt, query },
    );
    const parsed = RawCategorySchema.safeParse(json);
    if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    return parsed.data;
  }

  async updateProduct(
    sku: string,
    changes: MagentoProductUpdate,
    signal: AbortSignal,
    onAttempt?: () => void,
  ): Promise<void> {
    const json = await this.#client.putJson(
      ["V1", "products", sku],
      {
        product: {
          sku,
          ...(changes.name === undefined ? {} : { name: changes.name }),
          ...(changes.price === undefined ? {} : { price: changes.price }),
          ...(changes.status === undefined ? {} : { status: changes.status }),
          ...(changes.visibility === undefined ? {} : { visibility: changes.visibility }),
          ...(changes.weight === undefined ? {} : { weight: changes.weight }),
        },
      },
      onAttempt === undefined ? { signal } : { signal, onAttempt },
    );
    const parsed = z.object({ sku: z.string().min(1) }).safeParse(json);
    if (!parsed.success || parsed.data.sku !== sku) {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }
  }
}
