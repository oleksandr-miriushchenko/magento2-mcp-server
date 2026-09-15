import { packToolResult } from "../../src/tools/shared/tool-result.js";

describe("packToolResult", () => {
  it("mirrors a success as structured and text content", () => {
    const output = { ok: true, data: { value: "ready" } };

    expect(packToolResult(output)).toEqual({
      structuredContent: output,
      content: [{ type: "text", text: JSON.stringify(output) }],
    });
  });

  it("marks an application failure as an MCP error", () => {
    const output = {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Internal error", retryable: false },
    };

    expect(packToolResult(output)).toEqual({
      structuredContent: output,
      content: [{ type: "text", text: JSON.stringify(output) }],
      isError: true,
    });
  });
});
