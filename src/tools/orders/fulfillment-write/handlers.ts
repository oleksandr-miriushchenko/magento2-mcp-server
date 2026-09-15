import type { ToolCallback } from "@modelcontextprotocol/server";

import { MagentoFulfillment } from "../../../magento/fulfillment.js";
import type { ToolDependencies } from "../../dependencies.js";
import { createWriteHandler } from "../../shared/write-handler.js";
import {
  FULFILLMENT_WRITE_TOOL,
  type InvoiceCreateInput,
  InvoiceCreateInputSchema,
  InvoiceCreateOutputSchema,
  type InvoiceCreateSuccess,
  type OrderCancelInput,
  OrderCancelInputSchema,
  OrderCancelOutputSchema,
  type OrderCancelSuccess,
  type OrderEmailSendInput,
  OrderEmailSendInputSchema,
  OrderEmailSendOutputSchema,
  type OrderEmailSendSuccess,
  type OrderHoldInput,
  OrderHoldInputSchema,
  OrderHoldOutputSchema,
  type OrderHoldSuccess,
  type OrderUnholdInput,
  OrderUnholdInputSchema,
  OrderUnholdOutputSchema,
  type OrderUnholdSuccess,
  type ShipmentCreateInput,
  ShipmentCreateInputSchema,
  ShipmentCreateOutputSchema,
  type ShipmentCreateSuccess,
} from "./schemas.js";
import {
  createInvoiceCreateWorkflow,
  createOrderCancelWorkflow,
  createOrderEmailSendWorkflow,
  createOrderHoldWorkflow,
  createOrderUnholdWorkflow,
  createShipmentCreateWorkflow,
} from "./workflows.js";

function orderCancelApproval(input: OrderCancelInput): string {
  return `Cancel Magento order ${input.order_id}? This operation changes the order to a terminal canceled state.`;
}

function orderHoldApproval(input: OrderHoldInput): string {
  return `Put Magento order ${input.order_id} on hold?`;
}

function orderUnholdApproval(input: OrderUnholdInput): string {
  return `Release Magento order ${input.order_id} from hold?`;
}

function orderEmailSendApproval(input: OrderEmailSendInput): string {
  return `Resend the order confirmation email for Magento order ${input.order_id}?`;
}

function invoiceCreateApproval(input: InvoiceCreateInput): string {
  return `Create an invoice for Magento order ${input.order_id}? Capture requested: ${input.capture ? "yes" : "no"}. Customer notification requested: ${input.notify ? "yes" : "no"}.`;
}

function shipmentCreateApproval(input: ShipmentCreateInput): string {
  return `Create a shipment for Magento order ${input.order_id} with ${input.tracks.length} tracking record(s)? Customer notification requested: ${input.notify ? "yes" : "no"}.`;
}

export function createOrderCancelHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderCancelInputSchema> {
  const workflow = createOrderCancelWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<OrderCancelSuccess>(FULFILLMENT_WRITE_TOOL.ORDER_CANCEL),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.ORDER_CANCEL,
    inputSchema: OrderCancelInputSchema,
    outputSchema: OrderCancelOutputSchema,
    workflow,
    approvalMessage: orderCancelApproval,
  });
}

export function createOrderHoldHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderHoldInputSchema> {
  const workflow = createOrderHoldWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<OrderHoldSuccess>(FULFILLMENT_WRITE_TOOL.ORDER_HOLD),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.ORDER_HOLD,
    inputSchema: OrderHoldInputSchema,
    outputSchema: OrderHoldOutputSchema,
    workflow,
    approvalMessage: orderHoldApproval,
  });
}

export function createOrderUnholdHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderUnholdInputSchema> {
  const workflow = createOrderUnholdWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<OrderUnholdSuccess>(FULFILLMENT_WRITE_TOOL.ORDER_UNHOLD),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.ORDER_UNHOLD,
    inputSchema: OrderUnholdInputSchema,
    outputSchema: OrderUnholdOutputSchema,
    workflow,
    approvalMessage: orderUnholdApproval,
  });
}

export function createOrderEmailSendHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof OrderEmailSendInputSchema> {
  const workflow = createOrderEmailSendWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<OrderEmailSendSuccess>(
      FULFILLMENT_WRITE_TOOL.ORDER_EMAIL_SEND,
    ),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.ORDER_EMAIL_SEND,
    inputSchema: OrderEmailSendInputSchema,
    outputSchema: OrderEmailSendOutputSchema,
    workflow,
    approvalMessage: orderEmailSendApproval,
  });
}

export function createInvoiceCreateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof InvoiceCreateInputSchema> {
  const workflow = createInvoiceCreateWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<InvoiceCreateSuccess>(FULFILLMENT_WRITE_TOOL.INVOICE_CREATE),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.INVOICE_CREATE,
    inputSchema: InvoiceCreateInputSchema,
    outputSchema: InvoiceCreateOutputSchema,
    workflow,
    approvalMessage: invoiceCreateApproval,
  });
}

export function createShipmentCreateHandler(
  dependencies: ToolDependencies,
): ToolCallback<typeof ShipmentCreateInputSchema> {
  const workflow = createShipmentCreateWorkflow(
    new MagentoFulfillment(dependencies.client),
    dependencies.idempotency.forTool<ShipmentCreateSuccess>(FULFILLMENT_WRITE_TOOL.SHIPMENT_CREATE),
  );
  return createWriteHandler({
    dependencies,
    tool: FULFILLMENT_WRITE_TOOL.SHIPMENT_CREATE,
    inputSchema: ShipmentCreateInputSchema,
    outputSchema: ShipmentCreateOutputSchema,
    workflow,
    approvalMessage: shipmentCreateApproval,
  });
}
