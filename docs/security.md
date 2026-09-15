# Security

Magento 2 MCP Server reads one validated configuration at startup. Its security controls protect
Magento requests, write operations, tool results, and audit records.

## Magento access

- `MAGENTO_BASE_URL` fixes the HTTPS origin and accepts its scheme, host, and optional port.
- The server uses one configured store scope in every `/rest/{scope}/V1/...` request.
- OAuth 1.0a signs each Magento request with credentials held in the server environment.
- Each tool uses one or more fixed REST routes and builds its query from defined input fields.
- Magento applies the ACL of the configured OAuth integration to every request.
- TLS certificate checks stay active. Node.js can use the operating system CA store through
  `--use-system-ca` and can load a private CA through `NODE_EXTRA_CA_CERTS`.

The stdio transport carries MCP JSON-RPC through stdin and stdout. The HTTP transport binds to
`127.0.0.1`, serves `/mcp`, and checks loopback `Host` and `Origin` values.

## Input and response validation

Every tool has strict input and output schemas. Inputs accept defined fields, filters, sort choices,
and value ranges. Search tools limit the number of items on each page. Signed cursors keep the
original filters, sort, and page size together across requests.

Magento JSON responses must fit the configured byte limit before parsing. The default and maximum
value is 10 MiB. A domain schema checks the parsed data, and the tool returns its defined result
fields.

GET requests share one configured deadline across the first request and one safe retry. A retry can
follow a network failure or HTTP 502, 503, or 504. Each attempt receives a fresh OAuth signature.
Write requests use one attempt.

Magento HTTP 400 and 404 responses may add short business details to a tool error. The server checks
the error response format, replaces control characters, normalizes whitespace, limits parameters,
and limits the final detail length. Other response classes use server-owned messages.

## Write protection

- Strict schemas validate every write input.
- Native MCP form elicitation requires action `accept` and `confirm: true`.
- Signed protected state links the approval to the MCP method, tool name, and validated input for
  five minutes.
- A UUID `idempotency_key` links each write to one operation. Completed operations can return their
  saved result.
- Each new operation sends one write request to Magento.
- An unknown result keeps the key reserved. Check the current Magento state before starting a new
  write.

See the [write-tool protocol](tool-catalog.md#write-tool-protocol) and
[write error handling](error-handling.md#write-failures-and-recovery) for the complete flow.

## Result and audit data

Successful tool results contain the fields declared by their output schemas. Customer and address
values keep their original Magento values. Results exclude credentials, passwords, payment
credentials, transaction data, extra Magento attributes, operator comment text, and raw Magento
responses. `order_get` includes the documented payment method name.

A completed tool call appends one JSON Lines audit record with these fields:

- `timestamp`
- `request_id`
- `tool`
- `outcome`
- `duration_ms`
- `attempt_count`

`order_get` also records `order_id`. `order_add_comment` records `order_id` and `replayed`.

Apart from the documented `order_id` fields, audit records exclude tool arguments, idempotency keys,
search filters, cursors, returned customer data, raw Magento bodies, error messages, OAuth headers,
and credentials.

When appending the audit record fails:

- a successful read returns a safe error instead of its data;
- a confirmed write reports that Magento accepted the write and tells the caller to keep the key;
- an existing tool error keeps its original message and adds the audit failure.

Make the audit path writable before the next operation.

See [Error handling](error-handling.md) for the complete result and error behavior and
[Environment settings](environment.md) for configuration rules.
