import { resolve } from "node:path";

import { z } from "zod";

import { DEFAULT_MAGENTO_MAX_RESPONSE_BYTES } from "../magento/response-size.js";

const canonicalInteger = (minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === "/"
    );
  } catch {
    return false;
  }
}

const credential = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 31 || code === 127;
      }),
  );

const ConfigInputSchema = z
  .strictObject({
    MAGENTO_BASE_URL: z.string().refine(isHttpsOrigin),
    MAGENTO_STORE_SCOPE: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]{0,63}$/),
    MAGENTO_OAUTH_CONSUMER_KEY: credential,
    MAGENTO_OAUTH_CONSUMER_SECRET: credential,
    MAGENTO_OAUTH_ACCESS_TOKEN: credential,
    MAGENTO_OAUTH_ACCESS_TOKEN_SECRET: credential,
    MAGENTO_REQUEST_TIMEOUT_MS: canonicalInteger(100, 120_000),
    MAGENTO_MAX_RESPONSE_BYTES: canonicalInteger(1, DEFAULT_MAGENTO_MAX_RESPONSE_BYTES).default(
      DEFAULT_MAGENTO_MAX_RESPONSE_BYTES,
    ),
    MCP_MAX_PAGE_SIZE: canonicalInteger(1, 1000).default(25),
    MCP_AUDIT_FILE: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) =>
          !Array.from(value).some((character) =>
            [0, 10, 13].includes(character.codePointAt(0) ?? 0),
          ),
      ),
  })
  .transform((value) => ({
    baseUrl: new URL(value.MAGENTO_BASE_URL).origin + "/",
    storeScope: value.MAGENTO_STORE_SCOPE,
    oauth: {
      consumerKey: value.MAGENTO_OAUTH_CONSUMER_KEY,
      consumerSecret: value.MAGENTO_OAUTH_CONSUMER_SECRET,
      accessToken: value.MAGENTO_OAUTH_ACCESS_TOKEN,
      accessTokenSecret: value.MAGENTO_OAUTH_ACCESS_TOKEN_SECRET,
    },
    requestTimeoutMs: value.MAGENTO_REQUEST_TIMEOUT_MS,
    maxResponseBytes: value.MAGENTO_MAX_RESPONSE_BYTES,
    maxPageSize: value.MCP_MAX_PAGE_SIZE,
    auditFile: resolve(value.MCP_AUDIT_FILE),
  }));

export type ServerConfig = z.infer<typeof ConfigInputSchema>;

const HttpConfigInputSchema = z
  .strictObject({
    MCP_HTTP_PORT: canonicalInteger(1, 65_535).default(3000),
  })
  .transform((value) => ({ port: value.MCP_HTTP_PORT }));

export type HttpConfig = z.infer<typeof HttpConfigInputSchema>;

export class ConfigurationError extends Error {
  constructor(setting: string) {
    super(`Invalid server configuration: ${setting}.`);
    this.name = "ConfigurationError";
  }
}

const SETTINGS = [
  "MAGENTO_BASE_URL",
  "MAGENTO_STORE_SCOPE",
  "MAGENTO_OAUTH_CONSUMER_KEY",
  "MAGENTO_OAUTH_CONSUMER_SECRET",
  "MAGENTO_OAUTH_ACCESS_TOKEN",
  "MAGENTO_OAUTH_ACCESS_TOKEN_SECRET",
  "MAGENTO_REQUEST_TIMEOUT_MS",
  "MAGENTO_MAX_RESPONSE_BYTES",
  "MCP_MAX_PAGE_SIZE",
  "MCP_AUDIT_FILE",
] as const;

export function parseConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const input = Object.fromEntries(SETTINGS.map((setting) => [setting, environment[setting]]));
  if (environment.MAGENTO_MAX_RESPONSE_BYTES === undefined) {
    delete input.MAGENTO_MAX_RESPONSE_BYTES;
  }
  if (environment.MCP_MAX_PAGE_SIZE === undefined) delete input.MCP_MAX_PAGE_SIZE;

  const parsed = ConfigInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  const firstPath = parsed.error.issues[0]?.path[0];
  const setting = typeof firstPath === "string" ? firstPath : "UNKNOWN";
  throw new ConfigurationError(setting);
}

export function parseHttpConfig(environment: NodeJS.ProcessEnv): HttpConfig {
  const input =
    environment.MCP_HTTP_PORT === undefined ? {} : { MCP_HTTP_PORT: environment.MCP_HTTP_PORT };

  const parsed = HttpConfigInputSchema.safeParse(input);
  if (parsed.success) return parsed.data;

  throw new ConfigurationError("MCP_HTTP_PORT");
}
