import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "./canonical-json.js";
import { createCursorCodec } from "./cursor.js";
import { createPolicyError, POLICY_ERROR_REASON } from "./errors.js";

const SearchCursorPayloadSchema = z.strictObject({
  next_page: z.number().int().min(2),
  criteria_fingerprint: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]+$/),
});

type SearchCursorPayload = z.infer<typeof SearchCursorPayloadSchema>;

export interface SearchCursorCodec {
  encode(nextPage: number, criteria: unknown): string;
  decode(cursor: string, criteria: unknown): number;
}

export function createSearchCursorCodec(options: {
  readonly key: Uint8Array;
  readonly kind: string;
}): SearchCursorCodec {
  const key = Uint8Array.from(options.key);
  const codec = createCursorCodec<SearchCursorPayload>({
    key,
    kind: options.kind,
    payloadSchema: SearchCursorPayloadSchema,
  });

  function fingerprint(criteria: unknown): string {
    return createHmac("sha256", key)
      .update(options.kind)
      .update("\0")
      .update(canonicalJson(criteria))
      .digest("base64url");
  }

  return {
    encode(nextPage, criteria) {
      return codec.encode({ next_page: nextPage, criteria_fingerprint: fingerprint(criteria) });
    },

    decode(cursor, criteria) {
      const payload = codec.decode(cursor);
      const actual = Buffer.from(payload.criteria_fingerprint, "base64url");
      const expected = Buffer.from(fingerprint(criteria), "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw createPolicyError(POLICY_ERROR_REASON.INVALID_CURSOR);
      }
      return payload.next_page;
    },
  };
}
