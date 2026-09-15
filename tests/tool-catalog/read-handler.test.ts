import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AUDIT_TOOL, type AuditInput } from "../../src/core/audit.js";
import type { ToolDependencies } from "../../src/tools/dependencies.js";
import { createReadHandler } from "../../src/tools/shared/read-handler.js";

const OutputSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    data: z.strictObject({ value: z.number().int().positive() }),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.literal("INTERNAL_ERROR"),
      message: z.string().min(1),
      retryable: z.literal(false),
    }),
  }),
]);

type Output = z.infer<typeof OutputSchema>;

it("audits an invalid read success as the normalized internal failure", async () => {
  const audits: AuditInput[] = [];
  const dependencies = {
    audit: {
      write(input: AuditInput) {
        audits.push(input);
        return Promise.resolve();
      },
    },
  } as ToolDependencies;
  const internalFailure = (): Output => ({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "The operation failed safely.", retryable: false },
  });
  const server = new McpServer({ name: "read-handler-test", version: "0.1.0" });
  server.registerTool(
    "test_read",
    {
      inputSchema: z.strictObject({}),
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true },
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.CUSTOMER_SEARCH,
      inputSchema: z.strictObject({}),
      outputSchema: OutputSchema,
      internalFailure,
      failure: internalFailure,
      execute: () => Promise.resolve({ ok: true, data: { value: 0 } } as unknown as Output),
    }),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "read-handler-client", version: "0.1.0" });
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({ name: "test_read", arguments: {} });
    expect(result.structuredContent).toEqual(internalFailure());
    expect(result.isError).toBe(true);
    expect(audits).toEqual([
      expect.objectContaining({ tool: AUDIT_TOOL.CUSTOMER_SEARCH, outcome: "failure" }),
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
