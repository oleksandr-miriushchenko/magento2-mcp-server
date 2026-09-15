import type { RequestListener } from "node:http";

import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import type { McpHttpHandler } from "@modelcontextprotocol/server";

export const MCP_HTTP_PATH = "/mcp";

export function createHttpRequestListener(
  handler: McpHttpHandler,
  onerror: (error: Error) => void,
): RequestListener {
  const nodeHandler = toNodeHandler(handler, { onerror });
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  return (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    if (request.url !== MCP_HTTP_PATH) {
      response.writeHead(404).end();
      return;
    }
    void nodeHandler(request as NodeIncomingMessageLike, response);
  };
}
