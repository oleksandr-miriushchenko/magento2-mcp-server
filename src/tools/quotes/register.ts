import type { ToolCallback } from "@modelcontextprotocol/server";

import { AUDIT_TOOL } from "../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../core/errors.js";
import { createSearchCursorCodec } from "../../core/search-cursor.js";
import { MagentoQuotes } from "../../magento/quotes.js";
import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { createReadHandler, defaultReadFailure } from "../shared/read-handler.js";
import {
  createQuoteSearchInputSchema,
  QUOTE_SEARCH_TOOL,
  type QuoteSearchData,
  type QuoteSearchFailure,
  type QuoteSearchInput,
  type QuoteSearchInputSchema,
  QuoteSearchOutputSchema,
} from "./schemas.js";

function internalFailure(): QuoteSearchFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}

function criteria(input: QuoteSearchInput): unknown {
  return {
    active: input.active,
    customer_id: input.customer_id ?? null,
    updated_from: input.updated_from ?? null,
    updated_to: input.updated_to ?? null,
    page_size: input.page_size,
  };
}

function createHandler(
  dependencies: ToolDependencies,
  inputSchema: QuoteSearchInputSchema,
): ToolCallback<QuoteSearchInputSchema> {
  const quotes = new MagentoQuotes(dependencies.client);
  const cursor = createSearchCursorCodec({ key: dependencies.cursorKey, kind: QUOTE_SEARCH_TOOL });
  return createReadHandler({
    dependencies,
    tool: AUDIT_TOOL.QUOTE_SEARCH,
    inputSchema,
    outputSchema: QuoteSearchOutputSchema,
    internalFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => {
      const boundCriteria = criteria(input);
      const currentPage =
        input.cursor === undefined ? 1 : cursor.decode(input.cursor, boundCriteria);
      const response = await quotes.searchQuotes(
        {
          active: input.active,
          ...(input.customer_id === undefined ? {} : { customerId: input.customer_id }),
          ...(input.updated_from === undefined
            ? {}
            : { updatedFrom: `${input.updated_from} 00:00:00` }),
          ...(input.updated_to === undefined ? {} : { updatedTo: `${input.updated_to} 23:59:59` }),
          pageSize: input.page_size,
          currentPage,
        },
        signal,
        onAttempt,
      );
      const data: QuoteSearchData = {
        quotes: response.items.map((quote) => ({
          quote_id: quote.id,
          store_id: quote.store_id,
          created_at: quote.created_at,
          updated_at: quote.updated_at,
          is_active: quote.is_active,
          is_virtual: quote.is_virtual,
          items_count: quote.items_count,
          items_quantity: quote.items_qty,
          currency_code: quote.currency?.quote_currency_code ?? null,
          customer: {
            first_name: quote.customer?.firstname ?? null,
            last_name: quote.customer?.lastname ?? null,
            email: quote.customer?.email ?? null,
          },
        })),
        total_count: response.total_count,
        page_size: input.page_size,
        next_cursor:
          response.items.length > 0 && currentPage * input.page_size < response.total_count
            ? cursor.encode(currentPage + 1, boundCriteria)
            : null,
      };
      return { ok: true, data };
    },
  });
}

export function registerQuoteTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createQuoteSearchInputSchema(dependencies.maxPageSize);
  registerTool(
    QUOTE_SEARCH_TOOL,
    {
      title: "Search Magento Quotes",
      description: "Search active or inactive Magento carts with allowlisted customer data.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: QuoteSearchOutputSchema,
    },
    createHandler(dependencies, inputSchema),
  );
}
