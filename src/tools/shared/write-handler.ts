import type { ToolCallback } from "@modelcontextprotocol/server";
import type { z } from "zod";

import { type AppError, createAppError, ERROR_CODE, PolicyError } from "../../core/errors.js";
import type { ToolDependencies } from "../dependencies.js";
import type { IdempotentWriteInput, IdempotentWriteWorkflow } from "./idempotent-write-workflow.js";
import type { ToolFailure } from "./result-schemas.js";
import {
  createAuditedToolHandler,
  resolveToolAuditInput,
  type ToolAuditOptions,
} from "./tool-handler.js";
import { writePolicyFailure } from "./write-policy-failure.js";
import type { WRITE_ERROR_CODE } from "./error-codes.js";

type WriteFailure = ToolFailure<z.ZodEnum<typeof WRITE_ERROR_CODE>>;
type WriteSuccess = Record<string, unknown> & { readonly ok: true };

type WriteHandlerOptions<
  TSchema extends z.ZodType<IdempotentWriteInput>,
  TSuccess extends WriteSuccess,
> = {
  readonly dependencies: ToolDependencies;
  readonly inputSchema: TSchema;
  readonly outputSchema: z.ZodType<TSuccess | WriteFailure>;
  readonly approvalMessage: (input: z.output<TSchema>) => string;
  readonly workflow: IdempotentWriteWorkflow<z.output<TSchema>, TSuccess>;
} & ToolAuditOptions<z.output<TSchema>>;

function internalFailure(): WriteFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: error.retryable },
  };
}

function failure(error: AppError | PolicyError): WriteFailure {
  if (error instanceof PolicyError) return writePolicyFailure(error);
  return {
    ok: false,
    error: { code: error.code, message: error.message, retryable: error.retryable },
  };
}

/** Creates the shared approval, replay, execution, and safe-result handler for a write tool. */
export function createWriteHandler<
  TSchema extends z.ZodType<IdempotentWriteInput>,
  TSuccess extends WriteSuccess,
>(options: WriteHandlerOptions<TSchema, TSuccess>): ToolCallback<TSchema> {
  return createAuditedToolHandler({
    dependencies: options.dependencies,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    internalFailure,
    failure,
    write: true,
    execute: async (input, context, controls) => {
      const replay = options.workflow.lookup(input);
      if (replay !== undefined) {
        controls.markReplayed();
        return replay;
      }
      const approval = await options.dependencies.approval.requireApproval(
        options.tool,
        input,
        options.approvalMessage(input),
        context,
      );
      if ("resultType" in approval) return approval;
      return options.workflow.execute(
        input,
        controls.signal,
        controls.onAttempt,
        controls.markReplayed,
      );
    },
    auditInput: (input, metrics) => resolveToolAuditInput(options, input, metrics),
  });
}
