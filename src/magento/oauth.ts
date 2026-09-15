import { createHmac } from "node:crypto";

export interface OAuthCredentials {
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly accessToken: string;
  readonly accessTokenSecret: string;
}

export function oauthPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function baseStringUri(url: URL): string {
  const scheme = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const defaultPort =
    (scheme === "https:" && url.port === "443") || (scheme === "http:" && url.port === "80");
  const authority = `${hostname}${url.port === "" || defaultPort ? "" : `:${url.port}`}`;
  return `${scheme}//${authority}${url.pathname || "/"}`;
}

function compareEncoded(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createOAuthAuthorizationHeader(input: {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: URL;
  readonly credentials: OAuthCredentials;
  readonly nonce: string;
  readonly timestamp: number;
}): string {
  const oauthParameters: Record<string, string> = {
    oauth_consumer_key: input.credentials.consumerKey,
    oauth_nonce: input.nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(input.timestamp),
    oauth_token: input.credentials.accessToken,
    oauth_version: "1.0",
  };
  const signatureParameters = [
    ...Array.from(input.url.searchParams.entries()).filter(([key]) => key !== "oauth_signature"),
    ...Object.entries(oauthParameters),
  ];
  const normalized = signatureParameters
    .map(([key, value]) => [oauthPercentEncode(key), oauthPercentEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? compareEncoded(leftValue, rightValue)
        : compareEncoded(leftKey, rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const baseString = [
    input.method,
    oauthPercentEncode(baseStringUri(input.url)),
    oauthPercentEncode(normalized),
  ].join("&");
  const signingKey = `${oauthPercentEncode(input.credentials.consumerSecret)}&${oauthPercentEncode(
    input.credentials.accessTokenSecret,
  )}`;
  const signature = createHmac("sha256", signingKey).update(baseString).digest("base64");

  const header = Object.entries({ ...oauthParameters, oauth_signature: signature })
    .map(([key, value]) => [oauthPercentEncode(key), oauthPercentEncode(value)] as const)
    .sort(([left], [right]) => compareEncoded(left, right))
    .map(([key, value]) => `${key}="${value}"`)
    .join(", ");
  return "OAuth " + header;
}
