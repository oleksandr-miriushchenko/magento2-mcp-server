# Claude Desktop

This configuration connects Claude Desktop to the Magento 2 MCP server through its built-in MCP
client.

## Client, transport, and tools

- **Client:** the MCP client built into Claude Desktop.
- **Transport:** a local stdio server process.
- **Tool set:** all 39 registered server tools: 28 reads and 11 writes from the
  [tool catalog](../../docs/tool-catalog.md).

The configuration passes through the complete registered tool list. Read calls return structured
Magento data. Write calls follow the server's native MCP form elicitation, protected state, and
idempotency flow.

## Environment

Complete the shared [server environment](../README.md#server-environment). The stdio configuration
points Node.js to the repository-root `.env.local` with `--env-file`.

## Connect over stdio

Copy the contents of
[`claude-desktop-stdio.example.json`](claude-desktop-stdio.example.json) into Claude Desktop's
`claude_desktop_config.json`. Replace each placeholder with an absolute path, then fully restart
Claude Desktop.

Common configuration file locations are:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

The JSON makes Claude Desktop run the equivalent of this command:

```bash
/ABSOLUTE/PATH/TO/node \
  --use-system-ca \
  --env-file=/ABSOLUTE/PATH/TO/magento2-mcp-server/.env.local \
  /ABSOLUTE/PATH/TO/magento2-mcp-server/dist/transports/stdio.js
```

The current Node.js executable starts the built server, loads Magento settings from `.env.local`,
and uses certificates trusted by the operating system.
