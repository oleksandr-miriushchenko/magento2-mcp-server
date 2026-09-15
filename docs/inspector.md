# Test the MCP server with MCP Inspector

MCP Inspector connects to the server, lists its 39 registered tools, displays their schemas, and
runs tool calls. You can test either stdio or Streamable HTTP.

## 1. Prepare the server

Use Node.js 24.x as described in the [requirements](../README.md#requirements). Copy
`.env.example` to `.env.local`, add the Magento configuration, and build from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
```

For stdio, Inspector starts the built server process from its configuration. For Streamable HTTP,
start the server in a separate terminal before connecting.

## 2. Choose an Inspector configuration

### stdio

Create a local configuration from the included template:

```bash
cp examples/inspector/mcp-inspector.example.json inspector.local.json
```

Replace `<ABSOLUTE_PROJECT_PATH>` with the repository path. The local file is gitignored. The
configuration runs `dist/transports/stdio.js` in that directory and loads `.env.local`, so Magento
credentials stay in the environment.

The template also enables the operating system CA store through `--use-system-ca`. When Magento
uses a specific private CA, replace `<ABSOLUTE_CA_PEM_PATH>` with its absolute PEM path. When the
system CA store contains every required certificate, remove the `env` object from the local JSON.

### Streamable HTTP

The included HTTP configuration connects to the default endpoint:

```text
examples/inspector/mcp-inspector-http.example.json
```

Its URL is `http://127.0.0.1:3000/mcp`. When `MCP_HTTP_PORT` uses another value, create a local copy
and update the URL:

```bash
cp examples/inspector/mcp-inspector-http.example.json inspector.http.local.json
```

## 3. Open Inspector

### stdio

Run from the repository root:

```bash
npx -y @modelcontextprotocol/inspector@latest --config ./inspector.local.json
```

Select `magento2-mcp-server`, connect, open **Tools**, and refresh. Inspector shows each tool's input
schema, output schema, and annotations. Select a tool, enter values accepted by the configured
Magento environment, and run it.

### Streamable HTTP

Start the built server in a separate terminal:

```bash
node --use-system-ca \
  --env-file=.env.local \
  dist/transports/http.js
```

The server reports its loopback URL on stderr. It accepts MCP traffic at `/mcp` after localhost
`Host` and `Origin` validation.

Launch Inspector with the included configuration:

```bash
npx -y @modelcontextprotocol/inspector@latest \
  --config ./examples/inspector/mcp-inspector-http.example.json
```

Select `magento2-mcp-server-http` and connect. For a custom port, pass
`--config ./inspector.http.local.json`.

## 4. Test a write

Select a write tool and enter input that matches its schema. Use a new UUID `idempotency_key` for
each intended operation.

Inspector displays the native confirmation form as an MCP `input_required` response. Accept the
form and set `confirm` to `true` to continue.

Keep the UUID with the operation. Repeating the same completed operation with the same key and input
returns its saved result.

See the [write-tool protocol](tool-catalog.md#write-tool-protocol) for the complete flow and
[error handling](error-handling.md#write-failures-and-recovery) for write error codes.

## 5. Use the CLI

List the registered stdio tools:

```bash
npx -y @modelcontextprotocol/inspector@latest --cli \
  --config ./inspector.local.json \
  --server magento2-mcp-server \
  --method tools/list
```

List tools through Streamable HTTP:

```bash
npx -y @modelcontextprotocol/inspector@latest --cli \
  --config ./examples/inspector/mcp-inspector-http.example.json \
  --server magento2-mcp-server-http \
  --method tools/list
```

Call a listed tool with an argument object that matches its input schema:

```bash
npx -y @modelcontextprotocol/inspector@latest --cli \
  --config ./inspector.local.json \
  --server magento2-mcp-server \
  --method tools/call \
  --tool-name tool_name \
  --tool-args-json '{"required_field":"value"}'
```

For a completed call, `structuredContent` matches the declared output schema and the text content
contains the same JSON. Application failures use a structured safe error and set `isError: true`.
Credentials, OAuth headers, and raw Magento responses stay out of tool results.
