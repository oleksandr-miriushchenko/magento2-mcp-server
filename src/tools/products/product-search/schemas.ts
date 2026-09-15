import { z } from "zod";

import { createPageInputSchema } from "../../../core/pagination.js";
import { RESOURCE_ERROR_CODE, PAGINATION_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const PRODUCT_SEARCH_TOOL = "product_search";

export const PRODUCT_SEARCH_SORT = {
  NEWEST: "newest",
  OLDEST: "oldest",
  NAME_A_TO_Z: "name_a_to_z",
  NAME_Z_TO_A: "name_z_to_a",
  PRICE_LOW_TO_HIGH: "price_low_to_high",
  PRICE_HIGH_TO_LOW: "price_high_to_low",
} as const;

export const PRODUCT_STATUS = {
  ENABLED: "enabled",
  DISABLED: "disabled",
} as const;

export const PRODUCT_VISIBILITY = {
  NOT_VISIBLE: "not_visible",
  CATALOG: "catalog",
  SEARCH: "search",
  CATALOG_SEARCH: "catalog_search",
} as const;

export const PRODUCT_TYPE = {
  SIMPLE: "simple",
  CONFIGURABLE: "configurable",
  GROUPED: "grouped",
  BUNDLE: "bundle",
  VIRTUAL: "virtual",
  DOWNLOADABLE: "downloadable",
} as const;

export const PRODUCT_SEARCH_ERROR_CODE = {
  ...RESOURCE_ERROR_CODE,
  ...PAGINATION_ERROR_CODE,
} as const;

const ProductSearchItemSchema = z.strictObject({
  product_id: z.number().int().positive(),
  sku: z.string().min(1),
  name: z.string().min(1),
  product_type: z.string().min(1),
  status: z.enum(PRODUCT_STATUS),
  visibility: z.enum(PRODUCT_VISIBILITY),
  price: z.number().nullable(),
  attribute_set_id: z.number().int().positive(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
});

const ProductSearchDataSchema = z.strictObject({
  products: z.array(ProductSearchItemSchema),
  total_count: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  next_cursor: z.string().min(1).nullable(),
});

export const ProductSearchErrorCodeSchema = z.enum(PRODUCT_SEARCH_ERROR_CODE);

export function createProductSearchInputSchema(maxPageSize: number) {
  const page = createPageInputSchema(maxPageSize);
  return z
    .strictObject({
      search: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("Magento LIKE substring search across product name OR SKU."),
      sku: z.string().trim().min(1).max(64).optional().describe("Exact product SKU."),
      status: z.enum(PRODUCT_STATUS).optional().describe("Admin product status."),
      visibility: z
        .enum(PRODUCT_VISIBILITY)
        .optional()
        .describe("Admin catalog visibility, including products hidden from the storefront."),
      product_type: z.enum(PRODUCT_TYPE).optional().describe("Standard Magento product type."),
      price_min: z.number().nonnegative().optional().describe("Minimum product price, inclusive."),
      price_max: z.number().nonnegative().optional().describe("Maximum product price, inclusive."),
      sort: z
        .enum(PRODUCT_SEARCH_SORT)
        .default(PRODUCT_SEARCH_SORT.NEWEST)
        .describe("Semantic product sorting; Magento field names are not accepted."),
      ...page.shape,
    })
    .superRefine((input, context) => {
      if (
        input.price_min !== undefined &&
        input.price_max !== undefined &&
        input.price_min > input.price_max
      ) {
        context.addIssue({
          code: "custom",
          path: ["price_max"],
          message: "price_max must not be less than price_min.",
        });
      }
    });
}

const ProductSearchResultSchemas = createToolResultSchemas(
  ProductSearchDataSchema,
  ProductSearchErrorCodeSchema,
);
export const ProductSearchOutputSchema = ProductSearchResultSchemas.output;

export type ProductSearchInputSchema = ReturnType<typeof createProductSearchInputSchema>;
export type ProductSearchInput = z.infer<ProductSearchInputSchema>;
export type ProductSearchData = z.infer<typeof ProductSearchDataSchema>;
export type ProductSearchFailure = z.infer<typeof ProductSearchResultSchemas.failure>;
export type ProductSearchOutput = z.infer<typeof ProductSearchOutputSchema>;
