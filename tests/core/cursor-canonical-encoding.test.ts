import { z } from "zod";

import { createCursorCodec } from "../../src/core/cursor.js";

const payloadSchema = z.strictObject({ after_id: z.number().int().nonnegative() });
const key = new Uint8Array(32).fill(7);
const codec = createCursorCodec({ key, kind: "orders", payloadSchema });
const encoded = codec.encode({ after_id: 9 });
const [body, mac] = encoded.split(".") as [string, string];

const segmentMutations = [
  ["an invalid character", (segment: string) => `${segment}!`],
  ["whitespace", (segment: string) => `${segment} `],
  ["padding", (segment: string) => `${segment}=`],
  ["standard-base64 +", (segment: string) => `${segment}+`],
  ["standard-base64 /", (segment: string) => `${segment}/`],
  ["an impossible unpadded length", () => "A"],
] as const;

const malformedCursors = [
  ...segmentMutations.map(
    ([name, mutate]) => [`body with ${name}`, `${mutate(body)}.${mac}`] as const,
  ),
  ...segmentMutations.map(
    ([name, mutate]) => [`MAC with ${name}`, `${body}.${mutate(mac)}`] as const,
  ),
];

function discardedTailBitAlias(segment: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalIndex = alphabet.indexOf(segment.at(-1) ?? "");
  if (finalIndex < 0 || finalIndex % 4 !== 0) throw new Error("Expected a canonical MAC segment.");
  const aliasCharacter = alphabet.at(finalIndex + 1);
  if (aliasCharacter === undefined) throw new Error("Expected a MAC tail-bit alias.");
  return `${segment.slice(0, -1)}${aliasCharacter}`;
}

describe("cursor canonical encoding", () => {
  it("round-trips a valid cursor", () => {
    expect(codec.decode(encoded)).toEqual({ after_id: 9 });
  });

  it.each(malformedCursors)("rejects a malformed %s", (_name, cursor) => {
    expect(() => codec.decode(cursor)).toThrow("Invalid or expired cursor.");
  });

  it("rejects non-canonical discarded-tail-bit aliases in body and MAC segments", () => {
    const bodyAlias = "Zh";
    expect(Buffer.from(bodyAlias, "base64url").toString("base64url")).toBe("Zg");
    expect(() => codec.decode(`${bodyAlias}.${mac}`)).toThrow("Invalid or expired cursor.");

    const macAlias = discardedTailBitAlias(mac);
    expect(Buffer.from(macAlias, "base64url")).toEqual(Buffer.from(mac, "base64url"));
    expect(() => codec.decode(`${body}.${macAlias}`)).toThrow("Invalid or expired cursor.");
  });

  it("rejects a mismatched cursor domain", () => {
    const otherDomain = createCursorCodec({ key, kind: "items", payloadSchema });
    expect(() => otherDomain.decode(encoded)).toThrow("Invalid or expired cursor.");
  });

  it("rejects a changed but validly encoded signature", () => {
    const replacement = mac.startsWith("A") ? "B" : "A";
    const changedMac = `${replacement}${mac.slice(1)}`;
    expect(Buffer.from(changedMac, "base64url").toString("base64url")).toBe(changedMac);
    expect(() => codec.decode(`${body}.${changedMac}`)).toThrow("Invalid or expired cursor.");
  });
});
