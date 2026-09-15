import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";

import type { AuditInput, AuditWriter } from "../../src/core/audit.js";
import { InMemoryIdempotencyRegistry } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import {
  MAGENTO_CREDIT_MEMO_STATE,
  MAGENTO_FULFILLMENT_SORT,
  MAGENTO_INVOICE_STATE,
  MagentoFulfillment,
} from "../../src/magento/fulfillment.js";
import {
  mapCreditMemo,
  mapInvoice,
  mapShipment,
} from "../../src/tools/orders/fulfillment-read/mapper.js";
import { registerFulfillmentReadTools } from "../../src/tools/orders/fulfillment-read/register.js";
import {
  createCreditMemoSearchInputSchema,
  createInvoiceSearchInputSchema,
  createShipmentSearchInputSchema,
} from "../../src/tools/orders/fulfillment-read/schemas.js";
import { createInvoiceSearchWorkflow } from "../../src/tools/orders/fulfillment-read/workflows.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "../../src/tools/rate-limited-registration.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function client(fetchImplementation: MagentoFetch): MagentoClient {
  return new MagentoClient({
    baseUrl: "https://shop.example/",
    storeScope: "default",
    oauth: {
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    },
    timeoutMs: 1000,
    fetch: fetchImplementation,
    now: () => 1_700_000_000_000,
    nonce: () => "fixed-test-nonce",
  });
}

const invoiceSummary = {
  entity_id: 11,
  increment_id: "000000011",
  order_id: 7,
  state: 2,
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-01 10:10:00",
  order_currency_code: "USD",
  grand_total: 15,
  total_qty: 2,
};

const invoice = {
  ...invoiceSummary,
  subtotal: 12,
  discount_amount: -1,
  shipping_amount: 2,
  tax_amount: 2,
  items: [
    {
      entity_id: 21,
      order_item_id: 31,
      sku: "SKU-1",
      name: "Product",
      qty: 2,
      price: 6,
      row_total: 12,
      tax_amount: 2,
      discount_amount: -1,
      private_option: "hidden",
    },
  ],
  comments: [{ comment: "private invoice comment" }],
  billing_address_id: 99,
};

const shipmentSummary = {
  entity_id: 12,
  increment_id: "000000012",
  order_id: 7,
  created_at: "2026-09-01 11:00:00",
  updated_at: "2026-09-01 11:10:00",
  total_qty: 2,
};

const shipment = {
  ...shipmentSummary,
  total_weight: 1.5,
  shipment_status: null,
  items: [
    {
      entity_id: 22,
      order_item_id: 31,
      sku: "SKU-1",
      name: "Product",
      qty: 2,
      private_option: "hidden",
    },
  ],
  tracks: [{ track_number: "TRACK-1", title: "Carrier", carrier_code: "custom" }],
  comments: [{ comment: "private shipment comment" }],
  shipping_label: "private label",
};

const creditMemoSummary = {
  entity_id: 13,
  increment_id: "000000013",
  order_id: 7,
  invoice_id: 11,
  state: 2,
  created_at: "2026-09-01 12:00:00",
  updated_at: "2026-09-01 12:10:00",
  order_currency_code: "USD",
  grand_total: 5,
};

const creditMemo = {
  ...creditMemoSummary,
  subtotal: 4,
  discount_amount: 0,
  shipping_amount: 0,
  tax_amount: 1,
  adjustment_positive: 0,
  adjustment_negative: 0,
  items: [
    {
      entity_id: 23,
      order_item_id: 31,
      sku: "SKU-1",
      name: "Product",
      qty: 1,
      price: 4,
      row_total: 4,
      tax_amount: 1,
      discount_amount: 0,
      private_option: "hidden",
    },
  ],
  comments: [{ comment: "private credit memo comment" }],
  transaction_id: "private-transaction",
};

describe("fulfillment read input contracts", () => {
  it("requires narrow filters and bounds page sizes", () => {
    const invoices = createInvoiceSearchInputSchema(25);
    const shipments = createShipmentSearchInputSchema(25);
    const creditMemos = createCreditMemoSearchInputSchema(25);

    expect(invoices.safeParse({}).success).toBe(false);
    expect(invoices.safeParse({ state: "paid", page_size: 25 }).success).toBe(true);
    expect(invoices.safeParse({ state: 2 }).success).toBe(false);
    expect(shipments.safeParse({ order_id: 7, page_size: 26 }).success).toBe(false);
    expect(shipments.safeParse({ order_id: 7 }).success).toBe(true);
    expect(creditMemos.safeParse({}).success).toBe(false);
    expect(creditMemos.safeParse({ order_id: 7, state: "refunded" }).success).toBe(true);
  });
});

describe("Magento fulfillment boundary", () => {
  it("uses fixed invoice collection filters, semantic state mapping, and sparse fields", async () => {
    let requestedUrl: URL | undefined;
    const fulfillment = new MagentoFulfillment(
      client((input) => {
        requestedUrl = new URL(String(input));
        return Promise.resolve(
          jsonResponse({ items: [{ ...invoiceSummary, private: "hidden" }], total_count: 1 }),
        );
      }),
    );

    const result = await fulfillment.searchInvoices(
      {
        orderId: 7,
        state: MAGENTO_INVOICE_STATE.PAID,
        sort: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
        pageSize: 10,
        currentPage: 1,
      },
      new AbortController().signal,
    );

    expect(requestedUrl?.pathname).toBe("/rest/default/V1/invoices");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][0][filters][0][field]"),
    ).toBe("order_id");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][1][filters][0][value]"),
    ).toBe("2");
    expect(requestedUrl?.searchParams.get("searchCriteria[sortOrders][1][field]")).toBe(
      "entity_id",
    );
    expect(requestedUrl?.searchParams.get("fields")).toContain("total_qty");
    expect(result.items[0]).not.toHaveProperty("private");
  });

  it("uses fixed single-resource routes for invoice, shipment, and credit memo", async () => {
    const requestedPaths: string[] = [];
    const responses = [invoice, shipment, creditMemo];
    const fulfillment = new MagentoFulfillment(
      client((input) => {
        requestedPaths.push(new URL(String(input)).pathname);
        const response = responses.shift();
        if (response === undefined) throw new Error("missing response");
        return Promise.resolve(jsonResponse(response));
      }),
    );
    const signal = new AbortController().signal;

    await fulfillment.getInvoice(11, signal);
    await fulfillment.getShipment(12, signal);
    await fulfillment.getCreditMemo(13, signal);

    expect(requestedPaths).toEqual([
      "/rest/default/V1/invoices/11",
      "/rest/default/V1/shipment/12",
      "/rest/default/V1/creditmemo/13",
    ]);
  });

  it("gets order tracking through the fixed shipment collection without comments", async () => {
    let requestedUrl: URL | undefined;
    const fulfillment = new MagentoFulfillment(
      client((input) => {
        requestedUrl = new URL(String(input));
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                entity_id: 12,
                increment_id: "000000012",
                order_id: 7,
                created_at: "2026-09-01 11:00:00",
                tracks: shipment.tracks,
                comments: [{ comment: "private" }],
              },
            ],
            total_count: 1,
          }),
        );
      }),
    );

    const result = await fulfillment.searchShipmentTracking(
      {
        orderId: 7,
        sort: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
        pageSize: 25,
        currentPage: 1,
      },
      new AbortController().signal,
    );

    expect(requestedUrl?.pathname).toBe("/rest/default/V1/shipments");
    expect(requestedUrl?.searchParams.get("fields")).toContain(
      "tracks[track_number,title,carrier_code]",
    );
    expect(requestedUrl?.searchParams.get("fields")).not.toContain("comments");
    expect(result.items[0]).not.toHaveProperty("comments");
  });

  it("normalizes sparse null collections and safely rejects invalid upstream JSON", async () => {
    const empty = new MagentoFulfillment(
      client(() => Promise.resolve(jsonResponse({ items: null, total_count: 0 }))),
    );
    await expect(
      empty.searchShipments(
        {
          orderId: 7,
          sort: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
          pageSize: 25,
          currentPage: 1,
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ items: [], total_count: 0 });

    const invalid = new MagentoFulfillment(
      client(() => Promise.resolve(jsonResponse({ items: [{}], total_count: 1 }))),
    );
    await expect(
      invalid.searchCreditMemos(
        {
          state: MAGENTO_CREDIT_MEMO_STATE.REFUNDED,
          sort: MAGENTO_FULFILLMENT_SORT.CREATED_DESCENDING,
          pageSize: 25,
          currentPage: 1,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });

  it("normalizes omitted zero-value invoice and credit-memo amounts", async () => {
    const responses = [
      {
        ...invoice,
        items: [{ ...invoice.items[0], discount_amount: undefined }],
      },
      {
        ...creditMemo,
        adjustment_positive: undefined,
        adjustment_negative: undefined,
        items: [{ ...creditMemo.items[0], discount_amount: undefined }],
      },
    ];
    const fulfillment = new MagentoFulfillment(
      client(() => {
        const response = responses.shift();
        if (response === undefined) throw new Error("missing response");
        return Promise.resolve(jsonResponse(response));
      }),
    );
    const signal = new AbortController().signal;

    const parsedInvoice = await fulfillment.getInvoice(11, signal);
    const parsedCreditMemo = await fulfillment.getCreditMemo(13, signal);

    expect(parsedInvoice.items[0]?.discount_amount).toBe(0);
    expect(parsedCreditMemo).toMatchObject({
      adjustment_positive: 0,
      adjustment_negative: 0,
      items: [{ discount_amount: 0 }],
    });
  });
});

describe("fulfillment mapping and pagination", () => {
  it("maps only public allowlists and excludes comments, labels, and transaction data", () => {
    const mapped = [mapInvoice(invoice), mapShipment(shipment), mapCreditMemo(creditMemo)];
    const serialized = JSON.stringify(mapped);

    expect(mapped[0]).toMatchObject({ state: "paid", invoice_id: 11 });
    expect(mapped[1]).toMatchObject({ shipment_id: 12, total_weight: 1.5 });
    expect(mapped[2]).toMatchObject({ state: "refunded", credit_memo_id: 13 });
    for (const privateValue of [
      "private invoice comment",
      "private shipment comment",
      "private credit memo comment",
      "private label",
      "private-transaction",
      "private_option",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it("binds invoice cursors to the original criteria", async () => {
    const fulfillment = new MagentoFulfillment(
      client((input) => {
        const page = new URL(String(input)).searchParams.get("searchCriteria[currentPage]");
        return Promise.resolve(
          jsonResponse({ items: page === "1" ? [invoiceSummary] : [], total_count: 26 }),
        );
      }),
    );
    const workflow = createInvoiceSearchWorkflow(fulfillment, new Uint8Array(32).fill(7));
    const signal = new AbortController().signal;
    const first = await workflow.execute({ order_id: 7, sort: "newest", page_size: 25 }, signal);

    expect(first.next_cursor).not.toBeNull();
    await expect(
      workflow.execute(
        {
          order_id: 8,
          sort: "newest",
          page_size: 25,
          cursor: first.next_cursor ?? undefined,
        },
        signal,
      ),
    ).rejects.toMatchObject({ reason: "invalid_cursor" });
  });
});

describe("fulfillment read MCP registration", () => {
  it("registers exactly seven structured read-only tools", async () => {
    const auditRecords: AuditInput[] = [];
    const audit: AuditWriter = {
      write(input) {
        auditRecords.push(input);
        return Promise.resolve();
      },
    };
    const server = new McpServer({ name: "fulfillment-read-test", version: "0.1.0" });
    registerFulfillmentReadTools(createRateLimitedRegisterTool(server, createToolCallLimiter()), {
      client: client(() => Promise.resolve(jsonResponse({ items: [], total_count: 0 }))),
      audit,
      approval: createWriteApprovalPolicy(new Uint8Array(32).fill(1)),
      idempotency: new InMemoryIdempotencyRegistry(),
      maxPageSize: 25,
      cursorKey: new Uint8Array(32).fill(2),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const mcpClient = new Client({ name: "test-client", version: "0.1.0" });
    await mcpClient.connect(clientTransport);

    try {
      const listed = await mcpClient.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual([
        "order_tracking_get",
        "invoice_search",
        "invoice_get",
        "shipment_search",
        "shipment_get",
        "credit_memo_search",
        "credit_memo_get",
      ]);
      for (const tool of listed.tools) {
        expect(tool.annotations).toEqual({ readOnlyHint: true });
        expect(tool.outputSchema).toBeDefined();
      }
    } finally {
      await mcpClient.close();
      await server.close();
    }
    expect(auditRecords).toEqual([]);
  });
});
