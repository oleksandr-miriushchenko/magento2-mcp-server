import type { ToolDependencies } from "../../dependencies.js";
import type { RegisterTool } from "../../registration.js";
import {
  createCreditMemoGetHandler,
  createCreditMemoSearchHandler,
  createInvoiceGetHandler,
  createInvoiceSearchHandler,
  createOrderTrackingHandler,
  createShipmentGetHandler,
  createShipmentSearchHandler,
} from "./handlers.js";
import {
  CreditMemoGetInputSchema,
  CreditMemoGetOutputSchema,
  CreditMemoSearchOutputSchema,
  createCreditMemoSearchInputSchema,
  createInvoiceSearchInputSchema,
  createOrderTrackingInputSchema,
  createShipmentSearchInputSchema,
  FULFILLMENT_READ_TOOL,
  InvoiceGetInputSchema,
  InvoiceGetOutputSchema,
  InvoiceSearchOutputSchema,
  OrderTrackingOutputSchema,
  ShipmentGetInputSchema,
  ShipmentGetOutputSchema,
  ShipmentSearchOutputSchema,
} from "./schemas.js";

export function registerFulfillmentReadTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const orderTrackingInputSchema = createOrderTrackingInputSchema(dependencies.maxPageSize);
  const invoiceSearchInputSchema = createInvoiceSearchInputSchema(dependencies.maxPageSize);
  const shipmentSearchInputSchema = createShipmentSearchInputSchema(dependencies.maxPageSize);
  const creditMemoSearchInputSchema = createCreditMemoSearchInputSchema(dependencies.maxPageSize);

  registerTool(
    FULFILLMENT_READ_TOOL.ORDER_TRACKING_GET,
    {
      title: "Get Magento Order Tracking",
      description:
        "List shipment tracking numbers for a Magento order entity ID, paginated by shipment.",
      annotations: { readOnlyHint: true },
      inputSchema: orderTrackingInputSchema,
      outputSchema: OrderTrackingOutputSchema,
    },
    createOrderTrackingHandler(dependencies, orderTrackingInputSchema),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.INVOICE_SEARCH,
    {
      title: "Search Magento Invoices",
      description: "Search Magento invoices by exact order entity ID, invoice state, or both.",
      annotations: { readOnlyHint: true },
      inputSchema: invoiceSearchInputSchema,
      outputSchema: InvoiceSearchOutputSchema,
    },
    createInvoiceSearchHandler(dependencies, invoiceSearchInputSchema),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.INVOICE_GET,
    {
      title: "Get Magento Invoice",
      description: "Retrieve one Magento invoice by its positive numeric entity ID.",
      annotations: { readOnlyHint: true },
      inputSchema: InvoiceGetInputSchema,
      outputSchema: InvoiceGetOutputSchema,
    },
    createInvoiceGetHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.SHIPMENT_SEARCH,
    {
      title: "Search Magento Shipments",
      description: "Search Magento shipments by exact order entity ID.",
      annotations: { readOnlyHint: true },
      inputSchema: shipmentSearchInputSchema,
      outputSchema: ShipmentSearchOutputSchema,
    },
    createShipmentSearchHandler(dependencies, shipmentSearchInputSchema),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.SHIPMENT_GET,
    {
      title: "Get Magento Shipment",
      description:
        "Retrieve one Magento shipment, its items, and tracking numbers by shipment entity ID.",
      annotations: { readOnlyHint: true },
      inputSchema: ShipmentGetInputSchema,
      outputSchema: ShipmentGetOutputSchema,
    },
    createShipmentGetHandler(dependencies),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.CREDIT_MEMO_SEARCH,
    {
      title: "Search Magento Credit Memos",
      description: "Search Magento credit memos by exact order entity ID, refund state, or both.",
      annotations: { readOnlyHint: true },
      inputSchema: creditMemoSearchInputSchema,
      outputSchema: CreditMemoSearchOutputSchema,
    },
    createCreditMemoSearchHandler(dependencies, creditMemoSearchInputSchema),
  );

  registerTool(
    FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET,
    {
      title: "Get Magento Credit Memo",
      description: "Retrieve one Magento credit memo by its positive numeric entity ID.",
      annotations: { readOnlyHint: true },
      inputSchema: CreditMemoGetInputSchema,
      outputSchema: CreditMemoGetOutputSchema,
    },
    createCreditMemoGetHandler(dependencies),
  );
}
