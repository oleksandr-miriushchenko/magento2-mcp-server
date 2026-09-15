import { AppError, ERROR_CODE } from "../../core/errors.js";
import { IDEMPOTENCY_STATUS, type IdempotencyStore } from "../../core/idempotency.js";

export interface IdempotentWriteInput {
  readonly idempotency_key: string;
}

export interface IdempotentWriteWorkflow<TInput extends IdempotentWriteInput, TSuccess> {
  lookup(input: TInput): TSuccess | undefined;
  execute(
    input: TInput,
    signal: AbortSignal,
    onAttempt?: () => void,
    onReplay?: () => void,
  ): Promise<TSuccess>;
}

interface IdempotentWriteWorkflowOptions<TInput extends IdempotentWriteInput, TSuccess> {
  readonly tool: string;
  readonly idempotency: IdempotencyStore<TSuccess>;
  readonly fingerprint: (input: TInput) => string;
  readonly mutate: (
    input: TInput,
    signal: AbortSignal,
    onAttempt?: () => void,
  ) => Promise<TSuccess>;
}

function hasUnknownOutcome(error: unknown): boolean {
  return !(error instanceof AppError) || error.code === ERROR_CODE.UPSTREAM_OUTCOME_UNKNOWN;
}

/** Applies the process-local reservation lifecycle around exactly one write callback. */
export function createIdempotentWriteWorkflow<TInput extends IdempotentWriteInput, TSuccess>(
  options: IdempotentWriteWorkflowOptions<TInput, TSuccess>,
): IdempotentWriteWorkflow<TInput, TSuccess> {
  return {
    lookup(input) {
      const found = options.idempotency.lookup(
        options.tool,
        input.idempotency_key,
        options.fingerprint(input),
      );
      return found.status === IDEMPOTENCY_STATUS.REPLAY ? found.result : undefined;
    },

    async execute(input, signal, onAttempt, onReplay) {
      const mutationFingerprint = options.fingerprint(input);
      const reservation = options.idempotency.reserve(
        options.tool,
        input.idempotency_key,
        mutationFingerprint,
      );
      if (reservation.status === IDEMPOTENCY_STATUS.REPLAY) {
        onReplay?.();
        return reservation.result;
      }

      try {
        const result = await options.mutate(input, signal, onAttempt);
        options.idempotency.complete(
          options.tool,
          input.idempotency_key,
          mutationFingerprint,
          reservation.token,
          result,
        );
        return result;
      } catch (error) {
        if (!hasUnknownOutcome(error)) {
          options.idempotency.release(
            options.tool,
            input.idempotency_key,
            mutationFingerprint,
            reservation.token,
          );
        }
        throw error;
      }
    },
  };
}
