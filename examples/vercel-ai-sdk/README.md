# Vercel AI SDK (TypeScript)

[`magento-agent.ts`](magento-agent.ts) uses the Vercel AI SDK to discover Magento tools over
Streamable HTTP. It gives the 28 read tools to `generateText` with the OpenAI provider and allows up
to eight model and tool steps.

## SDK, transport, and tools

- **SDKs:** `@ai-sdk/mcp` for `createMCPClient`, `ai` for `generateText`, and `@ai-sdk/openai` for
  the model provider.
- **Transport:** Streamable HTTP through the loopback MCP endpoint.
- **Tool set:** the 28 Magento read tools in the
  [tool catalog](../../docs/tool-catalog.md#read-tool-conventions).

The example discovers tools from the server, selects the shared list of 28 read tool names, and
checks that all expected tools are present before calling the model. AI SDK telemetry is disabled
for this run.

## Environment

Set these values in `examples/.env.local`:

- `OPENAI_API_KEY`: required provider key
- `OPENAI_MODEL`: optional model name; default: `gpt-6-astra`
- `MCP_HTTP_URL`: optional HTTP endpoint; default: `http://127.0.0.1:3000/mcp`

Complete the shared [server environment](../README.md#server-environment) before running the example.

## Run

Complete the [example package setup](../README.md#install-the-typescript-examples). Start the HTTP
transport from the repository root in one terminal:

```bash
pnpm build
node --use-system-ca --env-file=.env.local dist/transports/http.js
```

Then run the example from `examples` in another terminal:

```bash
pnpm vercel-ai -- "Summarize sales for the last seven days."
```

Set `MCP_HTTP_URL` when the server uses a different loopback port or MCP URL.
