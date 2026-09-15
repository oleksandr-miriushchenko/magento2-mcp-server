import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import {
  createInvoiceCreateHandler,
  createOrderCancelHandler,
  createOrderEmailSendHandler,
  createOrderHoldHandler,
  createOrderUnholdHandler,
  createShipmentCreateHandler,
} from "./handlers.js";
import {
  FULFILLMENT_WRITE_TOOL,
  InvoiceCreateInputSchema,
  InvoiceCreateOutputSchema,
  OrderCancelInputSchema,
  OrderCancelOutputSchema,
  OrderEmailSendInputSchema,
  OrderEmailSendOutputSchema,
  OrderHoldInputSchema,
  OrderHoldOutputSchema,
  OrderUnholdInputSchema,
  OrderUnholdOutputSchema,
  ShipmentCreateInputSchema,
  ShipmentCreateOutputSchema,
} from "./schemas.js";

const REVERSIBLE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
} as const;

const ADDITIVE_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export function registerFulfillmentWriteTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerTool(
    FULFILLMENT_WRITE_TOOL.ORDER_CANCEL,
    {
      title: "Cancel Magento Order",
      description:
        "Cancel an eligible Magento order after native user approval. Requires an idempotency key.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
      inputSchema: OrderCancelInputSchema,
      outputSchema: OrderCancelOutputSchema,
    },
    createOrderCancelHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_WRITE_TOOL.ORDER_HOLD,
    {
      title: "Hold Magento Order",
      description:
        "Put an eligible Magento order on hold after native user approval. Requires an idempotency key.",
      annotations: REVERSIBLE_WRITE_ANNOTATIONS,
      inputSchema: OrderHoldInputSchema,
      outputSchema: OrderHoldOutputSchema,
    },
    createOrderHoldHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_WRITE_TOOL.ORDER_UNHOLD,
    {
      title: "Unhold Magento Order",
      description:
        "Release a held Magento order after native user approval. Requires an idempotency key.",
      annotations: REVERSIBLE_WRITE_ANNOTATIONS,
      inputSchema: OrderUnholdInputSchema,
      outputSchema: OrderUnholdOutputSchema,
    },
    createOrderUnholdHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_WRITE_TOOL.ORDER_EMAIL_SEND,
    {
      title: "Resend Magento Order Email",
      description:
        "Resend an order confirmation email after native user approval. Requires an idempotency key.",
      annotations: ADDITIVE_WRITE_ANNOTATIONS,
      inputSchema: OrderEmailSendInputSchema,
      outputSchema: OrderEmailSendOutputSchema,
    },
    createOrderEmailSendHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_WRITE_TOOL.INVOICE_CREATE,
    {
      title: "Create Magento Invoice",
      description:
        "Create a full Magento invoice with explicit capture and notification choices after native user approval. Requires an idempotency key.",
      annotations: ADDITIVE_WRITE_ANNOTATIONS,
      inputSchema: InvoiceCreateInputSchema,
      outputSchema: InvoiceCreateOutputSchema,
    },
    createInvoiceCreateHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_WRITE_TOOL.SHIPMENT_CREATE,
    {
      title: "Create Magento Shipment",
      description:
        "Create a full Magento shipment with optional bounded tracking records and an explicit notification choice after native user approval. Requires an idempotency key.",
      annotations: ADDITIVE_WRITE_ANNOTATIONS,
      inputSchema: ShipmentCreateInputSchema,
      outputSchema: ShipmentCreateOutputSchema,
    },
    createShipmentCreateHandler(dependencies),
  );
}
