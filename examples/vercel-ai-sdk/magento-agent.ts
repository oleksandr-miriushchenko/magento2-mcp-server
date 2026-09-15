import { createMCPClient } from "@ai-sdk/mcp";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

import { MAGENTO_READ_TOOL_NAMES, MCP_ENVIRONMENT_FIELDS } from "../shared/magento-mcp.js";
import { runExample, SafeExampleError } from "../shared/example-runtime.js";

const environmentSchema = z.object({
  MCP_HTTP_URL: MCP_ENVIRONMENT_FIELDS.MCP_HTTP_URL,
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-astra"),
});
type Environment = z.infer<typeof environmentSchema>;

const readToolNames = new Set<string>(MAGENTO_READ_TOOL_NAMES);

function parseEnvironment(): Environment {
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    throw new SafeExampleError("Set OPENAI_API_KEY and verify MCP_HTTP_URL and OPENAI_MODEL.");
  }
  return result.data;
}

async function main(): Promise<void> {
  const environment = parseEnvironment();
  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Show the store hierarchy and summarize its websites, stores, and store views.";
  const openai = createOpenAI({ apiKey: environment.OPENAI_API_KEY });
  const mcpClient = await createMCPClient({
    transport: {
      type: "http",
      url: environment.MCP_HTTP_URL,
    },
  });

  try {
    const discoveredTools = await mcpClient.tools();
    const tools = Object.fromEntries(
      Object.entries(discoveredTools).filter(([name]) => readToolNames.has(name)),
    );
    const missingTools = MAGENTO_READ_TOOL_NAMES.filter((name) => !(name in tools));

    if (missingTools.length > 0) {
      throw new SafeExampleError(
        `Magento MCP did not expose expected read tools: ${missingTools.join(", ")}.`,
      );
    }

    const result = await generateText({
      experimental_telemetry: { isEnabled: false },
      model: openai(environment.OPENAI_MODEL),
      prompt,
      stopWhen: stepCountIs(8),
      system:
        "Use Magento MCP tools before answering questions about the store. This example is " +
        "read-only: never claim that you changed Magento data.",
      tools,
    });

    console.log(result.text);
  } finally {
    await mcpClient.close();
  }
}

await runExample("vercel-ai", main);
