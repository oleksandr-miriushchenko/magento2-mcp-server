# Tool catalog

The server registers 39 Magento 2 and Adobe Commerce admin tools: 28 reads and 11 writes.

Every tool provides:

- one or more fixed Magento REST routes;
- strict input and output schemas with defined fields;
- structured MCP results;
- the same result as JSON text.

A successful tool call returns `{ ok: true, data }`. An application failure returns
`{ ok: false, error: { code, message, retryable } }` with `isError: true`. See
[error handling](error-handling.md) for code mappings, Magento business messages, response limits,
and audit failure behavior.

The MCP SDK checks each strict input schema before the tool handler starts. Structured application
results and audit records begin after input validation succeeds.

## Read-tool conventions

In the tables below, `?` marks an optional input. **Pagination** means `page_size?` and `cursor?`.
`page_size` defaults to the configured `MCP_MAX_PAGE_SIZE` and accepts values up to that limit.
`cursor` is the signed `next_cursor` returned by the same tool.

Each cursor is signed and bound to:

- the tool;
- filters;
- sort;
- page size.

The server creates the signature key at startup. A restart creates a new key. A cursor from an
earlier process, a changed argument set, or an invalid signature returns `INVALID_CURSOR`.

The server validates every Magento page against an entity-specific schema. It also checks that the
returned `items` count fits the requested `page_size`. Search tools return `total_count`,
`page_size`, and `next_cursor` with their result array.

### Orders and fulfillment

| Tool                 | Input                                                                                                                                                                                                                                                           | Success data                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `order_search`       | At least one of `increment_id?`, `customer_email?`, `customer_id?`, `status?`, `created_from?`, `created_to?`, `grand_total_min?`, or `grand_total_max?`; `sort?`; pagination. Sort: `newest` (default), `oldest`, `total_high_to_low`, or `total_low_to_high`. | `orders` with IDs, store, state, status, dates, currency, totals, item count, and customer summary.                                  |
| `order_get`          | `order_id`                                                                                                                                                                                                                                                      | Order identity, state, dates, currency, totals, customer, billing and shipping addresses, items, status history, and payment method. |
| `order_tracking_get` | `order_id`; pagination.                                                                                                                                                                                                                                         | `order_id`, shipment summaries with tracking entries, and pagination fields.                                                         |
| `invoice_search`     | At least one of `order_id?` or `state?`; `sort?`; pagination. State: `open`, `paid`, or `canceled`.                                                                                                                                                             | Invoice summaries with IDs, order, state, dates, currency, grand total, and quantity.                                                |
| `invoice_get`        | `invoice_id`                                                                                                                                                                                                                                                    | Invoice summary, totals, and invoice items.                                                                                          |
| `shipment_search`    | `order_id`; `sort?`; pagination.                                                                                                                                                                                                                                | Shipment summaries with IDs, order, dates, and quantity.                                                                             |
| `shipment_get`       | `shipment_id`                                                                                                                                                                                                                                                   | Shipment summary, weight, status, items, and tracking entries.                                                                       |
| `credit_memo_search` | At least one of `order_id?` or `state?`; `sort?`; pagination. State: `open`, `refunded`, or `canceled`.                                                                                                                                                         | Credit memo summaries with IDs, order, invoice, state, dates, currency, and grand total.                                             |
| `credit_memo_get`    | `credit_memo_id`                                                                                                                                                                                                                                                | Credit memo summary, totals, adjustments, and items.                                                                                 |

`invoice_search`, `shipment_search`, and `credit_memo_search` use `newest` as their default sort and
also accept `oldest`.

`order_get` returns nullable `billing_address` and `shipping_address` objects with the same
documented address fields. Shipping comes from the first shipping assignment in the scoped order
response. When Magento omits shipping data, including for a virtual order, `shipping_address` is
`null`. One order response supplies all values.

### Customers

| Tool                    | Input                                                                                                                                                    | Success data                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `customer_search`       | `customer_id?`, `email?`, `name?`, `group_id?`, `website_id?`, `sort?`; pagination. Sort: `newest` (default), `oldest`, `name_a_to_z`, or `name_z_to_a`. | Customer summaries with IDs, name, email, and creation and update dates. |
| `customer_get`          | `customer_id`                                                                                                                                            | Customer IDs, name, email, dates, and saved addresses.                   |
| `customer_group_search` | `code?`, `sort?`; pagination. Sort: `id_ascending` (default), `name_ascending`, or `name_descending`.                                                    | Customer groups with group ID, code, and tax class ID.                   |

### Catalog and inventory

| Tool                       | Input                                                                                                          | Success data                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `product_search`           | `search?`, `sku?`, `status?`, `visibility?`, `product_type?`, `price_min?`, `price_max?`, `sort?`; pagination. | Product summaries with ID, SKU, name, type, status, visibility, price, attribute set, and dates.     |
| `product_get`              | `sku`                                                                                                          | Product identity, type, attribute set, price, weight, status, visibility, dates, and category links. |
| `product_attribute_search` | `code?`, `label?`, `user_defined?`; pagination.                                                                | Attribute metadata and storefront, filter, search, and comparison flags.                             |
| `product_attribute_get`    | `attribute_code`                                                                                               | Attribute metadata and its label/value options.                                                      |
| `category_tree_get`        | `root_category_id?`, `depth?` from 1 to 10. Default depth: 10.                                                 | A nested category root with IDs, name, active state, position, level, product count, and children.   |
| `inventory_get`            | `sku`, `stock_id`                                                                                              | `sku`, `stock_id`, `salable_quantity`, and `is_salable`.                                             |
| `inventory_source_search`  | `source_code?`, `name?`, `enabled?`, `country_code?`; pagination.                                              | Inventory sources with code, name, enabled state, description, and country code.                     |
| `inventory_stock_search`   | `name?`; pagination.                                                                                           | Inventory stocks with ID, name, and website sales-channel assignments.                               |

`product_search` supports status `enabled` or `disabled`; visibility `not_visible`, `catalog`,
`search`, or `catalog_search`; and the standard product types `simple`, `configurable`, `grouped`,
`bundle`, `virtual`, and `downloadable`. Its sort values are `newest` (default), `oldest`,
`name_a_to_z`, `name_z_to_a`, `price_low_to_high`, and `price_high_to_low`.

### Commerce operations

| Tool                  | Input                                                                                            | Success data                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `quote_search`        | `active?` (default `true`), `customer_id?`, `updated_from?`, `updated_to?`; pagination.          | Quote identity, store, dates, active and virtual flags, item counts, currency, and customer summary.                              |
| `cms_page_search`     | `identifier?`, `title?`, `active?`; pagination.                                                  | CMS page summaries with ID, identifier, title, active state, dates, and sort order.                                               |
| `cms_page_get`        | `page_id`                                                                                        | CMS page summary plus layout, metadata, heading, and content.                                                                     |
| `sales_rule_search`   | `name?`, `active?`; pagination.                                                                  | Cart price rule summaries with dates, action, discount, coupon type, and usage count.                                             |
| `sales_rule_get`      | `rule_id`                                                                                        | Cart price rule details, website and customer group IDs, usage settings, processing flags, quantity rules, and shipping settings. |
| `coupon_search`       | `rule_id`, `code?`; pagination.                                                                  | Coupons with IDs, code, usage limits and count, expiration, primary flag, and type.                                               |
| `order_analytics_get` | `created_from`, `created_to`, `status?`. Dates use `YYYY-MM-DD`; the range spans up to 366 days. | Requested range, status, total and scanned order counts, completeness flag, and totals grouped by currency.                       |
| `store_hierarchy_get` | Empty object `{}`                                                                                | Websites containing store groups and store views, including IDs, codes, names, defaults, roots, and active state.                 |

`order_analytics_get` scans up to five pages of 100 orders in ascending entity ID order. Each
currency group contains order count, gross value, paid amount, refunded amount, net collected
amount, and average order value. `is_complete` reports whether the scan covered Magento's full
`total_order_count`.

### Search and returned data

`product_search` uses `/V1/products`, and `order_search` uses `/V1/orders`. Both request defined
fields, build filters from named inputs, use named sort options, and add `entity_id` as the unique
tie-breaker.

Customer data follows these rules:

- `order_search`, `order_get`, `customer_search`, `customer_get`, and `quote_search` return the
  customer identity fields declared by their schemas.
- Customer values keep their original Magento form.
- `order_get` returns its declared billing and shipping addresses.
- `customer_get` returns its declared saved addresses.
- Public schemas include the documented `payment_method` name.
- Public schemas exclude passwords, extra Magento attributes, payment credentials, transaction data,
  and operator comment text.
- Audit records exclude returned customer values.

Every read uses the configured store scope directly in its fixed REST URL. `default` selects the
Default Store View, and `all` selects the global scope. See
[store scope settings](environment.md#store-scope).

## Write tools

Every write accepts a UUID `idempotency_key` in addition to the fields shown below.

| Tool                | Input                                                                                                                                                                                 | Success data                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `order_add_comment` | `order_id`, `comment` from 1 to 2,000 characters                                                                                                                                      | `order_id`, `comment_added: true`, `customer_notified: false`, `visible_on_storefront: false`. |
| `order_cancel`      | `order_id`                                                                                                                                                                            | `order_id`, `canceled: true`.                                                                  |
| `order_hold`        | `order_id`                                                                                                                                                                            | `order_id`, `held: true`.                                                                      |
| `order_unhold`      | `order_id`                                                                                                                                                                            | `order_id`, `unheld: true`.                                                                    |
| `order_email_send`  | `order_id`                                                                                                                                                                            | `order_id`, `email_sent: true`.                                                                |
| `invoice_create`    | `order_id`, `capture?` (default `false`), `notify?` (default `false`)                                                                                                                 | `order_id`, `invoice_id`, `capture_requested`, `notification_requested`.                       |
| `shipment_create`   | `order_id`, `notify?` (default `false`), `tracks?` (default `[]`, up to 10). Each track has `track_number`, `carrier_code`, and `title`.                                              | `order_id`, `shipment_id`, `notification_requested`, `tracking_count`.                         |
| `product_update`    | `sku` and at least one of `name?`, `price?`, `status?`, `visibility?`, or `weight?`.                                                                                                  | `sku`, `updated: true`, and `changed_fields`.                                                  |
| `inventory_update`  | `source_items`, from 1 to 100 unique SKU/source pairs. Each item has `sku`, `source_code`, non-negative `quantity`, and `status` (`in_stock` or `out_of_stock`).                      | `updated_count`.                                                                               |
| `cms_page_update`   | `page_id` and at least one of `title?`, `content?`, `active?`, `meta_title?`, `meta_keywords?`, `meta_description?`, or `content_heading?`. Metadata fields accept strings or `null`. | `page_id`, `updated: true`.                                                                    |
| `coupon_generate`   | `rule_id`, `quantity` from 1 to 100, `length?` (default 12), `format?` (`alphanum`, `alpha`, or `num`), `prefix?`, `suffix?`, `delimiter_at_every?`, `delimiter?`.                    | `rule_id`, `quantity`, and generated `coupons`.                                                |

`order_add_comment` always creates a private, non-notifying comment. `inventory_update` sends every
source item in one `POST /V1/inventory/source-items` request. `coupon_generate` requests every code
in one `POST /V1/coupons/generate` request.

Product, inventory, and CMS updates send defined fields. Magento validates the current resource and
business state when it processes the write.

## Write-tool protocol

Before a write, the server:

- validates the tool input;
- checks the UUID `idempotency_key`.

The key check can return:

- the saved result when the same operation has already finished;
- `IDEMPOTENCY_CONFLICT` when the key is linked to different input;
- `IDEMPOTENCY_IN_PROGRESS` when the operation is active or its final result is unknown.

A new key follows these steps:

1. The server starts native MCP form elicitation.
2. The client resumes the request with action `accept` and `confirm: true`.
3. Protected state binds the MCP method, tool name, and validated arguments for five minutes.
4. The server links the UUID key to the same operation.
5. The server reserves the key and sends one write request to Magento.
6. The server saves a successful result. The same key and input return that result and skip another
   form and Magento write.
7. An unknown outcome keeps the reservation for the life of the process.
8. Keep the original key to identify the operation. Check the current Magento state before deciding
   whether a new write is needed.

The process-level idempotency registry stores up to 1,000 entries for each tool. Completed results
remain available for replay for up to 24 hours.
