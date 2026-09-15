import { appendFile } from "node:fs/promises";

import { z } from "zod";

export const AUDIT_TOOL = {
  CATEGORY_TREE_GET: "category_tree_get",
  CMS_PAGE_GET: "cms_page_get",
  CMS_PAGE_SEARCH: "cms_page_search",
  CMS_PAGE_UPDATE: "cms_page_update",
  COUPON_GENERATE: "coupon_generate",
  COUPON_SEARCH: "coupon_search",
  CREDIT_MEMO_GET: "credit_memo_get",
  CREDIT_MEMO_SEARCH: "credit_memo_search",
  CUSTOMER_GET: "customer_get",
  CUSTOMER_GROUP_SEARCH: "customer_group_search",
  CUSTOMER_SEARCH: "customer_search",
  INVENTORY_GET: "inventory_get",
  INVENTORY_SOURCE_SEARCH: "inventory_source_search",
  INVENTORY_STOCK_SEARCH: "inventory_stock_search",
  INVENTORY_UPDATE: "inventory_update",
  INVOICE_CREATE: "invoice_create",
  INVOICE_GET: "invoice_get",
  INVOICE_SEARCH: "invoice_search",
  ORDER_ANALYTICS_GET: "order_analytics_get",
  ORDER_CANCEL: "order_cancel",
  ORDER_GET: "order_get",
  ORDER_ADD_COMMENT: "order_add_comment",
  ORDER_EMAIL_SEND: "order_email_send",
  ORDER_HOLD: "order_hold",
  ORDER_SEARCH: "order_search",
  ORDER_TRACKING_GET: "order_tracking_get",
  ORDER_UNHOLD: "order_unhold",
  PRODUCT_ATTRIBUTE_GET: "product_attribute_get",
  PRODUCT_ATTRIBUTE_SEARCH: "product_attribute_search",
  PRODUCT_GET: "product_get",
  PRODUCT_REVIEW_SEARCH: "product_review_search",
  PRODUCT_SEARCH: "product_search",
  PRODUCT_UPDATE: "product_update",
  QUOTE_SEARCH: "quote_search",
  REVIEW_GET: "review_get",
  REVIEW_MODERATE: "review_moderate",
  SALES_RULE_GET: "sales_rule_get",
  SALES_RULE_SEARCH: "sales_rule_search",
  SHIPMENT_CREATE: "shipment_create",
  SHIPMENT_GET: "shipment_get",
  SHIPMENT_SEARCH: "shipment_search",
  STORE_HIERARCHY_GET: "store_hierarchy_get",
} as const;

const GENERAL_AUDIT_TOOL = [
  AUDIT_TOOL.CATEGORY_TREE_GET,
  AUDIT_TOOL.CMS_PAGE_GET,
  AUDIT_TOOL.CMS_PAGE_SEARCH,
  AUDIT_TOOL.CMS_PAGE_UPDATE,
  AUDIT_TOOL.COUPON_GENERATE,
  AUDIT_TOOL.COUPON_SEARCH,
  AUDIT_TOOL.CREDIT_MEMO_GET,
  AUDIT_TOOL.CREDIT_MEMO_SEARCH,
  AUDIT_TOOL.CUSTOMER_GET,
  AUDIT_TOOL.CUSTOMER_GROUP_SEARCH,
  AUDIT_TOOL.CUSTOMER_SEARCH,
  AUDIT_TOOL.INVENTORY_GET,
  AUDIT_TOOL.INVENTORY_SOURCE_SEARCH,
  AUDIT_TOOL.INVENTORY_STOCK_SEARCH,
  AUDIT_TOOL.INVENTORY_UPDATE,
  AUDIT_TOOL.INVOICE_CREATE,
  AUDIT_TOOL.INVOICE_GET,
  AUDIT_TOOL.INVOICE_SEARCH,
  AUDIT_TOOL.ORDER_ANALYTICS_GET,
  AUDIT_TOOL.ORDER_CANCEL,
  AUDIT_TOOL.ORDER_EMAIL_SEND,
  AUDIT_TOOL.ORDER_HOLD,
  AUDIT_TOOL.ORDER_SEARCH,
  AUDIT_TOOL.ORDER_TRACKING_GET,
  AUDIT_TOOL.ORDER_UNHOLD,
  AUDIT_TOOL.PRODUCT_ATTRIBUTE_GET,
  AUDIT_TOOL.PRODUCT_ATTRIBUTE_SEARCH,
  AUDIT_TOOL.PRODUCT_GET,
  AUDIT_TOOL.PRODUCT_REVIEW_SEARCH,
  AUDIT_TOOL.PRODUCT_SEARCH,
  AUDIT_TOOL.PRODUCT_UPDATE,
  AUDIT_TOOL.QUOTE_SEARCH,
  AUDIT_TOOL.REVIEW_GET,
  AUDIT_TOOL.REVIEW_MODERATE,
  AUDIT_TOOL.SALES_RULE_GET,
  AUDIT_TOOL.SALES_RULE_SEARCH,
  AUDIT_TOOL.SHIPMENT_CREATE,
  AUDIT_TOOL.SHIPMENT_GET,
  AUDIT_TOOL.SHIPMENT_SEARCH,
  AUDIT_TOOL.STORE_HIERARCHY_GET,
] as const;

export const AUDIT_OUTCOME = {
  SUCCESS: "success",
  FAILURE: "failure",
} as const;

const AuditOutcomeSchema = z.enum(AUDIT_OUTCOME);

const CommonAuditRecordFields = {
  timestamp: z.string(),
  request_id: z.string().min(1).max(128),
} as const;

const AuditOutcomeFields = {
  outcome: AuditOutcomeSchema,
  duration_ms: z.number().int().nonnegative(),
  attempt_count: z.number().int().nonnegative(),
} as const;

const AuditRecordSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    ...CommonAuditRecordFields,
    tool: z.literal(AUDIT_TOOL.ORDER_GET),
    order_id: z.number().int().positive(),
    ...AuditOutcomeFields,
  }),
  z.strictObject({
    ...CommonAuditRecordFields,
    tool: z.literal(AUDIT_TOOL.ORDER_ADD_COMMENT),
    order_id: z.number().int().positive(),
    ...AuditOutcomeFields,
    replayed: z.boolean(),
  }),
  z.strictObject({
    ...CommonAuditRecordFields,
    tool: z.enum(GENERAL_AUDIT_TOOL),
    ...AuditOutcomeFields,
  }),
]);

export type AuditRecord = z.infer<typeof AuditRecordSchema>;

interface CommonAuditInput {
  readonly requestId: string | number;
  readonly outcome: z.infer<typeof AuditOutcomeSchema>;
  readonly duration_ms: number;
  readonly attempt_count: number;
}

export type AuditInput =
  | (CommonAuditInput & {
      readonly tool: typeof AUDIT_TOOL.ORDER_GET;
      readonly order_id: number;
    })
  | (CommonAuditInput & {
      readonly tool: typeof AUDIT_TOOL.ORDER_ADD_COMMENT;
      readonly order_id: number;
      readonly replayed: boolean;
    })
  | (CommonAuditInput & { readonly tool: (typeof GENERAL_AUDIT_TOOL)[number] });

export interface AuditWriter {
  write(input: AuditInput): Promise<void>;
}

export type AppendAuditLine = (path: string, line: string) => Promise<void>;

export function sanitizeRequestId(requestId: string | number): string {
  const sanitized = String(requestId)
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 128);
  return sanitized === "" ? "unknown" : sanitized;
}

export function createAuditWriter(
  path: string,
  options: {
    readonly now?: () => Date;
    readonly append?: AppendAuditLine;
  } = {},
): AuditWriter {
  const now = options.now ?? (() => new Date());
  const append =
    options.append ?? ((target, line) => appendFile(target, line, { encoding: "utf8" }));

  return {
    async write(input): Promise<void> {
      const record = AuditRecordSchema.safeParse({
        timestamp: now().toISOString(),
        request_id: sanitizeRequestId(input.requestId),
        tool: input.tool,
        outcome: input.outcome,
        duration_ms: input.duration_ms,
        attempt_count: input.attempt_count,
        ...(input.tool === AUDIT_TOOL.ORDER_GET || input.tool === AUDIT_TOOL.ORDER_ADD_COMMENT
          ? { order_id: input.order_id }
          : {}),
        ...(input.tool === AUDIT_TOOL.ORDER_ADD_COMMENT ? { replayed: input.replayed } : {}),
      });
      if (!record.success) throw new TypeError("Invalid internal audit record.");
      await append(path, `${JSON.stringify(record.data)}\n`);
    },
  };
}
