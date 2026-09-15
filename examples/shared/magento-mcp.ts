import { fileURLToPath } from "node:url";

import { z } from "zod";

export const MCP_TRANSPORT = {
  HTTP: "http",
  STDIO: "stdio",
} as const;

export const MCP_ENVIRONMENT_FIELDS = {
  MCP_HTTP_URL: z.url().default("http://127.0.0.1:3000/mcp"),
  MCP_TRANSPORT: z.enum([MCP_TRANSPORT.STDIO, MCP_TRANSPORT.HTTP]).default(MCP_TRANSPORT.STDIO),
} as const;

export const MAGENTO_READ_TOOL_NAMES = [
  "order_search",
  "order_get",
  "order_tracking_get",
  "invoice_search",
  "invoice_get",
  "shipment_search",
  "shipment_get",
  "credit_memo_search",
  "credit_memo_get",
  "customer_search",
  "customer_get",
  "customer_group_search",
  "product_search",
  "product_get",
  "product_attribute_search",
  "product_attribute_get",
  "category_tree_get",
  "inventory_get",
  "inventory_source_search",
  "inventory_stock_search",
  "quote_search",
  "cms_page_search",
  "cms_page_get",
  "sales_rule_search",
  "sales_rule_get",
  "coupon_search",
  "order_analytics_get",
  "store_hierarchy_get",
] as const;

export const MAGENTO_WRITE_TOOL_NAMES = [
  "order_add_comment",
  "order_cancel",
  "order_hold",
  "order_unhold",
  "order_email_send",
  "invoice_create",
  "shipment_create",
  "product_update",
  "inventory_update",
  "cms_page_update",
  "coupon_generate",
] as const;

export const EXAMPLE_PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const MAGENTO_STDIO_ARGS = [
  "--use-system-ca",
  `--env-file=${EXAMPLE_PROJECT_ROOT}/.env.local`,
  `${EXAMPLE_PROJECT_ROOT}/dist/transports/stdio.js`,
] as const;
