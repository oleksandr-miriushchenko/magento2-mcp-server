import { createOAuthAuthorizationHeader, oauthPercentEncode } from "../../src/magento/oauth.js";

describe("Magento OAuth signer", () => {
  it("uses RFC 3986 encoding", () => {
    expect(oauthPercentEncode("Ladies + Gentlemen!*'()")).toBe(
      "Ladies%20%2B%20Gentlemen%21%2A%27%28%29",
    );
  });

  it("matches a fixed HMAC-SHA256 authorization vector", () => {
    const header = createOAuthAuthorizationHeader({
      method: "GET",
      url: new URL("https://example.com/rest/default/V1/orders/1"),
      credentials: {
        consumerKey: "key",
        consumerSecret: "secret",
        accessToken: "token",
        accessTokenSecret: "token-secret",
      },
      nonce: "nonce-1",
      timestamp: 1_700_000_000,
    });
    expect(header).toBe(
      'OAuth oauth_consumer_key="key", oauth_nonce="nonce-1", oauth_signature="KTWnYY0lWwo3mhUqsBe4bLd4VYplGZgbfYB6LDVvwXg%3D", oauth_signature_method="HMAC-SHA256", oauth_timestamp="1700000000", oauth_token="token", oauth_version="1.0"',
    );
  });

  it("includes every URL query pair in a fixed signature vector", () => {
    const header = createOAuthAuthorizationHeader({
      method: "GET",
      url: new URL("https://example.com/rest/default/V1/orders?b=two&a=2&a=1"),
      credentials: {
        consumerKey: "key",
        consumerSecret: "secret",
        accessToken: "token",
        accessTokenSecret: "token-secret",
      },
      nonce: "nonce-1",
      timestamp: 1_700_000_000,
    });

    expect(header).toBe(
      'OAuth oauth_consumer_key="key", oauth_nonce="nonce-1", oauth_signature="%2Bn9c0%2FA8FIpLKend6TXHMxkgM5800qj8a2Vy8UlL47o%3D", oauth_signature_method="HMAC-SHA256", oauth_timestamp="1700000000", oauth_token="token", oauth_version="1.0"',
    );
  });
});
