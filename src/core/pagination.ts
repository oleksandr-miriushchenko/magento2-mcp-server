import { z } from "zod";

const MAX_CURSOR_LENGTH = 8192;

export function createPageInputSchema(maxPageSize: number) {
  if (!Number.isInteger(maxPageSize) || maxPageSize < 1) {
    throw new RangeError("Maximum page size must be a positive integer.");
  }
  return z.strictObject({
    page_size: z
      .number()
      .int()
      .positive()
      .max(maxPageSize)
      .default(maxPageSize)
      .describe(`Maximum results per page. Server limit: ${maxPageSize}.`),
    cursor: z
      .string()
      .min(1)
      .max(MAX_CURSOR_LENGTH)
      .optional()
      .describe(
        "Opaque next-page cursor returned by this tool. Repeat the original filters and sort.",
      ),
  });
}
