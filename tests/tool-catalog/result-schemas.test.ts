import { expectTypeOf } from "vitest";
import { z } from "zod";

import { ERROR_CODE } from "../../src/core/errors.js";
import { OrderAnalyticsGetOutputSchema } from "../../src/tools/analytics/schemas.js";
import { OrderAddCommentOutputSchema } from "../../src/tools/orders/order-add-comment/schemas.js";
import { OrderGetOutputSchema } from "../../src/tools/orders/order-get/schemas.js";
import { OrderSearchOutputSchema } from "../../src/tools/orders/order-search/schemas.js";
import { QuoteSearchOutputSchema } from "../../src/tools/quotes/schemas.js";
import {
  COMMON_ERROR_CODE,
  PAGINATION_ERROR_CODE,
  WRITE_ERROR_CODE,
} from "../../src/tools/shared/error-codes.js";
import {
  createToolFailureSchema,
  createToolResultSchemas,
  type ToolFailure,
} from "../../src/tools/shared/result-schemas.js";
import { StoreHierarchyGetOutputSchema } from "../../src/tools/store/schemas.js";

const TEST_ERROR_CODE = {
  NOT_FOUND: ERROR_CODE.NOT_FOUND,
  SPECIFIC_FAILURE: "SPECIFIC_FAILURE",
} as const;

const ResultSchemas = createToolResultSchemas(
  z.strictObject({ value: z.number().int().positive(), note: z.string().nullable().optional() }),
  z.enum(TEST_ERROR_CODE),
);

function failure(code: string) {
  return { ok: false, error: { code, message: "Failure.", retryable: false } };
}

describe("shared tool result schemas", () => {
  it("preserves domain data constraints and optional/nullable fields", () => {
    for (const data of [{ value: 1 }, { value: 1, note: null }, { value: 1, note: "a" }]) {
      const output = { ok: true, data };
      expect(ResultSchemas.output.safeParse(output)).toEqual({ success: true, data: output });
      expect(ResultSchemas.success.safeParse(output).success).toBe(true);
    }
    for (const data of [{ value: 0 }, { value: 1.5 }, { value: "1" }, { value: 1, note: 1 }]) {
      expect(ResultSchemas.output.safeParse({ ok: true, data }).success).toBe(false);
    }
  });

  it("accepts only the supplied error enum, including tool-specific additions", () => {
    const standalone = createToolFailureSchema(z.enum(TEST_ERROR_CODE));
    for (const code of Object.values(TEST_ERROR_CODE)) {
      const output = failure(code);
      expect(ResultSchemas.output.safeParse(output)).toEqual({ success: true, data: output });
      expect(ResultSchemas.failure.safeParse(output).success).toBe(true);
      expect(standalone.safeParse(output).success).toBe(true);
    }
    expect(
      ResultSchemas.output.safeParse(failure(WRITE_ERROR_CODE.APPROVAL_DECLINED)).success,
    ).toBe(false);
  });

  it("rejects malformed, mixed, and open-ended result envelopes", () => {
    const error = failure(TEST_ERROR_CODE.NOT_FOUND).error;
    const invalid = [
      null,
      {},
      { ok: "true", data: { value: 1 } },
      { ok: true },
      { ok: true, data: { value: 1 }, extra: true },
      { ok: true, data: { value: 1, extra: true } },
      { ok: true, data: { value: 1 }, error },
      { ok: false, error, data: { value: 1 } },
      { ok: false, error, extra: true },
      { ok: false, error: { ...error, extra: true } },
      { ok: false, error: { ...error, message: "" } },
      { ok: false, error: { ...error, retryable: "false" } },
      { ok: false, error: { code: error.code, message: error.message } },
      { ok: false, error: { code: error.code, retryable: false } },
    ];
    for (const output of invalid) {
      expect(ResultSchemas.output.safeParse(output).success).toBe(false);
    }
  });

  it("retains exact inferred types and narrows the output by ok", () => {
    interface Success {
      ok: true;
      data: { value: number; note?: string | null | undefined };
    }
    interface Failure {
      ok: false;
      error: {
        code: (typeof TEST_ERROR_CODE)[keyof typeof TEST_ERROR_CODE];
        message: string;
        retryable: boolean;
      };
    }
    expectTypeOf<z.infer<typeof ResultSchemas.success>>().toEqualTypeOf<Success>();
    expectTypeOf<z.infer<typeof ResultSchemas.failure>>().toEqualTypeOf<Failure>();
    expectTypeOf<z.infer<typeof ResultSchemas.output>>().toEqualTypeOf<Success | Failure>();
    const codeSchema = z.enum(TEST_ERROR_CODE);
    expectTypeOf<ToolFailure<typeof codeSchema>>().toEqualTypeOf<Failure>();
    expect(
      createToolFailureSchema(codeSchema).safeParse(failure(TEST_ERROR_CODE.NOT_FOUND)).success,
    ).toBe(true);

    const result = ResultSchemas.output.safeParse(failure(TEST_ERROR_CODE.NOT_FOUND));
    expect(result.success).toBe(true);
    if (!result.success) return;
    if (result.data.ok) {
      expectTypeOf(result.data).toEqualTypeOf<Success>();
    } else {
      expectTypeOf(result.data).toEqualTypeOf<Failure>();
    }
  });
});

it("keeps shared error groups opt-in for each tool", () => {
  const cases = [
    { schema: OrderGetOutputSchema, missing: true, cursor: false, write: false },
    { schema: OrderSearchOutputSchema, missing: true, cursor: true, write: false },
    { schema: QuoteSearchOutputSchema, missing: true, cursor: true, write: false },
    { schema: OrderAnalyticsGetOutputSchema, missing: true, cursor: false, write: false },
    { schema: StoreHierarchyGetOutputSchema, missing: true, cursor: false, write: false },
    { schema: OrderAddCommentOutputSchema, missing: true, cursor: false, write: true },
  ];
  for (const entry of cases) {
    for (const code of Object.values(COMMON_ERROR_CODE)) {
      expect(entry.schema.safeParse(failure(code)).success).toBe(true);
    }
    expect(entry.schema.safeParse(failure(ERROR_CODE.NOT_FOUND)).success).toBe(entry.missing);
    expect(entry.schema.safeParse(failure(PAGINATION_ERROR_CODE.INVALID_CURSOR)).success).toBe(
      entry.cursor,
    );
    for (const code of [
      WRITE_ERROR_CODE.APPROVAL_DECLINED,
      WRITE_ERROR_CODE.IDEMPOTENCY_CONFLICT,
      WRITE_ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
      WRITE_ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN,
    ]) {
      expect(entry.schema.safeParse(failure(code)).success).toBe(entry.write);
    }
    expect(entry.schema.safeParse(failure(TEST_ERROR_CODE.SPECIFIC_FAILURE)).success).toBe(false);
  }
});
