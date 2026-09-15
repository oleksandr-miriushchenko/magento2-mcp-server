import { z } from "zod";

export function createToolFailureSchema<TCode extends z.ZodEnum>(code: TCode) {
  return z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code,
      message: z.string().min(1),
      retryable: z.boolean(),
    }),
  });
}

export type ToolFailure<TCode extends z.ZodEnum> = z.infer<
  ReturnType<typeof createToolFailureSchema<TCode>>
>;

export function createToolResultSchemas<TData extends z.ZodType, TCode extends z.ZodEnum>(
  data: TData,
  code: TCode,
) {
  const success = z.strictObject({ ok: z.literal(true), data });
  const failure = createToolFailureSchema(code);
  return {
    success,
    failure,
    output: z.discriminatedUnion("ok", [success, failure]),
  } as const;
}
