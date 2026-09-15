import { AppError } from "../../src/core/errors.js";
import { MagentoClient, type MagentoFetch } from "../../src/magento/client.js";
import { DEFAULT_MAGENTO_MAX_RESPONSE_BYTES } from "../../src/magento/response-size.js";

const ORDER_PATH = ["V1", "orders", "1"] as const;

function client(
  fetchImplementation: MagentoFetch,
  options: { maxResponseBytes?: number; now?: () => number; timeoutMs?: number } = {},
) {
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
    timeoutMs: options.timeoutMs ?? 1000,
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    fetch: fetchImplementation,
    now: options.now ?? (() => 1_700_000_000_000),
    nonce: () => `nonce-${++nonce}`,
  });
}

function stalledJsonResponse(signal: AbortSignal | null | undefined): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
      signal?.addEventListener(
        "abort",
        () => controller.error(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
}

function jsonErrorResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("MagentoClient", () => {
  it("rejects maxResponseBytes above the hard response limit", () => {
    expect(() =>
      client(() => Promise.resolve(new Response("{}")), {
        maxResponseBytes: DEFAULT_MAGENTO_MAX_RESPONSE_BYTES + 1,
      }),
    ).toThrow(`between 1 and ${DEFAULT_MAGENTO_MAX_RESPONSE_BYTES} bytes`);
  });

  it("uses the scoped REST route and OAuth-signs each eligible attempt freshly", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const statuses = [503, 200];
    const fetchImplementation: MagentoFetch = (input, init) => {
      calls.push({ url: String(input), init });
      const status = statuses.shift() ?? 500;
      return Promise.resolve(
        new Response(
          status === 200 ? JSON.stringify({ value: 1, extra: true }) : "sensitive-body",
          {
            status,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    };
    let attempts = 0;
    const result = await client(fetchImplementation).getJson(["V1", "orders", "7"], {
      signal: new AbortController().signal,
      onAttempt: () => {
        attempts += 1;
      },
    });

    expect(result).toEqual({ value: 1, extra: true });
    expect(attempts).toBe(2);
    expect(calls.map((call) => call.url)).toEqual([
      "https://shop.example/rest/default/V1/orders/7",
      "https://shop.example/rest/default/V1/orders/7",
    ]);
    expect(
      calls.every((call) => call.init.method === "GET" && call.init.redirect === "error"),
    ).toBe(true);
    const headers = calls.map((call) => new Headers(call.init.headers).get("Authorization"));
    expect(headers[0]).toContain('oauth_nonce="nonce-1"');
    expect(headers[1]).toContain('oauth_nonce="nonce-2"');
    expect(headers[0]).not.toBe(headers[1]);
  });

  it("retries one transport rejection but caps execution at two attempts", async () => {
    let attempts = 0;
    const fetchImplementation: MagentoFetch = () => {
      attempts += 1;
      return Promise.reject(new Error("network secret"));
    };
    await expect(
      client(fetchImplementation).getJson(ORDER_PATH, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(attempts).toBe(2);
  });

  it.each([400, 404, 500])("does not retry ineligible HTTP %i", async (status) => {
    let attempts = 0;
    const fetchImplementation: MagentoFetch = () => {
      attempts += 1;
      return Promise.resolve(new Response("private", { status }));
    };
    await expect(
      client(fetchImplementation).getJson(ORDER_PATH, {
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(attempts).toBe(1);
  });

  it.each([
    [
      "GET",
      400,
      "UPSTREAM_REJECTED",
      "Magento rejected the requested operation: Invalid product data: Invalid attribute set entity type",
    ],
    [
      "GET",
      404,
      "NOT_FOUND",
      `Magento could not find the requested resource: The CMS page with the "17" ID doesn't exist.`,
    ],
    [
      "POST",
      400,
      "UPSTREAM_REJECTED",
      "Magento rejected the requested operation: A hold action is not available.",
    ],
    [
      "POST",
      404,
      "NOT_FOUND",
      `Magento could not find the requested resource: The order with ID "7" doesn't exist.`,
    ],
  ] as const)(
    "returns normalized Magento detail for %s HTTP %i",
    async (method, status, code, message) => {
      const envelope =
        status === 400 && method === "GET"
          ? {
              message: "Invalid product data: %1",
              parameters: ["Invalid attribute set entity type"],
            }
          : status === 400
            ? { message: "A hold action is not available." }
            : method === "GET"
              ? {
                  message: `The CMS page with the "%1" ID doesn't exist.`,
                  parameters: [17],
                }
              : {
                  message: `The order with ID "%1" doesn't exist.`,
                  parameters: [7],
                };
      const magentoClient = client(() => Promise.resolve(jsonErrorResponse(status, envelope)));
      const request =
        method === "GET"
          ? magentoClient.getJson(ORDER_PATH, { signal: new AbortController().signal })
          : magentoClient.postJson(ORDER_PATH, {}, { signal: new AbortController().signal });

      await expect(request).rejects.toMatchObject({ code, message, retryable: false });
    },
  );

  it.each([
    [400, "UPSTREAM_REJECTED", "Magento rejected the requested operation."],
    [404, "NOT_FOUND", "The requested Magento resource was not found."],
  ] as const)(
    "falls back to the generic mapped error for malformed HTTP %i JSON",
    async (status, code, message) => {
      const html = "<html>private upstream failure</html>";
      await expect(
        client(() =>
          Promise.resolve(new Response(html, { status, headers: { "Content-Type": "text/html" } })),
        ).getJson(ORDER_PATH, { signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code, message });
    },
  );

  it.each([
    [405, "UPSTREAM_INVALID_RESPONSE"],
    [406, "UPSTREAM_INVALID_RESPONSE"],
    [429, "UPSTREAM_UNAVAILABLE"],
  ] as const)("keeps HTTP %i response details hidden", async (status, code) => {
    const upstreamBody = "private upstream detail";
    let caught: unknown;
    try {
      await client(() => Promise.resolve(new Response(upstreamBody, { status }))).postJson(
        ORDER_PATH,
        {},
        { signal: new AbortController().signal },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code });
    expect((caught as Error).message).not.toContain(upstreamBody);
  });

  it("maps malformed successful JSON safely without exposing the response body", async () => {
    const responseBody = "not-json";
    let error: unknown;
    try {
      await client(() => Promise.resolve(new Response(responseBody, { status: 200 }))).getJson(
        ORDER_PATH,
        { signal: new AbortController().signal },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
    expect((error as Error).message).not.toContain(responseBody);
  });

  it("rejects a success body whose declared size exceeds the hard limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"private":"value"}'));
      },
      cancel,
    });

    await expect(
      client(
        () =>
          Promise.resolve(
            new Response(body, {
              status: 200,
              headers: { "Content-Length": "100" },
            }),
          ),
        { maxResponseBytes: 20 },
      ).getJson(ORDER_PATH, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts streamed bytes when Content-Length is missing or inaccurate", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a"'));
        controller.enqueue(new TextEncoder().encode(":1}"));
      },
      cancel,
    });

    await expect(
      client(() => Promise.resolve(new Response(body, { status: 200 })), {
        maxResponseBytes: 6,
      }).getJson(ORDER_PATH, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", retryable: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts valid JSON exactly at the response-size limit", async () => {
    const text = '{"a":1}';
    await expect(
      client(() => Promise.resolve(new Response(text, { status: 200 })), {
        maxResponseBytes: new TextEncoder().encode(text).byteLength,
      }).getJson(ORDER_PATH, { signal: new AbortController().signal }),
    ).resolves.toEqual({ a: 1 });
  });

  it("keeps an oversized successful mutation response outcome unknown", async () => {
    await expect(
      client(
        () =>
          Promise.resolve(
            new Response('{"result":"private"}', {
              status: 200,
              headers: { "Content-Length": "100" },
            }),
          ),
        { maxResponseBytes: 20 },
      ).postJson(ORDER_PATH, {}, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN", retryable: false });
  });

  it("keeps a definite rejection when its oversized error envelope cannot be read", async () => {
    await expect(
      client(
        () =>
          Promise.resolve(
            new Response('{"message":"private detail"}', {
              status: 400,
              headers: { "Content-Length": "100" },
            }),
          ),
        { maxResponseBytes: 20 },
      ).getJson(ORDER_PATH, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
      message: "Magento rejected the requested operation.",
      retryable: false,
    });
  });

  it("does not start a request when the caller signal is already aborted", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    let cancelledAttempts = 0;
    await expect(
      client(() => {
        cancelledAttempts += 1;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }).getJson(ORDER_PATH, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: false });
    expect(cancelledAttempts).toBe(0);
  });

  it("does not retry after the shared deadline is exhausted", async () => {
    const times = [0, 10, 20, 2000];
    let deadlineAttempts = 0;
    await expect(
      client(
        () => {
          deadlineAttempts += 1;
          return Promise.resolve(new Response("temporary", { status: 503 }));
        },
        { now: () => times.shift() ?? 2000 },
      ).getJson(ORDER_PATH, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
    expect(deadlineAttempts).toBe(1);
  });

  it("keeps the original deadline active while consuming a delayed response body", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const request = client(
        (_input, init) => {
          attempts += 1;
          return Promise.resolve(stalledJsonResponse(init.signal));
        },
        { timeoutMs: 20 },
      ).getJson(ORDER_PATH, { signal: new AbortController().signal });
      const expectation = expect(request).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });

      await vi.advanceTimersByTimeAsync(20);
      await expectation;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies caller cancellation after headers as non-retryable unavailability", async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      let attempts = 0;
      const request = client((_input, init) => {
        attempts += 1;
        const response = stalledJsonResponse(init.signal);
        setTimeout(() => caller.abort(), 0);
        return Promise.resolve(response);
      }).getJson(ORDER_PATH, { signal: caller.signal });
      const expectation = expect(request).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        retryable: false,
      });

      await vi.advanceTimersByTimeAsync(0);
      await expectation;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("encodes slash, query, and fragment markers inside path segments", async () => {
    let requestedUrl: string | undefined;
    const result = await client((input) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }).getJson(["V1", "orders", "7/../../?redirect=#private"], {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ ok: true });
    expect(requestedUrl).toBe(
      "https://shop.example/rest/default/V1/orders/7%2F..%2F..%2F%3Fredirect%3D%23private",
    );
  });

  it("encodes GET query parameters and preserves repeated keys", async () => {
    let requestedUrl: URL | undefined;
    let requestedUrlText: string | undefined;
    const query = new URLSearchParams();
    query.append("searchCriteria[filter_groups][0][filters][0][field]", "status");
    query.append("value", "pending");
    query.append("value", "processing");
    query.append("created_at", "2026-03-01 00:00:00");
    query.append("q +", "a +%&=!*'()~");

    await client((input) => {
      requestedUrlText = String(input);
      requestedUrl = new URL(requestedUrlText);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }).getJson(["V1", "orders"], {
      signal: new AbortController().signal,
      query,
    });

    expect(requestedUrl?.pathname).toBe("/rest/default/V1/orders");
    expect(
      requestedUrl?.searchParams.get("searchCriteria[filter_groups][0][filters][0][field]"),
    ).toBe("status");
    expect(requestedUrl?.searchParams.getAll("value")).toEqual(["pending", "processing"]);
    expect(requestedUrl?.searchParams.get("created_at")).toBe("2026-03-01 00:00:00");
    expect(requestedUrl?.searchParams.get("q +")).toBe("a +%&=!*'()~");
    expect(requestedUrlText).toContain("created_at=2026-03-01%2000%3A00%3A00");
    expect(requestedUrlText).toContain("q%20%2B=a%20%2B%25%26%3D!*%27()~");
  });

  it("sends one JSON POST with a fresh signature and never retries it", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const magentoClient = client((input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        new Response(JSON.stringify(true), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    let attempts = 0;
    const body = { statusHistory: { comment: "Internal note" } };

    await expect(
      magentoClient.postJson(["V1", "orders", "7", "comments"], body, {
        signal: new AbortController().signal,
        onAttempt: () => {
          attempts += 1;
        },
      }),
    ).resolves.toBe(true);

    expect(attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://shop.example/rest/default/V1/orders/7/comments");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify(body),
      redirect: "error",
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toContain('oauth_nonce="nonce-1"');
  });

  it("sends one JSON PUT through the same non-retried mutation policy", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const body = { product: { sku: "SKU-1", price: 12.5 } };
    const result = await client((input, init) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ sku: "SKU-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }).putJson(["V1", "products", "SKU-1"], body, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ sku: "SKU-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://shop.example/rest/default/V1/products/SKU-1");
    expect(calls[0]?.init).toMatchObject({
      method: "PUT",
      body: JSON.stringify(body),
      redirect: "error",
    });
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toContain(
      'oauth_nonce="nonce-1"',
    );
  });

  it.each([500, 502, 503, 504])(
    "classifies POST HTTP %i as unknown and makes one attempt",
    async (status) => {
      let attempts = 0;
      let caught: unknown;
      try {
        await client(() => {
          attempts += 1;
          return Promise.resolve(new Response("private server detail", { status }));
        }).postJson(ORDER_PATH, {}, { signal: new AbortController().signal });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN", retryable: false });
      expect((caught as Error).message).not.toContain("private server detail");
      expect(attempts).toBe(1);
    },
  );

  it("distinguishes definite POST rejection from an ambiguous transport failure", async () => {
    await expect(
      client(() => Promise.resolve(new Response("private", { status: 400 }))).postJson(
        ORDER_PATH,
        {},
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });

    let attempts = 0;
    await expect(
      client(() => {
        attempts += 1;
        return Promise.reject(new Error("network secret"));
      }).postJson(ORDER_PATH, {}, { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "UPSTREAM_OUTCOME_UNKNOWN" });
    expect(attempts).toBe(1);
  });
});
