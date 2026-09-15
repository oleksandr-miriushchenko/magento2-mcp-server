import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import { MagentoInventory } from "../../../magento/inventory.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  createInventorySourceSearchInputSchema,
  INVENTORY_SOURCE_SEARCH_TOOL,
  InventorySourceSearchOutputSchema,
  type InventorySourceSearchOutput,
} from "./schemas.js";

function internalFailure(): InventorySourceSearchOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerInventorySourceSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createInventorySourceSearchInputSchema(dependencies.maxPageSize);
  const inventory = new MagentoInventory(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: INVENTORY_SOURCE_SEARCH_TOOL,
  });
  registerTool(
    INVENTORY_SOURCE_SEARCH_TOOL,
    {
      title: "Search Magento Inventory Sources",
      description: "Search inventory sources without returning contact or address PII.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: InventorySourceSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.INVENTORY_SOURCE_SEARCH,
      inputSchema,
      outputSchema: InventorySourceSearchOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as InventorySourceSearchOutput,
      async execute(input, signal, onAttempt) {
        const criteria = {
          source_code: input.source_code ?? null,
          name: input.name ?? null,
          enabled: input.enabled ?? null,
          country_code: input.country_code ?? null,
          page_size: input.page_size,
        };
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await inventory.searchInventorySources(
          {
            ...(input.source_code === undefined ? {} : { sourceCode: input.source_code }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.country_code === undefined ? {} : { countryCode: input.country_code }),
            pageSize: input.page_size,
            currentPage,
          },
          signal,
          onAttempt,
        );
        const hasNext =
          response.items.length > 0 && currentPage * input.page_size < response.total_count;
        return {
          ok: true,
          data: {
            sources: response.items.map((source) => ({
              source_code: source.source_code,
              name: source.name,
              enabled: source.enabled,
              description: source.description ?? null,
              country_code: source.country_id ?? null,
            })),
            total_count: response.total_count,
            page_size: input.page_size,
            next_cursor: hasNext ? cursor.encode(currentPage + 1, criteria) : null,
          },
        };
      },
    }),
  );
}
