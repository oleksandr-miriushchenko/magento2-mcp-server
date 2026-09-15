import { randomBytes } from "node:crypto";

import { AppError, createAppError, ERROR_CODE } from "../core/errors.js";
import { extractMagentoErrorMessage } from "./error-response.js";
import { createOAuthAuthorizationHeader, type OAuthCredentials } from "./oauth.js";
import { DEFAULT_MAGENTO_MAX_RESPONSE_BYTES } from "./response-size.js";

export type MagentoFetch = (input: string | URL, init: RequestInit) => Promise<Response>;

export interface MagentoClientOptions {
  readonly baseUrl: string;
  readonly storeScope: string;
  readonly oauth: OAuthCredentials;
  readonly timeoutMs: number;
  readonly maxResponseBytes?: number;
  readonly fetch?: MagentoFetch;
  readonly now?: () => number;
  readonly nonce?: () => string;
}

export interface MagentoGetOptions {
  readonly signal: AbortSignal;
  readonly onAttempt?: () => void;
  readonly query?: URLSearchParams;
}

export interface MagentoPostOptions {
  readonly signal: AbortSignal;
  readonly onAttempt?: () => void;
}

export type MagentoPutOptions = MagentoPostOptions;

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
} as const;

type MagentoMutationMethod = typeof HTTP_METHOD.POST | typeof HTTP_METHOD.PUT;
type MessageBearingErrorCode = typeof ERROR_CODE.NOT_FOUND | typeof ERROR_CODE.UPSTREAM_REJECTED;

class ResponseBodyTooLargeError extends Error {}

const MAGENTO_ERROR_PREFIX: Readonly<Record<MessageBearingErrorCode, string>> = {
  [ERROR_CODE.NOT_FOUND]: "Magento could not find the requested resource",
  [ERROR_CODE.UPSTREAM_REJECTED]: "Magento rejected the requested operation",
};

function defaultNonce(): string {
  return randomBytes(18).toString("base64url");
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

async function cancelResponseBody(response: Response, signal: AbortSignal): Promise<void> {
  const body = response.body;
  if (body === null) return;

  let cancellation: Promise<void>;
  try {
    cancellation = body.cancel().catch(() => undefined);
  } catch {
    return;
  }
  if (signal.aborted) return;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    onAbort = resolve;
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([cancellation, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

async function createMagentoResponseError(
  response: Response,
  code: MessageBearingErrorCode,
  maxResponseBytes: number,
): Promise<AppError> {
  let detail: string | undefined;
  try {
    detail = extractMagentoErrorMessage(await readResponseJson(response, maxResponseBytes));
  } catch {
    return createAppError(code);
  }
  if (detail === undefined) return createAppError(code);
  return new AppError(code, `${MAGENTO_ERROR_PREFIX[code]}: ${detail}`);
}

function declaredResponseIsTooLarge(response: Response, maxResponseBytes: number): boolean {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return false;

  const contentLength = Number(value);
  return !Number.isSafeInteger(contentLength) || contentLength > maxResponseBytes;
}

function cancelBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // The response is already being discarded; cancellation failures are not caller-visible.
  }
}

async function readResponseJson(response: Response, maxResponseBytes: number): Promise<unknown> {
  const body = response.body;
  if (body === null) return JSON.parse("") as unknown;

  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  if (declaredResponseIsTooLarge(response, maxResponseBytes)) {
    cancelBodyReader(reader);
    throw new ResponseBodyTooLargeError();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;

    totalBytes += result.value.byteLength;
    if (totalBytes > maxResponseBytes) {
      cancelBodyReader(reader);
      throw new ResponseBodyTooLargeError();
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export class MagentoClient {
  readonly #baseUrl: string;
  readonly #storeScope: string;
  readonly #oauth: OAuthCredentials;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: MagentoFetch;
  readonly #now: () => number;
  readonly #nonce: () => string;

  constructor(options: MagentoClientOptions) {
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAGENTO_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 1 ||
      maxResponseBytes > DEFAULT_MAGENTO_MAX_RESPONSE_BYTES
    ) {
      throw new RangeError(
        `Maximum Magento response size must be between 1 and ${DEFAULT_MAGENTO_MAX_RESPONSE_BYTES} bytes.`,
      );
    }
    this.#baseUrl = options.baseUrl;
    this.#storeScope = options.storeScope;
    this.#oauth = options.oauth;
    this.#timeoutMs = options.timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#nonce = options.nonce ?? defaultNonce;
  }

  async getJson(
    pathSegments: readonly [string, ...string[]],
    options: MagentoGetOptions,
  ): Promise<unknown> {
    const url = this.#restUrl(pathSegments, options.query);
    const deadline = this.#now() + this.#timeoutMs;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
      const remainingMs = deadline - this.#now();
      if (remainingMs <= 0) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);

      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), remainingMs);
      const signal = AbortSignal.any([options.signal, timeoutController.signal]);
      const authorization = createOAuthAuthorizationHeader({
        method: HTTP_METHOD.GET,
        url,
        credentials: this.#oauth,
        nonce: this.#nonce(),
        timestamp: Math.floor(this.#now() / 1000),
      });
      options.onAttempt?.();

      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: HTTP_METHOD.GET,
          headers: { Accept: "application/json", Authorization: authorization },
          redirect: "error",
          signal,
        });
      } catch {
        clearTimeout(timer);
        if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
        if (attempt === 1 && deadline - this.#now() > 0) continue;
        throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
      }

      if (!response.ok) {
        if (response.status === 400 || response.status === 404) {
          const code: MessageBearingErrorCode =
            response.status === 400 ? ERROR_CODE.UPSTREAM_REJECTED : ERROR_CODE.NOT_FOUND;
          const error = await createMagentoResponseError(response, code, this.#maxResponseBytes);
          clearTimeout(timer);
          throw error;
        }
        await cancelResponseBody(response, signal);
        clearTimeout(timer);
        if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
        if (timeoutController.signal.aborted || deadline - this.#now() <= 0) {
          throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
        }
        if (
          attempt === 1 &&
          RETRYABLE_STATUSES.has(response.status) &&
          deadline - this.#now() > 0
        ) {
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          throw createAppError(ERROR_CODE.FORBIDDEN);
        }
        if (response.status === 405 || response.status === 406) {
          throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
        }
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
        }
        throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
      }

      let json: unknown;
      try {
        json = await readResponseJson(response, this.#maxResponseBytes);
      } catch (error) {
        if (error instanceof ResponseBodyTooLargeError) {
          throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
        }
        if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
        if (timeoutController.signal.aborted || deadline - this.#now() <= 0) {
          throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
        }
        throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
      } finally {
        clearTimeout(timer);
      }
      if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
      if (timeoutController.signal.aborted || deadline - this.#now() <= 0) {
        throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
      }
      return json;
    }

    throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE, true);
  }

  async postJson(
    pathSegments: readonly [string, ...string[]],
    body: unknown,
    options: MagentoPostOptions,
  ): Promise<unknown> {
    return this.#mutateJson(HTTP_METHOD.POST, pathSegments, body, options);
  }

  async putJson(
    pathSegments: readonly [string, ...string[]],
    body: unknown,
    options: MagentoPutOptions,
  ): Promise<unknown> {
    return this.#mutateJson(HTTP_METHOD.PUT, pathSegments, body, options);
  }

  async #mutateJson(
    method: MagentoMutationMethod,
    pathSegments: readonly [string, ...string[]],
    body: unknown,
    options: MagentoPostOptions,
  ): Promise<unknown> {
    if (isAborted(options.signal)) throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);

    const url = this.#restUrl(pathSegments);
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.#timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutController.signal]);
    const authorization = createOAuthAuthorizationHeader({
      method,
      url,
      credentials: this.#oauth,
      nonce: this.#nonce(),
      timestamp: Math.floor(this.#now() / 1000),
    });
    options.onAttempt?.();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch {
      clearTimeout(timer);
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }

    if (!response.ok) {
      if (response.status === 400 || response.status === 404) {
        const code: MessageBearingErrorCode =
          response.status === 400 ? ERROR_CODE.UPSTREAM_REJECTED : ERROR_CODE.NOT_FOUND;
        const error = await createMagentoResponseError(response, code, this.#maxResponseBytes);
        clearTimeout(timer);
        throw error;
      }
      await cancelResponseBody(response, signal);
      clearTimeout(timer);
      if (response.status === 401 || response.status === 403) {
        throw createAppError(ERROR_CODE.FORBIDDEN);
      }
      if (response.status === 405 || response.status === 406) {
        throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
      }
      if (response.status === 429) {
        throw createAppError(ERROR_CODE.UPSTREAM_UNAVAILABLE);
      }
      if (response.status >= 400 && response.status < 500) {
        throw createAppError(ERROR_CODE.UPSTREAM_REJECTED);
      }
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }

    let json: unknown;
    try {
      json = await readResponseJson(response, this.#maxResponseBytes);
    } catch {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    } finally {
      clearTimeout(timer);
    }
    if (isAborted(options.signal) || timeoutController.signal.aborted) {
      throw createAppError(ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN);
    }
    return json;
  }

  #restUrl(pathSegments: readonly [string, ...string[]], query?: URLSearchParams): URL {
    const endpoint = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
    const path = `/rest/${encodeURIComponent(this.#storeScope)}/${endpoint}`;
    const url = new URL(path, this.#baseUrl);
    if (query !== undefined) {
      url.search = Array.from(
        query,
        ([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value),
      ).join("&");
    }
    return url;
  }
}
