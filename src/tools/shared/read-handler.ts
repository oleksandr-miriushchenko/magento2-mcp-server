import type { ToolCallback } from "@modelcontextprotocol/server";
import type { z } from "zod";

import {
  createAppError,
  ERROR_CODE,
  type AppError,
  PolicyError,
  POLICY_ERROR_REASON,
} from "../../core/errors.js";
import type { ToolDependencies } from "../dependencies.js";
import { PAGINATION_ERROR_CODE } from "./error-codes.js";
import {
  createAuditedToolHandler,
  resolveToolAuditInput,
  type ToolAuditOptions,
} from "./tool-handler.js";

export interface ReadFailure {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

type ReadHandlerOptions<
  TSchema extends z.ZodType,
  TOutput extends Record<string, unknown> & ({ readonly ok: true } | ReadFailure),
> = {
  readonly dependencies: ToolDependencies;
  /** Inference anchor for the SDK callback input type. */
  readonly inputSchema: TSchema;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly internalFailure: () => TOutput;
  readonly failure: (error: AppError | PolicyError) => unknown;
  readonly execute: (
    input: z.output<TSchema>,
    signal: AbortSignal,
    onAttempt: () => void,
  ) => Promise<TOutput>;
} & ToolAuditOptions<z.output<TSchema>>;

export function defaultReadFailure(error: AppError | PolicyError): ReadFailure {
  if (error instanceof PolicyError) {
    if (error.reason === POLICY_ERROR_REASON.INVALID_CURSOR) {
      return {
        ok: false,
        error: {
          code: PAGINATION_ERROR_CODE.INVALID_CURSOR,
          message: error.message,
          retryable: false,
        },
      };
    }
    const internal = createAppError(ERROR_CODE.INTERNAL_ERROR);
    return {
      ok: false,
      error: { code: internal.code, message: internal.message, retryable: internal.retryable },
    };
  }
  return {
    ok: false,
    error: { code: error.code, message: error.message, retryable: error.retryable },
  };
}

export function createReadHandler<
  TSchema extends z.ZodType,
  TOutput extends Record<string, unknown> & ({ readonly ok: true } | ReadFailure),
>(options: ReadHandlerOptions<TSchema, TOutput>): ToolCallback<TSchema> {
  return createAuditedToolHandler({
    dependencies: options.dependencies,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    internalFailure: options.internalFailure,
    failure: options.failure,
    execute: (input, _context, controls) =>
      options.execute(input, controls.signal, controls.onAttempt),
    auditInput: (input, metrics) => resolveToolAuditInput(options, input, metrics),
  });
}
