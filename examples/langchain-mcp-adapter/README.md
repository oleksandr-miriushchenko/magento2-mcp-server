# LangChain JavaScript MCP adapter (TypeScript)

[`magento-agent.ts`](magento-agent.ts) connects LangChain to the Magento MCP server. It converts
the discovered MCP tools into LangChain tools, gives the 28 read tools to a `createAgent` agent, and
streams the model's answer to stdout.

## SDK, transport, and tools

- **SDKs:** `@langchain/mcp-adapters` for MCP, `langchain` for `createAgent`, and
  `@langchain/openai` for the model.
- **Transport:** stdio through `MultiServerMCPClient`.
- **Tool set:** the 28 Magento read tools in the
  [tool catalog](../../docs/tool-catalog.md#read-tool-conventions).

The example discovers tools from the server, selects the shared list of 28 read tool names, and
checks that all expected tools are present before starting the agent.

## Environment

Set these values in `examples/.env.local`:

- `OPENAI_API_KEY`: required provider key
- `OPENAI_MODEL`: optional model name; default: `gpt-6-astra`

Complete the shared [server environment](../README.md#server-environment) before running the example.

## Run

Complete the [example package setup](../README.md#install-the-typescript-examples), then run this
command from `examples`:

```bash
pnpm langchain-mcp -- "Find pending orders created today."
```

The adapter starts `dist/transports/stdio.js` with the current Node.js executable, sets the server
working directory to the repository root, and loads Magento settings from the root `.env.local`.

## LangChain settings

LangChain's v3 event stream provides model text and tool start and finish events. The example writes
fixed progress messages with known tool names to stderr and checks that the stream produced text.

The example applies these time limits:

- 30 seconds for each MCP tool call;
- 60 seconds for each OpenAI model call;
- 120 seconds for the complete agent run.
