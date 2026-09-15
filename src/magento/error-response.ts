import { z } from "zod";

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_PARAMETER_COUNT = 10;
const MAX_PARAMETER_LENGTH = 256;
const MAX_DETAIL_LENGTH = 1_500;

const MagentoErrorResponseSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  parameters: z
    .union([
      z
        .array(z.union([z.string().max(MAX_PARAMETER_LENGTH), z.number(), z.boolean()]))
        .max(MAX_PARAMETER_COUNT),
      z
        .record(
          z.string(),
          z.union([z.string().max(MAX_PARAMETER_LENGTH), z.number(), z.boolean()]),
        )
        .refine((parameters) => Object.keys(parameters).length <= MAX_PARAMETER_COUNT),
    ])
    .optional(),
});

function normalizeText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
  })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

export function extractMagentoErrorMessage(value: unknown): string | undefined {
  const parsed = MagentoErrorResponseSchema.safeParse(value);
  if (!parsed.success) return undefined;

  let message = normalizeText(parsed.data.message);
  if (message.length === 0) return undefined;

  const parameters = parsed.data.parameters;
  if (Array.isArray(parameters)) {
    message = message.replace(/%([1-9]\d*)/gu, (placeholder, indexText: string) => {
      const parameter = parameters[Number(indexText) - 1];
      return parameter === undefined ? placeholder : normalizeText(String(parameter));
    });
  } else if (parameters !== undefined) {
    message = message.replace(/%([A-Za-z0-9_]+)/gu, (placeholder, name: string) => {
      if (!Object.hasOwn(parameters, name)) return placeholder;
      return normalizeText(String(parameters[name]));
    });
  }

  message = normalizeText(message);
  if (message.length === 0) return undefined;
  if (message.length <= MAX_DETAIL_LENGTH) return message;
  return `${message.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}
