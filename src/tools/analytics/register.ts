import { AUDIT_TOOL } from "../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../core/errors.js";
import { MagentoAnalytics } from "../../magento/analytics.js";
import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { createReadHandler, defaultReadFailure } from "../shared/read-handler.js";
import {
  type OrderAnalyticsData,
  type OrderAnalyticsGetFailure,
  OrderAnalyticsGetInputSchema,
  OrderAnalyticsGetOutputSchema,
  ORDER_ANALYTICS_GET_TOOL,
} from "./schemas.js";

function internalFailure(): OrderAnalyticsGetFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}

export function registerAnalyticsTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const analytics = new MagentoAnalytics(dependencies.client);
  registerTool(
    ORDER_ANALYTICS_GET_TOOL,
    {
      title: "Get Magento Order Analytics",
      description:
        "Calculate bounded order count, gross order value, paid, refunded, and net collected amounts by currency for a date range.",
      annotations: { readOnlyHint: true },
      inputSchema: OrderAnalyticsGetInputSchema,
      outputSchema: OrderAnalyticsGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.ORDER_ANALYTICS_GET,
      inputSchema: OrderAnalyticsGetInputSchema,
      outputSchema: OrderAnalyticsGetOutputSchema,
      internalFailure,
      failure: defaultReadFailure,
      execute: async (input, signal, onAttempt) => {
        const response = await analytics.getOrders(
          {
            createdFrom: `${input.created_from} 00:00:00`,
            createdTo: `${input.created_to} 23:59:59`,
            ...(input.status === undefined ? {} : { status: input.status }),
          },
          signal,
          onAttempt,
        );
        const totals = new Map<
          string,
          { count: number; gross: number; paid: number; refunded: number }
        >();
        for (const order of response.orders) {
          const current = totals.get(order.order_currency_code) ?? {
            count: 0,
            gross: 0,
            paid: 0,
            refunded: 0,
          };
          current.count += 1;
          current.gross += order.grand_total;
          current.paid += order.total_paid ?? 0;
          current.refunded += order.total_refunded ?? 0;
          totals.set(order.order_currency_code, current);
        }
        const data: OrderAnalyticsData = {
          created_from: input.created_from,
          created_to: input.created_to,
          status: input.status ?? null,
          total_order_count: response.totalCount,
          scanned_order_count: response.orders.length,
          is_complete: response.isComplete,
          currencies: [...totals.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currencyCode, value]) => ({
              currency_code: currencyCode,
              order_count: value.count,
              gross_order_value: value.gross,
              paid_amount: value.paid,
              refunded_amount: value.refunded,
              net_collected_amount: value.paid - value.refunded,
              average_order_value: value.gross / value.count,
            })),
        };
        return { ok: true, data };
      },
    }),
  );
}
