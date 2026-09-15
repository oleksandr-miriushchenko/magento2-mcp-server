import { ERROR_CODE } from "../../core/errors.js";

interface Failure<TCode extends string> {
  readonly ok: false;
  readonly error: {
    readonly code: TCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}

/** Keep outcome/reconciliation information while failing closed on missing audit evidence. */
export function auditFailure<TCode extends string>(
  output: { readonly ok: true } | Failure<TCode>,
  write = false,
): Failure<TCode | typeof ERROR_CODE.INTERNAL_ERROR> {
  if (!output.ok) {
    return {
      ok: false,
      error: {
        ...output.error,
        message: `${output.error.message} Audit recording also failed; restore auditing before another operation.`,
        retryable: false,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: ERROR_CODE.INTERNAL_ERROR,
      message: write
        ? "Magento confirmed the write, but audit recording failed. Do not repeat the write with a new idempotency key. Restore auditing; the same key can replay the completed result while retained in this process."
        : "The read completed, but audit recording failed. Restore auditing before another operation.",
      retryable: false,
    },
  };
}
