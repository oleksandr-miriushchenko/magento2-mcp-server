import { createHmac, timingSafeEqual } from "node:crypto";

import { z, type ZodType } from "zod";

import { canonicalJson } from "./canonical-json.js";
import { createPolicyError, POLICY_ERROR_REASON } from "./errors.js";

const MAX_CURSOR_LENGTH = 8192;
const KindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const CursorEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  kind: KindSchema,
  payload: z.unknown(),
});

function invalidCursor(): never {
  throw createPolicyError(POLICY_ERROR_REASON.INVALID_CURSOR);
}

function sign(body: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(body).digest();
}

function decodeCanonicalSegment(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
    return invalidCursor();
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(segment, "base64url");
  } catch {
    return invalidCursor();
  }
  if (decoded.toString("base64url") !== segment) return invalidCursor();
  return decoded;
}

export interface CursorCodec<T> {
  encode(payload: T): string;
  decode(cursor: string): T;
}

export function createCursorCodec<T>(options: {
  readonly key: Uint8Array;
  readonly kind: string;
  readonly payloadSchema: ZodType<T>;
}): CursorCodec<T> {
  if (options.key.byteLength < 32) throw new RangeError("Cursor key must be at least 32 bytes.");
  if (!KindSchema.safeParse(options.kind).success) throw new RangeError("Cursor kind is invalid.");
  const key = Uint8Array.from(options.key);

  return {
    encode(payload: T): string {
      const parsed = options.payloadSchema.safeParse(payload);
      if (!parsed.success) return invalidCursor();
      const body = Buffer.from(
        canonicalJson({ version: 1, kind: options.kind, payload: parsed.data }),
        "utf8",
      ).toString("base64url");
      return `${body}.${sign(body, key).toString("base64url")}`;
    },

    decode(cursor: string): T {
      if (cursor.length < 3 || cursor.length > MAX_CURSOR_LENGTH) return invalidCursor();
      const parts = cursor.split(".");
      if (parts.length !== 2) return invalidCursor();
      const [body, encodedMac] = parts;
      if (body === undefined || encodedMac === undefined || body === "" || encodedMac === "") {
        return invalidCursor();
      }

      const bodyBytes = decodeCanonicalSegment(body);
      const actualMac = decodeCanonicalSegment(encodedMac);
      const expectedMac = sign(body, key);
      if (actualMac.length !== expectedMac.length || !timingSafeEqual(actualMac, expectedMac)) {
        return invalidCursor();
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(bodyBytes.toString("utf8"));
      } catch {
        return invalidCursor();
      }
      const envelope = CursorEnvelopeSchema.safeParse(decoded);
      if (!envelope.success || envelope.data.kind !== options.kind) return invalidCursor();
      const payload = options.payloadSchema.safeParse(envelope.data.payload);
      if (!payload.success) return invalidCursor();
      return payload.data;
    },
  };
}
