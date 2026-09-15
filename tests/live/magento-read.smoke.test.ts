import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { parseConfig } from "../../src/core/config.js";
import { ERROR_CODE } from "../../src/core/errors.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient } from "../../src/magento/client.js";
import {
  ORDER_ANALYTICS_GET_TOOL,
  OrderAnalyticsGetOutputSchema,
} from "../../src/tools/analytics/schemas.js";
import {
  CMS_PAGE_GET_TOOL,
  CMS_PAGE_SEARCH_TOOL,
  CmsPageGetOutputSchema,
  CmsPageSearchOutputSchema,
} from "../../src/tools/cms/schemas.js";
import {
  CUSTOMER_GET_TOOL,
  CustomerGetOutputSchema,
} from "../../src/tools/customers/customer-get/schemas.js";
import {
  CUSTOMER_GROUP_SEARCH_TOOL,
  CustomerGroupSearchOutputSchema,
} from "../../src/tools/customers/customer-group-search/schemas.js";
import {
  CUSTOMER_SEARCH_TOOL,
  CustomerSearchOutputSchema,
} from "../../src/tools/customers/customer-search/schemas.js";
import {
  INVENTORY_GET_TOOL,
  InventoryGetOutputSchema,
} from "../../src/tools/inventory/inventory-get/schemas.js";
import {
  INVENTORY_SOURCE_SEARCH_TOOL,
  InventorySourceSearchOutputSchema,
} from "../../src/tools/inventory/inventory-source-search/schemas.js";
import {
  INVENTORY_STOCK_SEARCH_TOOL,
  InventoryStockSearchOutputSchema,
} from "../../src/tools/inventory/inventory-stock-search/schemas.js";
import {
  CREDIT_MEMO_STATE,
  FULFILLMENT_READ_TOOL,
  CreditMemoGetOutputSchema,
  CreditMemoSearchOutputSchema,
  INVOICE_STATE,
  InvoiceGetOutputSchema,
  InvoiceSearchOutputSchema,
  OrderTrackingOutputSchema,
  ShipmentGetOutputSchema,
  ShipmentSearchOutputSchema,
} from "../../src/tools/orders/fulfillment-read/schemas.js";
import { ORDER_GET_TOOL, OrderGetOutputSchema } from "../../src/tools/orders/order-get/schemas.js";
import {
  ORDER_SEARCH_TOOL,
  OrderSearchOutputSchema,
} from "../../src/tools/orders/order-search/schemas.js";
import {
  CATEGORY_TREE_GET_TOOL,
  CategoryTreeGetOutputSchema,
} from "../../src/tools/products/category-tree-get/schemas.js";
import {
  PRODUCT_ATTRIBUTE_GET_TOOL,
  ProductAttributeGetOutputSchema,
} from "../../src/tools/products/product-attribute-get/schemas.js";
import {
  PRODUCT_ATTRIBUTE_SEARCH_TOOL,
  ProductAttributeSearchOutputSchema,
} from "../../src/tools/products/product-attribute-search/schemas.js";
import {
  PRODUCT_GET_TOOL,
  ProductGetOutputSchema,
} from "../../src/tools/products/product-get/schemas.js";
import {
  PRODUCT_SEARCH_TOOL,
  ProductSearchOutputSchema,
} from "../../src/tools/products/product-search/schemas.js";
import {
  COUPON_SEARCH_TOOL,
  CouponSearchOutputSchema,
  SALES_RULE_GET_TOOL,
  SALES_RULE_SEARCH_TOOL,
  SalesRuleGetOutputSchema,
  SalesRuleSearchOutputSchema,
} from "../../src/tools/promotions/schemas.js";
import { QUOTE_SEARCH_TOOL, QuoteSearchOutputSchema } from "../../src/tools/quotes/schemas.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";
import { registerTools } from "../../src/tools/index.js";
import {
  STORE_HIERARCHY_GET_TOOL,
  StoreHierarchyGetOutputSchema,
} from "../../src/tools/store/schemas.js";

const config = parseConfig(process.env);
const MISSING_ENTITY_ID = 2_147_483_647;
const MISSING_PRODUCT_SKU = "mcp-smoke-missing-sku";
const MISSING_ATTRIBUTE_CODE = "mcp_smoke_missing_attribute";

const READ_TOOL_NAMES = [
  ORDER_SEARCH_TOOL,
  ORDER_GET_TOOL,
  FULFILLMENT_READ_TOOL.ORDER_TRACKING_GET,
  FULFILLMENT_READ_TOOL.INVOICE_SEARCH,
  FULFILLMENT_READ_TOOL.INVOICE_GET,
  FULFILLMENT_READ_TOOL.SHIPMENT_SEARCH,
  FULFILLMENT_READ_TOOL.SHIPMENT_GET,
  FULFILLMENT_READ_TOOL.CREDIT_MEMO_SEARCH,
  FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET,
  CUSTOMER_SEARCH_TOOL,
  CUSTOMER_GET_TOOL,
  CUSTOMER_GROUP_SEARCH_TOOL,
  PRODUCT_SEARCH_TOOL,
  PRODUCT_GET_TOOL,
  PRODUCT_ATTRIBUTE_SEARCH_TOOL,
  PRODUCT_ATTRIBUTE_GET_TOOL,
  CATEGORY_TREE_GET_TOOL,
  INVENTORY_GET_TOOL,
  INVENTORY_SOURCE_SEARCH_TOOL,
  INVENTORY_STOCK_SEARCH_TOOL,
  QUOTE_SEARCH_TOOL,
  CMS_PAGE_SEARCH_TOOL,
  CMS_PAGE_GET_TOOL,
  SALES_RULE_SEARCH_TOOL,
  SALES_RULE_GET_TOOL,
  COUPON_SEARCH_TOOL,
  ORDER_ANALYTICS_GET_TOOL,
  STORE_HIERARCHY_GET_TOOL,
] as const;

type ToolOutcome<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly error: { readonly code: string } };

let mcpClient: Client | undefined;
let server: McpServer | undefined;

async function callValidated<TSchema extends z.ZodType>(
  toolName: string,
  arguments_: Record<string, unknown>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  if (mcpClient === undefined) throw new Error("Live MCP client is not connected.");
  const result = await mcpClient.callTool({ name: toolName, arguments: arguments_ });
  const parsed = schema.safeParse(result.structuredContent);
  if (!parsed.success) {
    throw new Error(
      `${toolName} returned structured content that does not match its output schema:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const outcome = z.object({ ok: z.boolean() }).safeParse(parsed.data);
  if (!outcome.success) throw new Error(`${toolName} returned no result discriminant.`);
  if ((result.isError === true) === outcome.data.ok) {
    throw new Error(`${toolName} returned inconsistent isError and structuredContent values.`);
  }
  return parsed.data;
}

function requireSuccess<TData>(toolName: string, outcome: ToolOutcome<TData>): TData {
  if (outcome.ok) return outcome.data;
  throw new Error(`${toolName} failed with ${outcome.error.code}.`);
}

function requireSuccessOrMissing<TData>(toolName: string, outcome: ToolOutcome<TData>): void {
  if (outcome.ok) return;
  if (outcome.error.code === ERROR_CODE.NOT_FOUND) return;
  throw new Error(`${toolName} failed with ${outcome.error.code}.`);
}

beforeEach(async () => {
  const approval = createWriteApprovalPolicy(new Uint8Array(32).fill(1));
  const liveMagentoClient = new MagentoClient({
    baseUrl: config.baseUrl,
    storeScope: config.storeScope,
    oauth: config.oauth,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });
  server = new McpServer(
    { name: "magento-live-smoke-test", version: "0.1.0" },
    { requestState: { verify: approval.verify } },
  );
  registerTools(createRateLimitedRegisterTool(server, createToolCallLimiter()), {
    client: liveMagentoClient,
    audit: { write: () => Promise.resolve() },
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: config.maxPageSize,
    cursorKey: new Uint8Array(32).fill(2),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  mcpClient = new Client({ name: "magento-live-smoke-client", version: "0.1.0" });
  await mcpClient.connect(clientTransport);
});

afterEach(async () => {
  const activeClient = mcpClient;
  const activeServer = server;
  mcpClient = undefined;
  server = undefined;
  if (activeClient !== undefined) await activeClient.close();
  if (activeServer !== undefined) await activeServer.close();
});

describe("live Magento read smoke tests", () => {
  it("registers the complete read-only public tool surface", async () => {
    if (mcpClient === undefined) throw new Error("Live MCP client is not connected.");
    const listed = await mcpClient.listTools();
    const actualReadTools = listed.tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name)
      .sort();

    expect(actualReadTools).toEqual([...READ_TOOL_NAMES].sort());
  });

  it("reads catalog and inventory endpoints through MCP", async () => {
    const productSearch = requireSuccess(
      PRODUCT_SEARCH_TOOL,
      await callValidated(
        PRODUCT_SEARCH_TOOL,
        { product_type: "simple", page_size: 1 },
        ProductSearchOutputSchema,
      ),
    );
    const product = productSearch.products[0];
    const productGet = await callValidated(
      PRODUCT_GET_TOOL,
      { sku: product?.sku ?? MISSING_PRODUCT_SKU },
      ProductGetOutputSchema,
    );
    if (product === undefined) requireSuccessOrMissing(PRODUCT_GET_TOOL, productGet);
    else requireSuccess(PRODUCT_GET_TOOL, productGet);

    const attributeSearch = requireSuccess(
      PRODUCT_ATTRIBUTE_SEARCH_TOOL,
      await callValidated(
        PRODUCT_ATTRIBUTE_SEARCH_TOOL,
        { page_size: 1 },
        ProductAttributeSearchOutputSchema,
      ),
    );
    const attribute = attributeSearch.attributes[0];
    const attributeGet = await callValidated(
      PRODUCT_ATTRIBUTE_GET_TOOL,
      { attribute_code: attribute?.attribute_code ?? MISSING_ATTRIBUTE_CODE },
      ProductAttributeGetOutputSchema,
    );
    if (attribute === undefined) requireSuccessOrMissing(PRODUCT_ATTRIBUTE_GET_TOOL, attributeGet);
    else requireSuccess(PRODUCT_ATTRIBUTE_GET_TOOL, attributeGet);

    requireSuccess(
      CATEGORY_TREE_GET_TOOL,
      await callValidated(CATEGORY_TREE_GET_TOOL, { depth: 1 }, CategoryTreeGetOutputSchema),
    );
    requireSuccess(
      INVENTORY_SOURCE_SEARCH_TOOL,
      await callValidated(
        INVENTORY_SOURCE_SEARCH_TOOL,
        { page_size: 1 },
        InventorySourceSearchOutputSchema,
      ),
    );
    const stockSearch = requireSuccess(
      INVENTORY_STOCK_SEARCH_TOOL,
      await callValidated(
        INVENTORY_STOCK_SEARCH_TOOL,
        { page_size: 1 },
        InventoryStockSearchOutputSchema,
      ),
    );
    const stock = stockSearch.stocks[0];
    const inventoryGet = await callValidated(
      INVENTORY_GET_TOOL,
      { sku: product?.sku ?? MISSING_PRODUCT_SKU, stock_id: stock?.stock_id ?? 1 },
      InventoryGetOutputSchema,
    );
    if (product === undefined || stock === undefined) {
      requireSuccessOrMissing(INVENTORY_GET_TOOL, inventoryGet);
    } else {
      requireSuccess(INVENTORY_GET_TOOL, inventoryGet);
    }
  });

  it("reads customers, orders, quotes, and analytics through MCP", async () => {
    const customerSearch = requireSuccess(
      CUSTOMER_SEARCH_TOOL,
      await callValidated(CUSTOMER_SEARCH_TOOL, { page_size: 1 }, CustomerSearchOutputSchema),
    );
    const customer = customerSearch.customers[0];
    const customerGet = await callValidated(
      CUSTOMER_GET_TOOL,
      { customer_id: customer?.customer_id ?? MISSING_ENTITY_ID },
      CustomerGetOutputSchema,
    );
    if (customer === undefined) requireSuccessOrMissing(CUSTOMER_GET_TOOL, customerGet);
    else requireSuccess(CUSTOMER_GET_TOOL, customerGet);

    requireSuccess(
      CUSTOMER_GROUP_SEARCH_TOOL,
      await callValidated(
        CUSTOMER_GROUP_SEARCH_TOOL,
        { page_size: 1 },
        CustomerGroupSearchOutputSchema,
      ),
    );
    const orderSearch = requireSuccess(
      ORDER_SEARCH_TOOL,
      await callValidated(
        ORDER_SEARCH_TOOL,
        { grand_total_min: 0, page_size: 1 },
        OrderSearchOutputSchema,
      ),
    );
    const order = orderSearch.orders[0];
    const orderGet = await callValidated(
      ORDER_GET_TOOL,
      { order_id: order?.order_id ?? MISSING_ENTITY_ID },
      OrderGetOutputSchema,
    );
    if (order === undefined) requireSuccessOrMissing(ORDER_GET_TOOL, orderGet);
    else requireSuccess(ORDER_GET_TOOL, orderGet);

    requireSuccess(
      QUOTE_SEARCH_TOOL,
      await callValidated(QUOTE_SEARCH_TOOL, { page_size: 1 }, QuoteSearchOutputSchema),
    );
    const today = new Date().toISOString().slice(0, 10);
    requireSuccess(
      ORDER_ANALYTICS_GET_TOOL,
      await callValidated(
        ORDER_ANALYTICS_GET_TOOL,
        { created_from: today, created_to: today },
        OrderAnalyticsGetOutputSchema,
      ),
    );
  });

  it("reads CMS, promotion, and store endpoints through MCP", async () => {
    const pageSearch = requireSuccess(
      CMS_PAGE_SEARCH_TOOL,
      await callValidated(CMS_PAGE_SEARCH_TOOL, { page_size: 1 }, CmsPageSearchOutputSchema),
    );
    const page = pageSearch.pages[0];
    const pageGet = await callValidated(
      CMS_PAGE_GET_TOOL,
      { page_id: page?.page_id ?? MISSING_ENTITY_ID },
      CmsPageGetOutputSchema,
    );
    if (page === undefined) requireSuccessOrMissing(CMS_PAGE_GET_TOOL, pageGet);
    else requireSuccess(CMS_PAGE_GET_TOOL, pageGet);

    const ruleSearch = requireSuccess(
      SALES_RULE_SEARCH_TOOL,
      await callValidated(SALES_RULE_SEARCH_TOOL, { page_size: 1 }, SalesRuleSearchOutputSchema),
    );
    const rule = ruleSearch.rules[0];
    const ruleGet = await callValidated(
      SALES_RULE_GET_TOOL,
      { rule_id: rule?.rule_id ?? MISSING_ENTITY_ID },
      SalesRuleGetOutputSchema,
    );
    if (rule === undefined) requireSuccessOrMissing(SALES_RULE_GET_TOOL, ruleGet);
    else requireSuccess(SALES_RULE_GET_TOOL, ruleGet);

    requireSuccess(
      COUPON_SEARCH_TOOL,
      await callValidated(
        COUPON_SEARCH_TOOL,
        { rule_id: rule?.rule_id ?? MISSING_ENTITY_ID, page_size: 1 },
        CouponSearchOutputSchema,
      ),
    );
    requireSuccess(
      STORE_HIERARCHY_GET_TOOL,
      await callValidated(STORE_HIERARCHY_GET_TOOL, {}, StoreHierarchyGetOutputSchema),
    );
  });

  it("reads fulfillment endpoints through MCP", async () => {
    const invoiceSearch = requireSuccess(
      FULFILLMENT_READ_TOOL.INVOICE_SEARCH,
      await callValidated(
        FULFILLMENT_READ_TOOL.INVOICE_SEARCH,
        { state: INVOICE_STATE.PAID, page_size: 1 },
        InvoiceSearchOutputSchema,
      ),
    );
    const invoice = invoiceSearch.invoices[0];
    const invoiceGet = await callValidated(
      FULFILLMENT_READ_TOOL.INVOICE_GET,
      { invoice_id: invoice?.invoice_id ?? MISSING_ENTITY_ID },
      InvoiceGetOutputSchema,
    );
    if (invoice === undefined) {
      requireSuccessOrMissing(FULFILLMENT_READ_TOOL.INVOICE_GET, invoiceGet);
    } else {
      requireSuccess(FULFILLMENT_READ_TOOL.INVOICE_GET, invoiceGet);
    }

    const creditMemoSearch = requireSuccess(
      FULFILLMENT_READ_TOOL.CREDIT_MEMO_SEARCH,
      await callValidated(
        FULFILLMENT_READ_TOOL.CREDIT_MEMO_SEARCH,
        { state: CREDIT_MEMO_STATE.REFUNDED, page_size: 1 },
        CreditMemoSearchOutputSchema,
      ),
    );
    const creditMemo = creditMemoSearch.credit_memos[0];
    const creditMemoGet = await callValidated(
      FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET,
      { credit_memo_id: creditMemo?.credit_memo_id ?? MISSING_ENTITY_ID },
      CreditMemoGetOutputSchema,
    );
    if (creditMemo === undefined) {
      requireSuccessOrMissing(FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET, creditMemoGet);
    } else {
      requireSuccess(FULFILLMENT_READ_TOOL.CREDIT_MEMO_GET, creditMemoGet);
    }

    const orderId = invoice?.order_id ?? creditMemo?.order_id ?? MISSING_ENTITY_ID;
    const shipmentSearch = requireSuccess(
      FULFILLMENT_READ_TOOL.SHIPMENT_SEARCH,
      await callValidated(
        FULFILLMENT_READ_TOOL.SHIPMENT_SEARCH,
        { order_id: orderId, page_size: 1 },
        ShipmentSearchOutputSchema,
      ),
    );
    requireSuccess(
      FULFILLMENT_READ_TOOL.ORDER_TRACKING_GET,
      await callValidated(
        FULFILLMENT_READ_TOOL.ORDER_TRACKING_GET,
        { order_id: orderId, page_size: 1 },
        OrderTrackingOutputSchema,
      ),
    );
    const shipment = shipmentSearch.shipments[0];
    const shipmentGet = await callValidated(
      FULFILLMENT_READ_TOOL.SHIPMENT_GET,
      { shipment_id: shipment?.shipment_id ?? MISSING_ENTITY_ID },
      ShipmentGetOutputSchema,
    );
    if (shipment === undefined) {
      requireSuccessOrMissing(FULFILLMENT_READ_TOOL.SHIPMENT_GET, shipmentGet);
    } else {
      requireSuccess(FULFILLMENT_READ_TOOL.SHIPMENT_GET, shipmentGet);
    }
  });
});
