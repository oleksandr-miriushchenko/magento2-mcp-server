import { type AppError } from "../../src/core/errors.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";

const ORDER_PATH = ["V1", "orders", "1"] as const;

function client(fetchImplementation: MagentoFetch, timeoutMs = 1000): MagentoClient {
  let nonce = 0;
  return new MagentoClient({
    baseUrl: "https://shop.example/",
    storeScope: "default",
    oauth: {
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    },
    timeoutMs,
    fetch: fetchImplementation,
    nonce: () => `nonce-${++nonce}`,
  });
}

function errorResponse(status: number, stallCancellation = false) {
  const cancel = vi.fn(() => {
    if (!stallCancellation) return undefined;
    return new Promise<void>(() => {
      // Intentionally unresolved to exercise deadline-bounded cleanup.
    });
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("private-magento-body"));
    },
    cancel,
  });
  const response = new Response(body, { status });
  return {
    cancel,
    json: vi.spyOn(response, "json"),
    response,
    text: vi.spyOn(response, "text"),
  };
}

function expectErrorBodyWasNotRead(probe: ReturnType<typeof errorResponse>): void {
  expect(probe.cancel).toHaveBeenCalledOnce();
  expect(probe.text).not.toHaveBeenCalled();
  expect(probe.json).not.toHaveBeenCalled();
}

describe("MagentoClient non-success response cleanup", () => {
  it("cancels a 403 body before throwing the safe mapped error", async () => {
    const probe = errorResponse(403);
    let caught: unknown;
    try {
      await client(() => Promise.resolve(probe.response)).getJson(ORDER_PATH, {
        signal: new AbortController().signal,
      });
    } catch (error) {
      expectErrorBodyWasNotRead(probe);
      caught = error;
    }

    expect(caught).toMatchObject({ code: "FORBIDDEN", retryable: false });
    expect((caught as AppError).message).not.toContain("private-magento-body");
  });

  it("does not read a mutation 500 body and does not retry", async () => {
    const probe = errorResponse(500);
    let attempts = 0;
    let caught: unknown;
    try {
      await client(() => {
        attempts += 1;
        return Promise.resolve(probe.response);
      }).postJson(ORDER_PATH, {}, { signal: new AbortController().signal });
    } catch (error) {
      caught = error;
    }

    expect(attempts).toBe(1);
    expectErrorBodyWasNotRead(probe);
    expect(caught).toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN", retryable: false });
    expect((caught as AppError).message).not.toContain("private-magento-body");
  });

  it("cancels a first 503 body before starting the successful retry", async () => {
    const probe = errorResponse(503);
    let attempts = 0;
    const fetchImplementation: MagentoFetch = () => {
      attempts += 1;
      if (attempts === 1) return Promise.resolve(probe.response);
      expectErrorBodyWasNotRead(probe);
      return Promise.resolve(
        new Response(JSON.stringify({ value: 7 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };

    await expect(
      client(fetchImplementation).getJson(ORDER_PATH, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ value: 7 });
    expect(attempts).toBe(2);
    expectErrorBodyWasNotRead(probe);
  });

  it("cancels both bodies in a terminal 503 sequence", async () => {
    const probes = [errorResponse(503), errorResponse(503)];
    let attempts = 0;
    const fetchImplementation: MagentoFetch = () => {
      const probe = probes[attempts];
      attempts += 1;
      if (probe === undefined) throw new Error("unexpected extra attempt");
      return Promise.resolve(probe.response);
    };

    let caught: unknown;
    try {
      await client(fetchImplementation).getJson(ORDER_PATH, {
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(attempts).toBe(2);
    for (const probe of probes) expectErrorBodyWasNotRead(probe);
    expect(caught).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect((caught as AppError).message).not.toContain("private-magento-body");
  });

  it("bounds stalled cancellation by the shared deadline without another attempt", async () => {
    vi.useFakeTimers();
    try {
      const probe = errorResponse(503, true);
      let attempts = 0;
      const request = client(() => {
        attempts += 1;
        return Promise.resolve(probe.response);
      }, 20).getJson(ORDER_PATH, { signal: new AbortController().signal });
      const expectation = expect(request).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expectation;
      expect(attempts).toBe(1);
      expectErrorBodyWasNotRead(probe);
    } finally {
      vi.useRealTimers();
    }
  });
});
