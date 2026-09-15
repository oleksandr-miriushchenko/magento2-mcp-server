import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import { MagentoInventory } from "../../../magento/inventory.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  createInventoryStockSearchInputSchema,
  INVENTORY_STOCK_SEARCH_TOOL,
  InventoryStockSearchOutputSchema,
  type InventoryStockSearchOutput,
} from "./schemas.js";

function internalFailure(): InventoryStockSearchOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerInventoryStockSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createInventoryStockSearchInputSchema(dependencies.maxPageSize);
  const inventory = new MagentoInventory(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: INVENTORY_STOCK_SEARCH_TOOL,
  });
  registerTool(
    INVENTORY_STOCK_SEARCH_TOOL,
    {
      title: "Search Magento Inventory Stocks",
      description: "Search inventory stocks and their website sales-channel assignments.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: InventoryStockSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.INVENTORY_STOCK_SEARCH,
      inputSchema,
      outputSchema: InventoryStockSearchOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as InventoryStockSearchOutput,
      async execute(input, signal, onAttempt) {
        const criteria = { name: input.name ?? null, page_size: input.page_size };
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await inventory.searchInventoryStocks(
          {
            ...(input.name === undefined ? {} : { name: input.name }),
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
            stocks: response.items.map((stock) => ({
              stock_id: stock.stock_id,
              name: stock.name,
              sales_channels: stock.extension_attributes?.sales_channels ?? [],
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
