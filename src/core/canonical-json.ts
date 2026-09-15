import { createHash } from "node:crypto";

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Value is not finite JSON.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Value is not acyclic JSON.");
    seen.add(value);
    const result = `[${value.map((entry) => serialize(entry, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Value is not a plain JSON object.");
    }
    if (seen.has(value)) throw new TypeError("Value is not acyclic JSON.");
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry, seen)}`);
    seen.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError("Value is not JSON.");
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

export function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
