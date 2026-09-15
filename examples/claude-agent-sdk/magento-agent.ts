import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import {
  EXAMPLE_PROJECT_ROOT,
  MAGENTO_READ_TOOL_NAMES,
  MAGENTO_STDIO_ARGS,
  MAGENTO_WRITE_TOOL_NAMES,
  MCP_ENVIRONMENT_FIELDS,
  MCP_TRANSPORT,
} from "../shared/magento-mcp.js";
import { runExample, SafeExampleError } from "../shared/example-runtime.js";

const MCP_SERVER_NAME = "magento";

const environmentSchema = z.object({
  ...MCP_ENVIRONMENT_FIELDS,
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
});
type Environment = z.infer<typeof environmentSchema>;

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new SafeExampleError(
      "Set ANTHROPIC_API_KEY and verify MCP_TRANSPORT, MCP_HTTP_URL, and ANTHROPIC_MODEL.",
    );
  }
  return result.data;
}

function qualifyToolName(toolName: string): string {
  return `mcp__${MCP_SERVER_NAME}__${toolName}`;
}

function createMcpServerConfig(environment: Environment): McpServerConfig {
  if (environment.MCP_TRANSPORT === MCP_TRANSPORT.HTTP) {
    return {
      alwaysLoad: true,
      type: "http",
      url: environment.MCP_HTTP_URL,
    };
  }

  return {
    alwaysLoad: true,
    args: [...MAGENTO_STDIO_ARGS],
    command: process.execPath,
    env: {},
    type: "stdio",
  };
}

async function runAgent(): Promise<void> {
  const environment = parseEnvironment();
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Show the store hierarchy and summarize its websites, stores, and store views.";
  const messages = query({
    prompt,
    options: {
      allowedTools: MAGENTO_READ_TOOL_NAMES.map(qualifyToolName),
      cwd: EXAMPLE_PROJECT_ROOT,
      disallowedTools: MAGENTO_WRITE_TOOL_NAMES.map(qualifyToolName),
      maxTurns: 8,
      mcpServers: { [MCP_SERVER_NAME]: createMcpServerConfig(environment) },
      ...(environment.ANTHROPIC_MODEL === undefined ? {} : { model: environment.ANTHROPIC_MODEL }),
      permissionMode: "dontAsk",
      permissionPrompts: "none",
      settingSources: [],
      strictMcpConfig: true,
      systemPrompt:
        "Use Magento MCP tools before answering questions about the store. This example is " +
        "read-only: never claim that you changed Magento data.",
      tools: [],
    },
  });

  for await (const message of messages) {
    if (message.type !== "result") continue;

    if (message.subtype === "success" && !message.is_error) {
      console.log(message.result);
      return;
    }

    throw new SafeExampleError("Claude Agent SDK did not return a successful result.");
  }

  throw new SafeExampleError("Claude Agent SDK ended without a result message.");
}

await runExample("claude-agent", runAgent);
