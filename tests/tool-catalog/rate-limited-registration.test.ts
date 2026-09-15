import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  createRateLimitedRegisterTool,
  createToolCallLimiter,
  TOOL_CALL_RATE_LIMIT_MESSAGE,
} from "../../src/tools/rate-limited-registration.js";
import { COMMON_ERROR_CODE } from "../../src/tools/shared/error-codes.js";
import { createToolResultSchemas } from "../../src/tools/shared/result-schemas.js";
import { packToolResult } from "../../src/tools/shared/tool-result.js";

const OutputSchema = createToolResultSchemas(
  z.strictObject({ value: z.string() }),
  z.enum(COMMON_ERROR_CODE),
).output;

describe("MCP tool rate limiting", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("admits 10 calls, rejects the next call, and refills after one second", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const limiter = createToolCallLimiter();

    for (let call = 0; call < 10; call += 1) {
      expect(limiter.tryAcquire()).toBe(true);
      limiter.release();
    }
    expect(limiter.tryAcquire()).toBe(false);

    now = 1_000;
    expect(limiter.tryAcquire()).toBe(true);
    limiter.release();
  });

  it("rejects an eleventh in-flight call even after the rate bucket refills", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const limiter = createToolCallLimiter();

    for (let call = 0; call < 10; call += 1) {
      expect(limiter.tryAcquire()).toBe(true);
    }

    now = 1_000;
    expect(limiter.tryAcquire()).toBe(false);

    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it.each([
    ["a synchronous callback throw", "sync"],
    ["a rejected callback promise", "async"],
  ] as const)("releases admission exactly once after %s", async (_scenario, mode) => {
    const failure = new Error(`${mode} handler failure`);
    const server = new McpServer({ name: `${mode}-failure-test-server`, version: "0.1.0" });
    const sdkRegisterTool = vi.spyOn(server, "registerTool");
    const limiter = {
      tryAcquire: vi.fn().mockReturnValue(true),
      release: vi.fn(),
    };
    const registerTool = createRateLimitedRegisterTool(server, limiter);
    registerTool(
      `${mode}_failure_test`,
      {
        inputSchema: z.strictObject({}),
        outputSchema: OutputSchema,
      },
      () => {
        if (mode === "sync") throw failure;
        return Promise.reject(failure);
      },
    );
    const wrappedCallback = sdkRegisterTool.mock.calls[0]?.[2];
    if (wrappedCallback === undefined) throw new Error("Expected a registered callback.");

    await expect((wrappedCallback as unknown as () => Promise<unknown>)()).rejects.toBe(failure);
    expect(limiter.tryAcquire).toHaveBeenCalledOnce();
    expect(limiter.release).toHaveBeenCalledOnce();
  });

  it("rejects before the tool handler and returns a schema-valid mirrored failure", async () => {
    const limiter = {
      tryAcquire: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
      release: vi.fn(),
    };
    const handler = vi.fn((input: { value: string }, context: ServerContext) => {
      expect(context.mcpReq.method).toBe("tools/call");
      const output = { ok: true as const, data: { value: input.value } };
      return packToolResult(output);
    });
    const server = new McpServer({ name: "rate-limit-test-server", version: "0.1.0" });
    const registerTool = createRateLimitedRegisterTool(server, limiter);
    registerTool(
      "rate_limit_test",
      {
        inputSchema: z.strictObject({ value: z.string() }),
        outputSchema: OutputSchema,
      },
      handler,
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "rate-limit-test-client", version: "0.1.0" });
    await client.connect(clientTransport);

    try {
      await client.listTools();
      expect(limiter.tryAcquire).not.toHaveBeenCalled();

      const accepted = await client.callTool({
        name: "rate_limit_test",
        arguments: { value: "handled" },
      });
      expect(accepted.structuredContent).toEqual({ ok: true, data: { value: "handled" } });

      const rejected = await client.callTool({
        name: "rate_limit_test",
        arguments: { value: "rejected" },
      });
      const parsed = OutputSchema.safeParse(rejected.structuredContent);
      expect(parsed.success).toBe(true);
      expect(rejected.structuredContent).toEqual({
        ok: false,
        error: {
          code: COMMON_ERROR_CODE.RATE_LIMITED,
          message: TOOL_CALL_RATE_LIMIT_MESSAGE,
          retryable: true,
        },
      });
      expect(rejected).toMatchObject({ isError: true });
      expect(rejected.content).toEqual([
        { type: "text", text: JSON.stringify(rejected.structuredContent) },
      ]);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toEqual({ value: "handled" });
      expect(limiter.tryAcquire).toHaveBeenCalledTimes(2);
      expect(limiter.release).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
