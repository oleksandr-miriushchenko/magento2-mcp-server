import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";
import { z } from "zod";

import {
  EXAMPLE_PROJECT_ROOT,
  MAGENTO_READ_TOOL_NAMES,
  MAGENTO_STDIO_ARGS,
} from "../shared/magento-mcp.js";
import { runExample, SafeExampleError } from "../shared/example-runtime.js";

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-astra"),
});
type Environment = z.infer<typeof environmentSchema>;

const readToolNames = new Set<string>(MAGENTO_READ_TOOL_NAMES);
const modelTimeoutMs = 60_000;
const toolTimeoutMs = 30_000;
const runTimeoutMs = 120_000;

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new SafeExampleError(
      "Set OPENAI_API_KEY and verify that OPENAI_MODEL contains a non-empty model name.",
    );
  }
  return result.data;
}

function reportProgress(message: string): void {
  process.stderr.write(`[langchain-mcp] ${message}\n`);
}

async function main(): Promise<void> {
  const environment = parseEnvironment();
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Show the store hierarchy and summarize its websites, stores, and store views.";
  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      magento: {
        args: [...MAGENTO_STDIO_ARGS],
        command: process.execPath,
        cwd: EXAMPLE_PROJECT_ROOT,
        defaultToolTimeout: toolTimeoutMs,
        env: {},
        transport: "stdio",
      },
    },
    onConnectionError: "throw",
    prefixToolNameWithServerName: false,
    throwOnLoadError: true,
    useStandardContentBlocks: true,
  });

  try {
    reportProgress("Connecting to the Magento MCP server...");
    const discoveredTools = await mcpClient.getTools("magento");
    const tools = discoveredTools.filter((tool) => readToolNames.has(tool.name));
    const missingTools = MAGENTO_READ_TOOL_NAMES.filter(
      (name) => !tools.some((tool) => tool.name === name),
    );

    if (missingTools.length > 0) {
      throw new SafeExampleError(
        `Magento MCP did not expose expected read tools: ${missingTools.join(", ")}.`,
      );
    }

    const agent = createAgent({
      model: new ChatOpenAI({
        apiKey: environment.OPENAI_API_KEY,
        model: environment.OPENAI_MODEL,
        timeout: modelTimeoutMs,
      }),
      systemPrompt:
        "Use Magento MCP tools before answering questions about the store. This example is " +
        "read-only: never claim that you changed Magento data.",
      tools,
    });
    reportProgress(`Connected. Running the agent with ${tools.length} read-only tools...`);
    const stream = await agent.streamEvents(
      {
        messages: [{ content: prompt, role: "user" }],
      },
      {
        signal: AbortSignal.timeout(runTimeoutMs),
        version: "v3",
      },
    );
    let hasText = false;

    async function writeStreamedText(): Promise<void> {
      for await (const message of stream.messages) {
        for await (const token of message.text) {
          process.stdout.write(token);
          hasText = true;
        }
      }
    }

    async function reportToolProgress(): Promise<void> {
      for await (const call of stream.toolCalls) {
        const toolName = readToolNames.has(call.name) ? call.name : "unknown read tool";
        reportProgress(`Calling ${toolName}...`);
        await call.output;
        reportProgress(`Finished ${toolName}. Waiting for the model response...`);
      }
    }

    await Promise.all([writeStreamedText(), reportToolProgress()]);

    if (!hasText) {
      throw new SafeExampleError("The agent completed without producing a text response.");
    }
    process.stdout.write("\n");
  } finally {
    reportProgress("Closing the MCP connection...");
    await mcpClient.close();
  }
}

await runExample("langchain-mcp", main);
