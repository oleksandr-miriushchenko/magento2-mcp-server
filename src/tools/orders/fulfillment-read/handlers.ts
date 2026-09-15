import type { ToolCallback } from "@modelcontextprotocol/server";

import { createAppError, ERROR_CODE } from "../../../core/errors.js";
import { MagentoFulfillment } from "../../../magento/fulfillment.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createReadHandler, defaultReadFailure } from "../../shared/read-handler.js";
import {
  CreditMemoGetInputSchema,
  CreditMemoGetOutputSchema,
  type CreditMemoSearchInputSchema,
  CreditMemoSearchOutputSchema,
  FULFILLMENT_READ_TOOL,
  type FulfillmentReadFailure,
  type FulfillmentSearchFailure,
  InvoiceGetInputSchema,
  InvoiceGetOutputSchema,
  type InvoiceSearchInputSchema,
  InvoiceSearchOutputSchema,
  type OrderTrackingInputSchema,
  OrderTrackingOutputSchema,
  ShipmentGetInputSchema,
  ShipmentGetOutputSchema,
  type ShipmentSearchInputSchema,
  ShipmentSearchOutputSchema,
} from "./schemas.js";
import {
  createCreditMemoGetWorkflow,
  createCreditMemoSearchWorkflow,
  createInvoiceGetWorkflow,
  createInvoiceSearchWorkflow,
  createOrderTrackingWorkflow,
  createShipmentGetWorkflow,
  createShipmentSearchWorkflow,
} from "./workflows.js";

function internalReadFailure(): FulfillmentReadFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

function internalSearchFailure(): FulfillmentSearchFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

export function createInvoiceSearchHandler(
  dependencies: ToolDependencies,
  inputSchema: InvoiceSearchInputSchema,
): ToolCallback<InvoiceSearchInputSchema> {
  const workflow = createInvoiceSearchWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.cursorKey,
  );
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.INVOICE_SEARCH,
    inputSchema,
    outputSchema: InvoiceSearchOutputSchema,
    internalFailure: internalSearchFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}

export function createInvoiceGetHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof InvoiceGetInputSchema> {
  const workflow = createInvoiceGetWorkflow(new MagentoFulfillment(dependencies.client));
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.INVOICE_GET,
    inputSchema: InvoiceGetInputSchema,
    outputSchema: InvoiceGetOutputSchema,
    internalFailure: internalReadFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input.invoice_id, signal, onAttempt),
    }),
  });
}

export function createShipmentSearchHandler(
  dependencies: ToolDependencies,
  inputSchema: ShipmentSearchInputSchema,
): ToolCallback<ShipmentSearchInputSchema> {
  const workflow = createShipmentSearchWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.cursorKey,
  );
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.SHIPMENT_SEARCH,
    inputSchema,
    outputSchema: ShipmentSearchOutputSchema,
    internalFailure: internalSearchFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}

export function createShipmentGetHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof ShipmentGetInputSchema> {
  const workflow = createShipmentGetWorkflow(new MagentoFulfillment(dependencies.client));
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.SHIPMENT_GET,
    inputSchema: ShipmentGetInputSchema,
    outputSchema: ShipmentGetOutputSchema,
    internalFailure: internalReadFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input.shipment_id, signal, onAttempt),
    }),
  });
}

export function createCreditMemoSearchHandler(
  dependencies: ToolDependencies,
  inputSchema: CreditMemoSearchInputSchema,
): ToolCallback<CreditMemoSearchInputSchema> {
  const workflow = createCreditMemoSearchWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.cursorKey,
  );
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.CREDIT_MEMO_SEARCH,
    inputSchema,
    outputSchema: CreditMemoSearchOutputSchema,
    internalFailure: internalSearchFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}

export function createCreditMemoGetHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof CreditMemoGetInputSchema> {
  const workflow = createCreditMemoGetWorkflow(new MagentoFulfillment(dependencies.client));
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET,
    inputSchema: CreditMemoGetInputSchema,
    outputSchema: CreditMemoGetOutputSchema,
    internalFailure: internalReadFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input.credit_memo_id, signal, onAttempt),
    }),
  });
}

export function createOrderTrackingHandler(
  dependencies: ToolDependencies,
  inputSchema: OrderTrackingInputSchema,
): ToolCallback<OrderTrackingInputSchema> {
  const workflow = createOrderTrackingWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.cursorKey,
  );
  return createReadHandler({
    dependencies,
    tool: FULFILLMENT_READ_TOOL.ORDER_TRACKING_GET,
    inputSchema,
    outputSchema: OrderTrackingOutputSchema,
    internalFailure: internalSearchFailure,
    failure: defaultReadFailure,
    execute: async (input, signal, onAttempt) => ({
      ok: true,
      data: await workflow.execute(input, signal, onAttempt),
    }),
  });
}
