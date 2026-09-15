import { createAuditWriter } from "../../src/core/audit.js";

describe("audit writer", () => {
  it("writes one allowlisted JSON line and sanitizes the request ID", async () => {
    let line = "";
    const audit = createAuditWriter("ignored", {
      now: () => new Date("2026-08-27T12:00:00.000Z"),
      append: (_path, value) => {
        line = value;
        return Promise.resolve();
      },
    });

    await audit.write({
      requestId: "req\n🔑",
      tool: "order_get",
      order_id: 7,
      outcome: "failure",
      duration_ms: 3,
      attempt_count: 2,
    });

    expect(line.endsWith("\n")).toBe(true);
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(record)).toEqual([
      "timestamp",
      "request_id",
      "tool",
      "order_id",
      "outcome",
      "duration_ms",
      "attempt_count",
    ]);
    expect(record).toEqual({
      timestamp: "2026-08-27T12:00:00.000Z",
      request_id: "req___",
      tool: "order_get",
      order_id: 7,
      outcome: "failure",
      duration_ms: 3,
      attempt_count: 2,
    });
    expect(line).not.toContain("secret");
    expect(line).not.toContain("customer");
    expect(line).not.toContain("comment");
  });
});
