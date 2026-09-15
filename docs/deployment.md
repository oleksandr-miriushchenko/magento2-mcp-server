# Deployment

Magento 2 MCP Server runs as a Node.js process and connects an MCP client to one configured Magento
HTTPS origin and store scope.

```text
MCP client -> MCP server -> Magento REST API
```

## Requirements

- Node.js 24.x
- pnpm 10.3.0
- A Magento 2 / Adobe Commerce instance reachable over HTTPS
- Magento OAuth 1.0a integration credentials with the ACL resources needed by the selected tools
- A writable path for the JSON Lines audit file

## Install and build

Run the commands from the repository root. This directory is also the recommended working directory
for launch, because relative audit paths resolve from the current working directory.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
chmod 600 .env.local
pnpm build
```

The build creates `dist/transports/stdio.js` and `dist/transports/http.js`.

## Configure the process

Fill in `.env.local` before launch:

| Variable                            | Purpose                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `MAGENTO_BASE_URL`                  | Magento HTTPS origin, including the scheme, host, and optional port       |
| `MAGENTO_STORE_SCOPE`               | Store view code, `default`, or `all`                                      |
| `MAGENTO_OAUTH_CONSUMER_KEY`        | OAuth 1.0a consumer key                                                   |
| `MAGENTO_OAUTH_CONSUMER_SECRET`     | OAuth 1.0a consumer secret                                                |
| `MAGENTO_OAUTH_ACCESS_TOKEN`        | OAuth 1.0a access token                                                   |
| `MAGENTO_OAUTH_ACCESS_TOKEN_SECRET` | OAuth 1.0a access-token secret                                            |
| `MAGENTO_REQUEST_TIMEOUT_MS`        | Magento request deadline from 100 to 120000 milliseconds                  |
| `MAGENTO_MAX_RESPONSE_BYTES`        | Magento JSON response cap; defaults to 10485760 bytes                     |
| `MCP_MAX_PAGE_SIZE`                 | Highest accepted tool page size; defaults to 25                           |
| `MCP_AUDIT_FILE`                    | Writable JSON Lines path; relative paths start from the working directory |
| `MCP_HTTP_PORT`                     | Loopback HTTP port from 1 to 65535; defaults to 3000                      |

`MAGENTO_MAX_RESPONSE_BYTES`, `MCP_MAX_PAGE_SIZE`, and `MCP_HTTP_PORT` have defaults. The example
environment file lists every setting and provides sample values for the request deadline, response
limit, page size, audit path, and HTTP port. See [Environment settings](environment.md) for
validation rules and store scope details.

Node.js can read certificates from the operating system trust store with `--use-system-ca`. For a
specific private CA, set `NODE_EXTRA_CA_CERTS` to its absolute PEM path before Node.js starts.

## Run with stdio

Stdio carries MCP JSON-RPC through stdin and stdout:

```text
MCP client -> MCP server -> Magento REST API
```

Start the built entry point:

```bash
node --use-system-ca --env-file=.env.local dist/transports/stdio.js
```

The MCP client normally launches this command as a child process. Stdout carries protocol messages,
and diagnostics go to stderr. The [Claude Desktop example](../examples/claude-desktop/README.md) and
[MCP Inspector guide](inspector.md) include ready-to-copy stdio settings.

## Run with Streamable HTTP

Streamable HTTP serves local clients through the loopback interface:

```text
MCP client -> 127.0.0.1/mcp -> MCP server -> Magento REST API
```

Start the built entry point:

```bash
node --use-system-ca --env-file=.env.local dist/transports/http.js
```

The server listens on `127.0.0.1` and uses this fixed endpoint:

```text
http://127.0.0.1:3000/mcp
```

Set `MCP_HTTP_PORT` in `.env.local` to choose another port. The path remains `/mcp`. The transport
checks `Host` and `Origin` with the MCP SDK's loopback validation before it handles an MCP request.
Other paths receive HTTP 404.

The [OpenAI Agents SDK](../examples/openai-agents-sdk/README.md),
[Vercel AI SDK](../examples/vercel-ai-sdk/README.md), and [MCP Inspector](inspector.md) examples show
loopback HTTP connections.

## Choose a transport

Both transports expose the same 39 tools and use the same Magento and audit settings. Run one
transport entry point in each server process:

- Choose stdio when the client starts and manages the server child process.
- Choose Streamable HTTP when the MCP client and server run as separate processes on the same host.

The HTTP process handles `SIGINT` and `SIGTERM` by closing its listener and MCP handler.
