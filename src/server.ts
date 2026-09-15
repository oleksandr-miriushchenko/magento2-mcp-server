import { randomBytes } from "node:crypto";

import { McpServer, type McpServerFactory } from "@modelcontextprotocol/server";

import { createAuditWriter } from "./core/audit.js";
import type { ServerConfig } from "./core/config.js";
import { InMemoryIdempotencyRegistry } from "./core/idempotency.js";
import { createWriteApprovalPolicy } from "./core/write-approval.js";
import { MagentoClient } from "./magento/client.js";
import type { ToolDependencies } from "./tools/dependencies.js";
import { registerTools } from "./tools/index.js";
import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
} from "./tools/rate-limited-registration.js";

export function createServerFactory(config: ServerConfig): McpServerFactory {
  // Dependencies created in this scope are captured by the returned McpServerFactory and shared
  // by every MCP server instance it produces.
  const approval = createWriteApprovalPolicy(randomBytes(32));
  const toolCallLimiter = createToolCallLimiter();

  const magentoClient = new MagentoClient({
    baseUrl: config.baseUrl,
    storeScope: config.storeScope,
    oauth: config.oauth,
    timeoutMs: config.requestTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
  });

  // ToolDependencies belongs only to the tools capability group; it is not a whole-server
  // dependency container and must not replace McpServerFactory as this function's return type.
  const toolDependencies: ToolDependencies = {
    client: magentoClient,
    audit: createAuditWriter(config.auditFile),
    approval,
    idempotency: new InMemoryIdempotencyRegistry(),
    maxPageSize: config.maxPageSize,
    cursorKey: randomBytes(32),
  };

  return () => {
    const server = new McpServer(
      { name: "magento2-mcp-server", version: "0.1.0" },
      {
        requestState: { verify: approval.verify },
      },
    );

    // Tools are only one MCP capability group. Illustrative future composition (these functions
    // and dependencies should exist only when their capability is actually implemented):
    // registerResources(server, resourceDependencies);
    // registerPrompts(server, promptDependencies);
    const registerTool = createRateLimitedRegisterTool(server, toolCallLimiter);
    registerTools(registerTool, toolDependencies);

    return server;
  };
}
