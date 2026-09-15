import type { CallToolResult } from "@modelcontextprotocol/server";

type ToolOutput = Record<string, unknown> & { readonly ok: boolean };

/** Packages an output that has already passed its public tool schema. */
export function packToolResult(output: ToolOutput): CallToolResult {
  return {
    structuredContent: output,
    content: [{ type: "text", text: JSON.stringify(output) }],
    ...(output.ok ? {} : { isError: true }),
  };
}
