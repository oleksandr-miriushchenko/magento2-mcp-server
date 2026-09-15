import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { createSearchCursorCodec } from "../../../core/search-cursor.js";
import {
  MAGENTO_CUSTOMER_SORT,
  MagentoCustomers,
  type MagentoCustomerSort,
} from "../../../magento/customers.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  createCustomerSearchInputSchema,
  CUSTOMER_SEARCH_SORT,
  CUSTOMER_SEARCH_TOOL,
  CustomerSearchOutputSchema,
  type CustomerSearchInput,
  type CustomerSearchOutput,
} from "./schemas.js";

const SORT_MAP: Readonly<Record<CustomerSearchInput["sort"], MagentoCustomerSort>> = {
  [CUSTOMER_SEARCH_SORT.NEWEST]: MAGENTO_CUSTOMER_SORT.CREATED_DESCENDING,
  [CUSTOMER_SEARCH_SORT.OLDEST]: MAGENTO_CUSTOMER_SORT.CREATED_ASCENDING,
  [CUSTOMER_SEARCH_SORT.NAME_A_TO_Z]: MAGENTO_CUSTOMER_SORT.NAME_ASCENDING,
  [CUSTOMER_SEARCH_SORT.NAME_Z_TO_A]: MAGENTO_CUSTOMER_SORT.NAME_DESCENDING,
};

function internalFailure(): CustomerSearchOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerCustomerSearch(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const inputSchema = createCustomerSearchInputSchema(dependencies.maxPageSize);
  const customers = new MagentoCustomers(dependencies.client);
  const cursor = createSearchCursorCodec({
    key: dependencies.cursorKey,
    kind: CUSTOMER_SEARCH_TOOL,
  });
  registerTool(
    CUSTOMER_SEARCH_TOOL,
    {
      title: "Search Magento Customers",
      description: "Search customer accounts and return only allowlisted identity fields.",
      annotations: { readOnlyHint: true },
      inputSchema,
      outputSchema: CustomerSearchOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CUSTOMER_SEARCH,
      inputSchema,
      outputSchema: CustomerSearchOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as CustomerSearchOutput,
      async execute(input, signal, onAttempt) {
        const criteria = {
          customer_id: input.customer_id ?? null,
          email: input.email ?? null,
          name: input.name ?? null,
          group_id: input.group_id ?? null,
          website_id: input.website_id ?? null,
          sort: input.sort,
          page_size: input.page_size,
        };
        const currentPage = input.cursor === undefined ? 1 : cursor.decode(input.cursor, criteria);
        const response = await customers.searchCustomers(
          {
            ...(input.customer_id === undefined ? {} : { customerId: input.customer_id }),
            ...(input.email === undefined ? {} : { email: input.email }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.group_id === undefined ? {} : { groupId: input.group_id }),
            ...(input.website_id === undefined ? {} : { websiteId: input.website_id }),
            sort: SORT_MAP[input.sort],
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
            customers: response.items.map((customer) => ({
              customer_id: customer.id,
              group_id: customer.group_id,
              store_id: customer.store_id,
              website_id: customer.website_id,
              first_name: customer.firstname ?? null,
              last_name: customer.lastname ?? null,
              email: customer.email,
              created_at: customer.created_at,
              updated_at: customer.updated_at,
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
