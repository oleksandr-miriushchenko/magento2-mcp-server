# Error handling

Every registered tool declares a strict output schema with two result formats:

- success: `{ ok: true, data }`;
- application failure: `{ ok: false, error: { code, message, retryable } }` with `isError: true`.

For both formats, `structuredContent` contains the result and the text content contains the same
value as JSON.

The MCP SDK checks the strict input schema before the tool handler starts. If validation fails, the
SDK returns its validation response at that stage. Structured application results and audit records
begin after validation succeeds.

The server validates every completed handler result against the tool's output schema. A safe
`INTERNAL_ERROR` replaces a result that fails this validation. Empty collections remain successful
results.

## Error codes

| Code                        | Meaning                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMITED`              | The process reached its tool-call rate or active-call limit.                                                           |
| `FORBIDDEN`                 | Magento returned HTTP 401 or 403.                                                                                      |
| `NOT_FOUND`                 | Magento returned HTTP 404. All 39 tool schemas include this code.                                                      |
| `UPSTREAM_REJECTED`         | Magento returned a definite business or request rejection.                                                             |
| `UPSTREAM_UNAVAILABLE`      | Magento was unavailable for a read, a write stopped before sending, or Magento returned HTTP 429.                      |
| `UPSTREAM_INVALID_RESPONSE` | Magento returned HTTP 405 or 406, or a successful read returned invalid JSON, an oversized body, or unexpected data.   |
| `UPSTREAM_OUTCOME_UNKNOWN`  | A write may have reached Magento, and its final result is unknown.                                                     |
| `INVALID_CURSOR`            | A search received an invalid cursor, a cursor for different input, or a cursor created before the latest server start. |
| `APPROVAL_DECLINED`         | The native approval response declined the write.                                                                       |
| `IDEMPOTENCY_CONFLICT`      | The UUID key is already bound to different arguments for the same tool.                                                |
| `IDEMPOTENCY_IN_PROGRESS`   | The UUID key belongs to an active or unresolved operation.                                                             |
| `INTERNAL_ERROR`            | A local policy, output validation, audit, or unexpected processing error prevented a verified result.                  |

`retryable` describes the current failure. `RATE_LIMITED` is retryable. Read transport failures,
timeouts, and final HTTP 502, 503, or 504 responses are also marked retryable when the request can
be attempted again safely.

## Magento requests and responses

GET requests use one total `MAGENTO_REQUEST_TIMEOUT_MS` deadline. The client makes up to two
attempts after a network failure or HTTP 502, 503, or 504. Each write sends one POST or PUT request.

The server maps Magento failures as follows:

- A write network failure, deadline, HTTP 5xx response, or unreadable success response maps to
  `UPSTREAM_OUTCOME_UNKNOWN`.
- HTTP 400 and 404 are definite business results.
- HTTP 401 and 403 map to `FORBIDDEN`.
- HTTP 405 and 406 map to `UPSTREAM_INVALID_RESPONSE`.
- HTTP 429 maps to `UPSTREAM_UNAVAILABLE`.
- Other HTTP 4xx responses map to `UPSTREAM_REJECTED`.

The client applies `MAGENTO_MAX_RESPONSE_BYTES` to every Magento JSON body:

- It checks the declared `Content-Length` before reading the body.
- It counts the bytes while reading the response.
- An oversized successful read maps to `UPSTREAM_INVALID_RESPONSE`.
- An oversized successful write maps to `UPSTREAM_OUTCOME_UNKNOWN`, because Magento may have saved
  the change.
- An oversized HTTP 400 or 404 response keeps its `UPSTREAM_REJECTED` or `NOT_FOUND` classification
  and uses a server-owned message.

Successful Magento responses pass an entity-specific schema before mapping to the public result.
Paginated responses also pass a page-size check. A response with more items than the requested
`page_size` maps to `UPSTREAM_INVALID_RESPONSE`.

## Magento business messages

For HTTP 400 and 404, the server can include details from a valid Magento error response. It accepts:

- a message of up to 1,000 characters;
- up to ten string, number, or boolean parameters;
- up to 256 characters in each string parameter.

The server substitutes placeholders once, replaces control characters with spaces, normalizes
whitespace, and limits the final detail to 1,500 characters. Other error bodies produce a
server-owned message.

Accepted business messages can contain values supplied by Magento. Treat this text as diagnostic
data. Customer identity and address fields keep their original Magento values when the success
schema includes them.

Error text and raw Magento bodies stay out of audit records and runtime diagnostics.

## Tool-call limits

One server process applies these limits:

- ten tool calls per second;
- a burst capacity of ten;
- ten active tool calls.

Extra calls receive `RATE_LIMITED` before the tool handler starts. The failure follows the requested
tool's output schema and uses the normal structured result plus JSON text mirror.

The limits apply to tool calls. MCP discovery and connection methods continue normally.

## Write failures and recovery

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

The registry keeps up to 1,000 entries for each tool. It keeps completed results for up to 24 hours
and removes the oldest completed entry when space is needed.

`UPSTREAM_OUTCOME_UNKNOWN` keeps the reservation for the life of the process. The same key then returns
`IDEMPOTENCY_IN_PROGRESS`. Check the current Magento state through the matching read tool or Magento
Admin before starting another write.

Magento performs the final business-state checks while processing the write. A valid HTTP 400 or
404 business response becomes a safe `UPSTREAM_REJECTED` or `NOT_FOUND` result.

## Audit failure behavior

Each finished tool handler appends one JSON Lines record. The common fields are
`timestamp`, `request_id`, `tool`, `outcome`, `duration_ms`, and `attempt_count`. `order_get` also
records `order_id`. `order_add_comment` records `order_id` and `replayed`.

Beyond the documented `order_id` fields, audit records exclude other tool arguments, returned data,
search filters, cursors, write payloads, idempotency keys, error messages, and raw Magento bodies.

An audit write failure returns an application error with `retryable: false`:

- A failed operation keeps its original code and safe message, then adds the audit failure.
- A confirmed write returns `INTERNAL_ERROR` and states that Magento confirmed the write. The
  saved result remains available for replay with the same key while it stays in the process.
- A successful read returns `INTERNAL_ERROR` instead of the result data.

Restore the audit destination before the next operation.
