import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { ConfigurationError, parseConfig } from "../core/config.js";
import { createServerFactory } from "../server.js";

function start(): void {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write("MCP server startup error.\n");
    process.exitCode = 1;
    return;
  }

  try {
    const serverFactory = createServerFactory(config);
    serveStdio(serverFactory, {
      legacy: "serve",
      onerror: () => {
        process.stderr.write("MCP stdio transport error.\n");
      },
    });
  } catch {
    process.stderr.write("MCP stdio transport error.\n");
    process.exitCode = 1;
  }
}

start();
