# OpenAI Agents SDK (TypeScript)

[`magento-agent.ts`](magento-agent.ts) creates a Magento operations agent with the OpenAI Agents
SDK. It starts the built MCP server over stdio by default and can connect to the loopback
Streamable HTTP endpoint.

## SDK, transport, and tools

- **SDK:** `@openai/agents`, using `Agent`, `Runner`, `MCPServerStdio`, and
  `MCPServerStreamableHttp`.
- **Transport:** stdio by default; Streamable HTTP when `MCP_TRANSPORT=http`.
- **Tool set:** the 28 Magento read tools in the
  [tool catalog](../../docs/tool-catalog.md#read-tool-conventions).

The SDK tool filter uses the shared list of 28 read tool names, caches MCP discovery, and reads
schema-validated structured content from tool results.

The `Runner` disables Agents SDK tracing and sensitive trace content.

## Environment

Set these values in `examples/.env.local`:

- `OPENAI_API_KEY`: required provider key
- `OPENAI_MODEL`: optional model name; default: `gpt-6-astra`
- `MCP_TRANSPORT`: optional transport; default: `stdio`
- `MCP_HTTP_URL`: optional HTTP endpoint; default: `http://127.0.0.1:3000/mcp`

Complete the shared [server environment](../README.md#server-environment) before running the example.

## Run over stdio

Complete the [example package setup](../README.md#install-the-typescript-examples), then run this
command from `examples`:

```bash
pnpm openai-agents -- "Show the store hierarchy."
```

The SDK launches `dist/transports/stdio.js` as a child process with the current Node.js executable.
The child process loads the server settings from the repository-root `.env.local`.

## Run over Streamable HTTP

Start the HTTP transport from the repository root in one terminal:

```bash
pnpm build
node --use-system-ca --env-file=.env.local dist/transports/http.js
```

Then run the agent from `examples` in another terminal:

```bash
MCP_TRANSPORT=http pnpm openai-agents -- "Find active products containing shirt."
```

Set `MCP_HTTP_URL` when the server uses a different loopback port or MCP URL.
