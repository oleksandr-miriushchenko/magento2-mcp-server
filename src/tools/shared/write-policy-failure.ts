import { createPolicyError, POLICY_ERROR_REASON, type PolicyError } from "../../core/errors.js";
import { WRITE_ERROR_CODE } from "./error-codes.js";

/** Policy messages are server-owned; never forward an arbitrary exception message. */
export function writePolicyFailure(error: PolicyError) {
  const code =
    error.reason === POLICY_ERROR_REASON.DECLINED_APPROVAL
      ? WRITE_ERROR_CODE.APPROVAL_DECLINED
      : error.reason === POLICY_ERROR_REASON.IDEMPOTENCY_CONFLICT
        ? WRITE_ERROR_CODE.IDEMPOTENCY_CONFLICT
        : error.reason === POLICY_ERROR_REASON.IDEMPOTENCY_PENDING
          ? WRITE_ERROR_CODE.IDEMPOTENCY_IN_PROGRESS
          : WRITE_ERROR_CODE.INTERNAL_ERROR;
  return {
    ok: false as const,
    error: { code, message: createPolicyError(error.reason).message, retryable: false },
  };
}
