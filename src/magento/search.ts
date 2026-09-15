import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";

export const MAGENTO_SEARCH_CONDITION = {
  EQUALS: "eq",
  LIKE: "like",
  GREATER_THAN_OR_EQUAL: "gteq",
  LESS_THAN_OR_EQUAL: "lteq",
} as const;

export type MagentoSearchCondition =
  (typeof MAGENTO_SEARCH_CONDITION)[keyof typeof MAGENTO_SEARCH_CONDITION];

export interface MagentoSearchFilter {
  readonly field: string;
  readonly value: string | number;
  readonly condition: MagentoSearchCondition;
}

export interface MagentoSearchFilterGroup {
  readonly filters: readonly [MagentoSearchFilter, ...MagentoSearchFilter[]];
}

export interface MagentoSearchSortOrder {
  readonly field: string;
  readonly direction: "ASC" | "DESC";
}

export interface MagentoSearchParameters {
  readonly filterGroups: readonly MagentoSearchFilterGroup[];
  readonly sortOrders: readonly [MagentoSearchSortOrder, ...MagentoSearchSortOrder[]];
  readonly pageSize: number;
  readonly currentPage: number;
  readonly fields: string;
}

interface MagentoPage {
  readonly items: readonly unknown[];
}

const MagentoPageItemsSchema = z.object({
  items: z.array(z.unknown()).nullable(),
});

export function parseMagentoPage<T extends MagentoPage>(
  schema: z.ZodType<T>,
  value: unknown,
  pageSize: number,
): T {
  const envelope = MagentoPageItemsSchema.safeParse(value);
  if (!envelope.success || (envelope.data.items?.length ?? 0) > pageSize) {
    throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
  return parsed.data;
}

export function buildMagentoSearchParams(input: MagentoSearchParameters): URLSearchParams {
  const parameters = new URLSearchParams();

  input.filterGroups.forEach((group, groupIndex) => {
    group.filters.forEach((filter, filterIndex) => {
      const prefix = `searchCriteria[filter_groups][${groupIndex}][filters][${filterIndex}]`;
      parameters.append(`${prefix}[field]`, filter.field);
      parameters.append(`${prefix}[value]`, String(filter.value));
      parameters.append(`${prefix}[condition_type]`, filter.condition);
    });
  });
  input.sortOrders.forEach((sort, index) => {
    const prefix = `searchCriteria[sortOrders][${index}]`;
    parameters.append(`${prefix}[field]`, sort.field);
    parameters.append(`${prefix}[direction]`, sort.direction);
  });
  parameters.append("searchCriteria[pageSize]", String(input.pageSize));
  parameters.append("searchCriteria[currentPage]", String(input.currentPage));
  parameters.append("fields", input.fields);
  return parameters;
}
