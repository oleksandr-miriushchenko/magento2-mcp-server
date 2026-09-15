export const ERROR_CODE = {
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UPSTREAM_INVALID_RESPONSE: "UPSTREAM_INVALID_RESPONSE",
  UPSTREAM_REJECTED: "UPSTREAM_REJECTED",
  UPSTREAM_OUTCOME_UNKNOWN: "UPSTREAM_OUTCOME_UNKNOWN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
  }
}

const SAFE_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  [ERROR_CODE.FORBIDDEN]: "Magento denied access to the requested resource.",
  [ERROR_CODE.NOT_FOUND]: "The requested Magento resource was not found.",
  [ERROR_CODE.UPSTREAM_UNAVAILABLE]: "Magento is temporarily unavailable. Try again later.",
  [ERROR_CODE.UPSTREAM_INVALID_RESPONSE]: "Magento returned an unexpected response.",
  [ERROR_CODE.UPSTREAM_REJECTED]: "Magento rejected the requested operation.",
  [ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN]:
    "Magento may have completed the operation. Do not retry with a new idempotency key. Reconcile the Magento state before another write.",
  [ERROR_CODE.INTERNAL_ERROR]: "The operation could not be completed or verified.",
};

export function createAppError(code: ErrorCode, retryable = false): AppError {
  return new AppError(code, SAFE_MESSAGES[code], retryable);
}

export const POLICY_ERROR_REASON = {
  INVALID_CURSOR: "invalid_cursor",
  INVALID_APPROVAL_STATE: "invalid_approval_state",
  INVALID_APPROVAL_RESPONSE: "invalid_approval_response",
  DECLINED_APPROVAL: "declined_approval",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  IDEMPOTENCY_PENDING: "idempotency_pending",
  IDEMPOTENCY_RESERVATION: "idempotency_reservation",
  IDEMPOTENCY_CAPACITY: "idempotency_capacity",
} as const;

export type PolicyErrorReason = (typeof POLICY_ERROR_REASON)[keyof typeof POLICY_ERROR_REASON];

const POLICY_MESSAGES: Readonly<Record<PolicyErrorReason, string>> = {
  [POLICY_ERROR_REASON.INVALID_CURSOR]: "Invalid or expired cursor.",
  [POLICY_ERROR_REASON.INVALID_APPROVAL_STATE]:
    "Approval state is invalid or expired. Request fresh approval for the same operation and idempotency key. No Magento write was attempted by this call.",
  [POLICY_ERROR_REASON.INVALID_APPROVAL_RESPONSE]:
    "Approval response is missing or invalid. Request fresh approval for the same operation and idempotency key. No Magento write was attempted by this call.",
  [POLICY_ERROR_REASON.DECLINED_APPROVAL]: "The write operation was declined.",
  [POLICY_ERROR_REASON.IDEMPOTENCY_CONFLICT]: "The idempotency key was used for another request.",
  [POLICY_ERROR_REASON.IDEMPOTENCY_PENDING]:
    "The idempotency key is reserved by an ongoing or unresolved operation. Magento may have completed it. Do not retry with a new idempotency key. Reconcile the Magento state before another write.",
  [POLICY_ERROR_REASON.IDEMPOTENCY_RESERVATION]:
    "The idempotency reservation could not be verified. Magento may have completed the operation. Do not retry with a new idempotency key. Reconcile the Magento state before another write.",
  [POLICY_ERROR_REASON.IDEMPOTENCY_CAPACITY]:
    "The local idempotency store has no capacity for another write. No Magento write was attempted by this call. Wait for capacity; keep the same idempotency key.",
} as const;

export class PolicyError extends Error {
  readonly reason: PolicyErrorReason;

  constructor(reason: PolicyErrorReason) {
    super(POLICY_MESSAGES[reason]);
    this.name = "PolicyError";
    this.reason = reason;
  }
}

export function createPolicyError(reason: PolicyErrorReason): PolicyError {
  return new PolicyError(reason);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return createAppError(ERROR_CODE.INTERNAL_ERROR);
}
