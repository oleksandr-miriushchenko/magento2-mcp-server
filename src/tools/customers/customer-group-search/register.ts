import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import { MagentoCustomers } from "../../../magento/customers.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  createCustomerGroupSearchInputSchema,
  CUSTOMER_GROUP_SEARCH_TOOL,
  CustomerGroupSearchOutputSchema,
  type CustomerGroupSearchOutput,
} from "./schemas.js";

function internalFailure(): CustomerGroupSearchOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerCustomerGroupSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createCustomerGroupSearchInputSchema(dependencies.maxPageSize);
  const customers = new MagentoCustomers(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: CUSTOMER_GROUP_SEARCH_TOOL,
  });
  registerTool(
    CUSTOMER_GROUP_SEARCH_TOOL,
    {
      title: "Search Magento Customer Groups",
      description: "Search customer groups by an allowlisted group-code filter.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: CustomerGroupSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CUSTOMER_GROUP_SEARCH,
      inputSchema,
      outputSchema: CustomerGroupSearchOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as CustomerGroupSearchOutput,
      async execute(input, signal, onAttempt) {
        const criteria = {
          code: input.code ?? null,
          sort: input.sort,
          page_size: input.page_size,
        };
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await customers.searchCustomerGroups(
          {
            ...(input.code === undefined ? {} : { code: input.code }),
            sort: input.sort,
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
            groups: response.items.map((group) => ({
              group_id: group.id,
              code: group.code,
              tax_class_id: group.tax_class_id,
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
