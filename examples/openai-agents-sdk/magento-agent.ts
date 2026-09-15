import {
  Agent,
  type MCPServer,
  MCPServerStdio,
  MCPServerStreamableHttp,
  Runner,
} from "@openai/agents";
import { z } from "zod";

import {
  MAGENTO_READ_TOOL_NAMES,
  MAGENTO_STDIO_ARGS,
  MCP_ENVIRONMENT_FIELDS,
  MCP_TRANSPORT,
} from "../shared/magento-mcp.js";
import { runExample, SafeExampleError } from "../shared/example-runtime.js";

const environmentSchema = z.object({
  ...MCP_ENVIRONMENT_FIELDS,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-astra"),
});
type Environment = z.infer<typeof environmentSchema>;

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new SafeExampleError(
      "Set OPENAI_API_KEY and verify MCP_TRANSPORT, MCP_HTTP_URL, and OPENAI_MODEL.",
    );
  }
  return result.data;
}

function createMcpServer(environment: Environment): MCPServer {
  const commonOptions = {
    cacheToolsList: true,
    name: "Magento 2 MCP Server",
    toolFilter: { allowedToolNames: [...MAGENTO_READ_TOOL_NAMES] },
    useStructuredContent: true,
  };

  if (environment.MCP_TRANSPORT === MCP_TRANSPORT.HTTP) {
    return new MCPServerStreamableHttp({
      ...commonOptions,
      url: environment.MCP_HTTP_URL,
    });
  }

  return new MCPServerStdio({
    ...commonOptions,
    args: [...MAGENTO_STDIO_ARGS],
    command: process.execPath,
    env: {},
  });
}

async function main(): Promise<void> {
  const environment = parseEnvironment();
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Show the store hierarchy and summarize its websites, stores, and store views.";
  const mcpServer = createMcpServer(environment);

  try {
    await mcpServer.connect();
    const agent = new Agent({
      instructions:
        "Use Magento MCP tools before answering questions about the store. This example is " +
        "read-only: never claim that you changed Magento data.",
      mcpServers: [mcpServer],
      model: environment.OPENAI_MODEL,
      name: "Magento operations assistant",
    });
    const runner = new Runner({
      traceIncludeSensitiveData: false,
      tracingDisabled: true,
    });
    const result = await runner.run(agent, prompt);

    console.log(result.finalOutput);
  } finally {
    await mcpServer.close();
  }
}

await runExample("openai-agents", main);
