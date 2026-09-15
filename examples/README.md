# Client examples

This directory contains a Claude Desktop configuration and small TypeScript integrations for the
built Magento 2 MCP server.

| Example                                                  | SDK or client                                                   | Transport                         | Tool set                                    |
| -------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| [Claude Desktop](claude-desktop/README.md)               | Claude Desktop MCP client                                       | stdio                             | All 39 server tools: 28 reads and 11 writes |
| [Claude Agent SDK](claude-agent-sdk/README.md)           | `@anthropic-ai/claude-agent-sdk`                                | stdio or loopback Streamable HTTP | 28 read tools                               |
| [LangChain MCP adapter](langchain-mcp-adapter/README.md) | `@langchain/mcp-adapters`, `langchain`, and `@langchain/openai` | stdio                             | 28 read tools                               |
| [OpenAI Agents SDK](openai-agents-sdk/README.md)         | `@openai/agents`                                                | stdio or loopback Streamable HTTP | 28 read tools                               |
| [Vercel AI SDK](vercel-ai-sdk/README.md)                 | `@ai-sdk/mcp`, `ai`, and `@ai-sdk/openai`                       | loopback Streamable HTTP          | 28 read tools                               |
| [MCP Inspector](../docs/inspector.md)                    | MCP Inspector                                                   | stdio or loopback Streamable HTTP | All 39 server tools: 28 reads and 11 writes |

The [tool catalog](../docs/tool-catalog.md) lists every read and write tool. Each TypeScript agent
selects the same 28 read tools after MCP discovery. The Claude Desktop and Inspector configurations
connect directly to the server and receive its complete registered tool set.

Complete the repository [setup and build](../README.md#setup-and-launch) before using an example.

## Install the TypeScript examples

The SDK examples use an independent private package. Run these commands from the repository root:

```bash
pnpm build
cd examples
pnpm install --frozen-lockfile
cp .env.example .env.local
chmod 600 .env.local
pnpm check
```

The package requires Node.js 24 and pnpm 10.3.0. Its commands load `examples/.env.local`
automatically. Existing process environment variables take priority.

Add the provider key used by the selected example:

```dotenv
# OpenAI Agents SDK, LangChain, and Vercel AI SDK
OPENAI_API_KEY=sk-...

# Claude Agent SDK
ANTHROPIC_API_KEY=sk-ant-...
```

The model overrides `OPENAI_MODEL` and `ANTHROPIC_MODEL` are optional. The shared transport
settings `MCP_TRANSPORT` and `MCP_HTTP_URL` apply where each example guide lists them.
The repository's Git ignore rules cover `examples/.env.local`.

## Server environment

The repository-root `.env.local` supplies the MCP server with these required values:

- `MAGENTO_BASE_URL`
- `MAGENTO_STORE_SCOPE`
- `MAGENTO_OAUTH_CONSUMER_KEY`
- `MAGENTO_OAUTH_CONSUMER_SECRET`
- `MAGENTO_OAUTH_ACCESS_TOKEN`
- `MAGENTO_OAUTH_ACCESS_TOKEN_SECRET`
- `MAGENTO_REQUEST_TIMEOUT_MS`
- `MCP_AUDIT_FILE`

See [environment settings](../docs/environment.md) for formats, optional limits, and the HTTP port.
The stdio example commands work from the `examples` directory and resolve the built server and root
environment file through absolute paths.

## Data flow

The stdio SDK examples start the built server as a child process:

```text
CLI prompt -> SDK agent -> model provider -> MCP tool call -> stdio server -> Magento REST API
```

The HTTP SDK examples connect to a server that is already running on the loopback interface:

```text
CLI prompt -> SDK agent -> model provider -> MCP tool call -> 127.0.0.1/mcp -> server -> Magento REST API
```

Tool results return through the same path. The provider receives the prompt and any tool results
used by the model. The server reads Magento OAuth credentials from the repository-root environment
file, while the agent reads its model-provider key from `examples/.env.local`.

Claude Desktop follows the stdio path and displays tool results in the conversation.

## Shared runtime behavior

The TypeScript examples handle output and errors as follows:

- The final model answer goes to stdout.
- LangChain writes fixed progress messages and known tool names to stderr.
- The shared runner validates environment values.
- LangChain, OpenAI Agents SDK, and Vercel AI SDK close their MCP clients in `finally`.
- Safe error text goes to stderr.
- SDK or service error details that may contain Magento data are replaced with safe text.
- A failure sets exit code `1`.
