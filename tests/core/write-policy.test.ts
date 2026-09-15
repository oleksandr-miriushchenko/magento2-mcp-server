import { createHmac } from "node:crypto";

import type { ServerContext } from "@modelcontextprotocol/server";

import { canonicalDigest } from "../../src/core/canonical-json.js";
import { AppError, PolicyError } from "../../src/core/errors.js";
import { InMemoryIdempotencyStore } from "../../src/core/idempotency.js";
import { createWriteApprovalPolicy } from "../../src/core/write-approval.js";

function context(
  options: {
    state?: unknown;
    action?: "accept" | "decline" | "cancel";
    content?: unknown;
    method?: string;
  } = {},
): ServerContext {
  return {
    mcpReq: {
      id: "request",
      method: options.method ?? "tools/call",
      signal: new AbortController().signal,
      requestState: () => options.state,
      ...(options.action === undefined
        ? {}
        : {
            inputResponses: {
              approval: {
                action: options.action,
                content: "content" in options ? options.content : { confirm: true },
              },
            },
          }),
    },
  } as unknown as ServerContext;
}

describe("native write approval", () => {
  const key = new Uint8Array(32).fill(4);

  it("requests native input first and accepts only an intact accept re-entry", async () => {
    const policy = createWriteApprovalPolicy(key);
    const first = await policy.requireApproval(
      "order_cancel",
      { a: 1, b: 2 },
      "Approve cancellation?",
      context(),
    );
    expect(first).toMatchObject({ resultType: "input_required" });
    expect("requestState" in first && typeof first.requestState).toBe("string");
    expect("inputRequests" in first && first.inputRequests).toHaveProperty("approval");
    expect(first).toMatchObject({
      inputRequests: {
        approval: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "Approve cancellation?",
            requestedSchema: {
              type: "object",
              properties: { confirm: { type: "boolean", title: "Confirm operation" } },
              required: ["confirm"],
            },
          },
        },
      },
    });
    if (!("requestState" in first)) {
      throw new Error("missing protected state");
    }

    const verified = await policy.verify(first.requestState, context());
    const accepted = await policy.requireApproval(
      "order_cancel",
      { b: 2, a: 1 },
      "Approve cancellation?",
      context({ state: verified, action: "accept" }),
    );
    expect(accepted).toEqual({ approved: true });
    expect(verified).toEqual({
      tool: "order_cancel",
      argument_digest: canonicalDigest({ a: 1, b: 2 }),
    });
  });

  it.each(["decline", "cancel"] as const)("rejects native %s", async (action) => {
    const policy = createWriteApprovalPolicy(key);
    const first = await policy.requireApproval("write", { id: 1 }, "Approve write?", context());
    if (!("requestState" in first)) throw new Error("no state");
    const verified = await policy.verify(first.requestState, context());
    await expect(
      policy.requireApproval(
        "write",
        { id: 1 },
        "Approve write?",
        context({ state: verified, action }),
      ),
    ).rejects.toThrow("declined");
  });

  it.each([
    undefined,
    {},
    { confirm: false },
    { confirm: "true" },
    { confirm: 1 },
    { confirm: null },
  ])("rejects accept without explicit boolean confirmation: %j", async (content) => {
    const policy = createWriteApprovalPolicy(key);
    const first = await policy.requireApproval("write", { id: 1 }, "Approve write?", context());
    if (!("requestState" in first)) throw new Error("no state");
    const verified = await policy.verify(first.requestState, context());

    await expect(
      policy.requireApproval(
        "write",
        { id: 1 },
        "Approve write?",
        context({ state: verified, action: "accept", content }),
      ),
    ).rejects.toThrow("declined");
  });

  it("rejects an accept response that arrives without protected request state", async () => {
    const policy = createWriteApprovalPolicy(key);
    await expect(
      policy.requireApproval("write", { id: 1 }, "Approve write?", context({ action: "accept" })),
    ).rejects.toThrow("invalid or expired");
  });

  it("rejects altered arguments, missing response, tampering, binding changes, and expiry", async () => {
    const policy = createWriteApprovalPolicy(key);
    const first = await policy.requireApproval("write", { id: 1 }, "Approve write?", context());
    if (!("requestState" in first)) throw new Error("no state");
    const verified = await policy.verify(first.requestState, context());
    await expect(
      policy.requireApproval(
        "write",
        { id: 2 },
        "Approve write?",
        context({ state: verified, action: "accept" }),
      ),
    ).rejects.toThrow("invalid or expired");
    await expect(
      policy.requireApproval("write", { id: 1 }, "Approve write?", context({ state: verified })),
    ).rejects.toThrow("missing or invalid");
    await expect(policy.verify(`${first.requestState}x`, context())).rejects.toThrow();
    await expect(
      policy.verify(first.requestState, context({ method: "prompts/get" })),
    ).rejects.toThrow();

    const body = Buffer.from(JSON.stringify({ p: {}, exp: 0 }), "utf8").toString("base64url");
    const mac = createHmac("sha256", key).update(`v1.${body}`).digest("base64url");
    await expect(policy.verify(`v1.${body}.${mac}`, context())).rejects.toThrow("expired");
  });

  it("requires an independent exact 32-byte key", () => {
    expect(() => createWriteApprovalPolicy(new Uint8Array(31))).toThrow(RangeError);
    expect(() => createWriteApprovalPolicy(new Uint8Array(33))).toThrow(RangeError);
  });

  it("keeps approval failures outside the public application error contract", async () => {
    const policy = createWriteApprovalPolicy(key);
    const first = await policy.requireApproval("write", { id: 1 }, "Approve write?", context());
    if (!("requestState" in first)) throw new Error("no state");
    const verified = await policy.verify(first.requestState, context());

    let error: unknown;
    try {
      await policy.requireApproval(
        "write",
        { id: 1 },
        "Approve write?",
        context({ state: verified, action: "decline" }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PolicyError);
    expect(error).not.toBeInstanceOf(AppError);
    expect(error).not.toHaveProperty("code");
  });
});

describe("idempotency policy", () => {
  it("looks up completed replays without creating a reservation", () => {
    const store = new InMemoryIdempotencyStore<{ ok: true }>(() => 0);
    expect(store.lookup("write", "key", "fingerprint")).toEqual({ status: "absent" });
    const reservation = store.reserve("write", "key", "fingerprint");
    if (reservation.status !== "reserved") throw new Error("unexpected replay");
    expect(() => store.lookup("write", "key", "fingerprint")).toThrow(
      "ongoing or unresolved operation",
    );
    store.complete("write", "key", "fingerprint", reservation.token, { ok: true });
    expect(store.lookup("write", "key", "fingerprint")).toEqual({
      status: "replay",
      result: { ok: true },
    });
    expect(() => store.lookup("write", "key", "different")).toThrow("another request");
  });

  it("replays exact completed results as clones and rejects conflicts and pending reuse", () => {
    const store = new InMemoryIdempotencyStore<{ nested: { value: number } }>(() => 0);
    const reservation = store.reserve("write", "key", "fingerprint");
    expect(reservation.status).toBe("reserved");
    expect(() => store.reserve("write", "key", "fingerprint")).toThrow(PolicyError);
    expect(() => store.reserve("write", "key", "other")).toThrow(PolicyError);
    if (reservation.status !== "reserved") throw new Error("unexpected replay");
    store.complete("write", "key", "fingerprint", reservation.token, { nested: { value: 1 } });
    const replay = store.reserve("write", "key", "fingerprint");
    expect(replay).toEqual({ status: "replay", result: { nested: { value: 1 } } });
    if (replay.status === "replay") replay.result.nested.value = 9;
    expect(store.reserve("write", "key", "fingerprint")).toEqual({
      status: "replay",
      result: { nested: { value: 1 } },
    });
  });

  it("releases only a matching pending reservation and expires after 24 hours", () => {
    let now = 0;
    const store = new InMemoryIdempotencyStore<{ ok: true }>(() => now);
    const reservation = store.reserve("write", "key", "fingerprint");
    if (reservation.status !== "reserved") throw new Error("unexpected replay");
    store.release("write", "key", "other", reservation.token);
    expect(() => store.reserve("write", "key", "fingerprint")).toThrow(
      "ongoing or unresolved operation",
    );
    store.release("write", "key", "fingerprint", reservation.token);
    const second = store.reserve("write", "key", "fingerprint");
    if (second.status !== "reserved") throw new Error("unexpected replay");
    store.complete("write", "key", "fingerprint", second.token, { ok: true });
    now = 24 * 60 * 60 * 1000;
    expect(store.reserve("write", "key", "fingerprint").status).toBe("reserved");
  });

  it("evicts the oldest completed entry at capacity and refuses all-pending capacity", () => {
    let now = 0;
    const completed = new InMemoryIdempotencyStore<{ id: number }>(() => now);
    for (let index = 0; index < 1000; index += 1) {
      const reservation = completed.reserve("write", String(index), "same");
      if (reservation.status !== "reserved") throw new Error("unexpected replay");
      completed.complete("write", String(index), "same", reservation.token, { id: index });
      now += 1;
    }
    expect(completed.reserve("write", "new", "same").status).toBe("reserved");
    expect(completed.reserve("write", "0", "same").status).toBe("reserved");

    const pending = new InMemoryIdempotencyStore<never>(() => 0);
    for (let index = 0; index < 1000; index += 1) {
      expect(pending.reserve("write", String(index), "same").status).toBe("reserved");
    }
    expect(() => pending.reserve("write", "overflow", "same")).toThrow("capacity");
  });
});
