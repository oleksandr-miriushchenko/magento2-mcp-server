import { AUDIT_TOOL } from "../../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoCustomers } from "../../../magento/customers.js";
import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  CUSTOMER_GET_TOOL,
  CustomerGetInputSchema,
  CustomerGetOutputSchema,
  type CustomerGetOutput,
} from "./schemas.js";

function internalFailure(): CustomerGetOutput {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

export function registerCustomerGet(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const customers = new MagentoCustomers(dependencies.client);
  registerTool(
    CUSTOMER_GET_TOOL,
    {
      title: "Get Magento Customer",
      description: "Retrieve one customer account by numeric ID with allowlisted customer data.",
      annotations: { readOnlyHint: true },
      inputSchema: CustomerGetInputSchema,
      outputSchema: CustomerGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CUSTOMER_GET,
      inputSchema: CustomerGetInputSchema,
      outputSchema: CustomerGetOutputSchema,
      internalFailure,
      failure: (error) => defaultReadFailure(error) as CustomerGetOutput,
      async execute(input, signal, onAttempt) {
        const customer = await customers.getCustomer(input.customer_id, signal, onAttempt);
        return {
          ok: true,
          data: {
            customer_id: customer.id,
            group_id: customer.group_id,
            store_id: customer.store_id,
            website_id: customer.website_id,
            first_name: customer.firstname ?? null,
            last_name: customer.lastname ?? null,
            email: customer.email,
            created_at: customer.created_at,
            updated_at: customer.updated_at,
            addresses: customer.addresses.map((address) => ({
              address_id: address.id,
              first_name: address.firstname ?? null,
              last_name: address.lastname ?? null,
              company: address.company ?? null,
              street: address.street ?? null,
              city: address.city ?? null,
              region: address.region?.region ?? null,
              region_code: address.region?.region_code ?? null,
              postcode: address.postcode ?? null,
              country_code: address.country_id ?? null,
              telephone: address.telephone ?? null,
              is_default_shipping:
                address.default_shipping ?? String(address.id) === customer.default_shipping,
              is_default_billing:
                address.default_billing ?? String(address.id) === customer.default_billing,
            })),
          },
        };
      },
    }),
  );
}
