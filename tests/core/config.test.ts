import { ConfigurationError, parseConfig, parseHttpConfig } from "../../src/core/config.js";
import { DEFAULT_MAGENTO_MAX_RESPONSE_BYTES } from "../../src/magento/response-size.js";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    MAGENTO_BASE_URL: "https://shop.example/",
    MAGENTO_STORE_SCOPE: "default",
    MAGENTO_OAUTH_CONSUMER_KEY: "consumer",
    MAGENTO_OAUTH_CONSUMER_SECRET: "consumer-secret",
    MAGENTO_OAUTH_ACCESS_TOKEN: "token",
    MAGENTO_OAUTH_ACCESS_TOKEN_SECRET: "token-secret",
    MAGENTO_REQUEST_TIMEOUT_MS: "5000",
    MAGENTO_MAX_RESPONSE_BYTES: "1048576",
    MCP_MAX_PAGE_SIZE: "50",
    MCP_AUDIT_FILE: "var/audit.jsonl",
  };
}

describe("server configuration", () => {
  it("parses exactly the ten server settings and normalizes owned values", () => {
    const config = parseConfig(validEnvironment());
    expect(config.baseUrl).toBe("https://shop.example/");
    expect(config.storeScope).toBe("default");
    expect(config.requestTimeoutMs).toBe(5000);
    expect(config.maxResponseBytes).toBe(1_048_576);
    expect(config.maxPageSize).toBe(50);
    expect(config.auditFile.endsWith("/var/audit.jsonl")).toBe(true);
    expect(config.oauth).toEqual({
      consumerKey: "consumer",
      consumerSecret: "consumer-secret",
      accessToken: "token",
      accessTokenSecret: "token-secret",
    });
  });

  it("defaults the page maximum to 25", () => {
    const environment = validEnvironment();
    delete environment.MCP_MAX_PAGE_SIZE;
    expect(parseConfig(environment).maxPageSize).toBe(25);
  });

  it("defaults the Magento response maximum to the hardcoded safe value", () => {
    const environment = validEnvironment();
    delete environment.MAGENTO_MAX_RESPONSE_BYTES;
    expect(parseConfig(environment).maxResponseBytes).toBe(DEFAULT_MAGENTO_MAX_RESPONSE_BYTES);
  });

  it.each([
    ["MAGENTO_BASE_URL", "http://shop.example/"],
    ["MAGENTO_BASE_URL", "https://user:pass@shop.example/"],
    ["MAGENTO_BASE_URL", "https://shop.example/path"],
    ["MAGENTO_STORE_SCOPE", "Default"],
    ["MAGENTO_OAUTH_ACCESS_TOKEN", "token\nleak"],
    ["MAGENTO_REQUEST_TIMEOUT_MS", "099"],
    ["MAGENTO_REQUEST_TIMEOUT_MS", "120001"],
    ["MAGENTO_MAX_RESPONSE_BYTES", "0"],
    ["MAGENTO_MAX_RESPONSE_BYTES", String(DEFAULT_MAGENTO_MAX_RESPONSE_BYTES + 1)],
    ["MCP_MAX_PAGE_SIZE", "0"],
    ["MCP_MAX_PAGE_SIZE", "1001"],
    ["MCP_AUDIT_FILE", "audit\nfile"],
  ])("rejects invalid %s without exposing its value", (setting, value) => {
    const environment = validEnvironment();
    environment[setting] = value;
    let captured: unknown;
    try {
      parseConfig(environment);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ConfigurationError);
    expect((captured as Error).message).toBe(`Invalid server configuration: ${setting}.`);
    expect((captured as Error).message).not.toContain(value);
  });
});

describe("HTTP transport configuration", () => {
  it("defaults to port 3000", () => {
    expect(parseHttpConfig({}).port).toBe(3000);
  });

  it("accepts a canonical TCP port", () => {
    expect(parseHttpConfig({ MCP_HTTP_PORT: "8080" }).port).toBe(8080);
  });

  it.each(["0", "065535", "65536", "not-a-port"])('rejects invalid port "%s"', (value) => {
    expect(() => parseHttpConfig({ MCP_HTTP_PORT: value })).toThrow(
      new ConfigurationError("MCP_HTTP_PORT"),
    );
  });
});
