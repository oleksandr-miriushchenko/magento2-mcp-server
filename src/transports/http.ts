import { createServer as createHttpServer } from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";

import { ConfigurationError, parseConfig, parseHttpConfig } from "../core/config.js";
import { createServerFactory } from "../server.js";
import { createHttpRequestListener, MCP_HTTP_PATH } from "./http-request-listener.js";

const HTTP_HOST = "127.0.0.1";

function reportTransportError(): void {
  process.stderr.write("MCP HTTP transport error.\n");
}

function start(): void {
  let config;
  let httpConfig;
  try {
    config = parseConfig(process.env);
    httpConfig = parseHttpConfig(process.env);
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
    const handler = createMcpHandler(serverFactory, {
      legacy: "reject",
      onerror: reportTransportError,
      responseMode: "auto",
    });
    const httpServer = createHttpServer(createHttpRequestListener(handler, reportTransportError));

    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      if (httpServer.listening) httpServer.close();
      void handler.close().catch(reportTransportError);
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    httpServer.once("error", () => {
      reportTransportError();
      process.exitCode = 1;
      close();
    });
    httpServer.listen(httpConfig.port, HTTP_HOST, () => {
      process.stderr.write(
        `MCP Streamable HTTP listening on http://${HTTP_HOST}:${httpConfig.port}${MCP_HTTP_PATH}.\n`,
      );
    });
  } catch {
    process.stderr.write("MCP server startup error.\n");
    process.exitCode = 1;
  }
}

start();
