import {
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
} from "@modelcontextprotocol/server";
import { RateLimiter } from "limiter";

import type { RegisterTool } from "./registration.js";
import { COMMON_ERROR_CODE } from "./shared/error-codes.js";

export const TOOL_CALL_RATE_LIMIT = {
  TOKENS_PER_SECOND: 10,
  INTERVAL: "second",
  MAX_IN_FLIGHT: 10,
} as const;

export const TOOL_CALL_RATE_LIMIT_MESSAGE =
  "The MCP server is receiving too many tool calls. Try again shortly.";

interface ToolCallLimiter {
  tryAcquire(): boolean;
  release(): void;
}

type ToolHandlerResult = CallToolResult | InputRequiredResult;
type RuntimeToolCallback = (...args: unknown[]) => ToolHandlerResult | Promise<ToolHandlerResult>;

function rateLimitedResult(): CallToolResult {
  const output = {
    ok: false as const,
    error: {
      code: COMMON_ERROR_CODE.RATE_LIMITED,
      message: TOOL_CALL_RATE_LIMIT_MESSAGE,
      retryable: true,
    },
  };
  return {
    structuredContent: output,
    content: [{ type: "text", text: JSON.stringify(output) }],
    isError: true,
  };
}

export function createToolCallLimiter(): ToolCallLimiter {
  const rateLimiter = new RateLimiter({
    tokensPerInterval: TOOL_CALL_RATE_LIMIT.TOKENS_PER_SECOND,
    interval: TOOL_CALL_RATE_LIMIT.INTERVAL,
  });
  let inFlight = 0;

  return {
    tryAcquire() {
      if (inFlight >= TOOL_CALL_RATE_LIMIT.MAX_IN_FLIGHT) return false;
      if (!rateLimiter.tryRemoveTokens(1)) return false;
      inFlight += 1;
      return true;
    },
    release() {
      inFlight -= 1;
    },
  };
}

/** Creates a registration function that checks admission before invoking each tool callback. */
export function createRateLimitedRegisterTool(
  server: McpServer,
  limiter: ToolCallLimiter,
): RegisterTool {
  return (name, config, callback) => {
    const toolCallback = callback as RuntimeToolCallback;
    const wrappedCallback: RuntimeToolCallback = async (...args) => {
      if (!limiter.tryAcquire()) return rateLimitedResult();
      try {
        return await toolCallback(...args);
      } finally {
        limiter.release();
      }
    };
    return server.registerTool(name, config, wrappedCallback as typeof callback);
  };
}
