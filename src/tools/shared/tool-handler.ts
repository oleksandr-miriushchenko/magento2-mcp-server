import type {
  CallToolResult,
  InputRequiredResult,
  ToolCallback,
} from "@modelcontextprotocol/server";
import type { z } from "zod";

import type { AUDIT_TOOL, AuditInput } from "../../core/audit.js";
import { type AppError, PolicyError, toAppError } from "../../core/errors.js";
import type { ToolDependencies } from "../dependencies.js";
import { auditFailure } from "./audit-failure.js";
import { packToolResult } from "./tool-result.js";

interface ToolFailure {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
}

type ToolOutput = Record<string, unknown> & ({ readonly ok: true } | ToolFailure);

export interface ToolAuditMetrics {
  readonly requestId: string | number;
  readonly outcome: AuditInput["outcome"];
  readonly duration_ms: number;
  readonly attempt_count: number;
  readonly replayed: boolean;
}

export type GeneralAuditTool = Exclude<
  AuditInput["tool"],
  typeof AUDIT_TOOL.ORDER_GET | typeof AUDIT_TOOL.ORDER_ADD_COMMENT
>;
type SpecialAuditTool = Exclude<AuditInput["tool"], GeneralAuditTool>;

export type ToolAuditOptions<TInput> =
  | {
      readonly tool: GeneralAuditTool;
    }
  | {
      readonly tool: SpecialAuditTool;
      readonly auditInput: (input: TInput, metrics: ToolAuditMetrics) => AuditInput;
    };

export interface ToolExecutionControls {
  readonly signal: AbortSignal;
  readonly onAttempt: () => void;
  readonly markReplayed: () => void;
}

interface AuditedToolHandlerOptions<TSchema extends z.ZodType, TOutput extends ToolOutput> {
  readonly dependencies: Pick<ToolDependencies, "audit">;
  /** Inference anchor for the SDK callback input type. */
  readonly inputSchema: TSchema;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly internalFailure: () => TOutput;
  readonly failure: (error: AppError | PolicyError) => unknown;
  readonly execute: (
    input: z.output<TSchema>,
    context: Parameters<ToolCallback<TSchema>>[1],
    controls: ToolExecutionControls,
  ) => Promise<unknown>;
  readonly auditInput: (input: z.output<TSchema>, metrics: ToolAuditMetrics) => AuditInput;
  readonly write?: boolean;
}

function isInputRequiredResult(value: unknown): value is InputRequiredResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "resultType" in value &&
    value.resultType === "input_required"
  );
}

function validateOutput<TOutput extends ToolOutput>(
  value: unknown,
  schema: z.ZodType<TOutput>,
  internalFailure: () => TOutput,
): TOutput {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : internalFailure();
}

export function resolveToolAuditInput<TInput>(
  options: ToolAuditOptions<TInput>,
  input: TInput,
  metrics: ToolAuditMetrics,
): AuditInput {
  if ("auditInput" in options) {
    return options.auditInput(input, metrics);
  }
  return {
    requestId: metrics.requestId,
    tool: options.tool,
    outcome: metrics.outcome,
    duration_ms: metrics.duration_ms,
    attempt_count: metrics.attempt_count,
  };
}

/** Runs the shared exception, output validation, audit, and MCP response sequence. */
export function createAuditedToolHandler<TSchema extends z.ZodType, TOutput extends ToolOutput>(
  options: AuditedToolHandlerOptions<TSchema, TOutput>,
): ToolCallback<TSchema> {
  const handler = async (
    input: z.output<TSchema>,
    context: Parameters<ToolCallback<TSchema>>[1],
  ): Promise<CallToolResult | InputRequiredResult> => {
    const startedAt = performance.now();
    let attemptCount = 0;
    let replayed = false;
    let candidate: unknown;

    try {
      candidate = await options.execute(input, context, {
        signal: context.mcpReq.signal,
        onAttempt: () => {
          attemptCount += 1;
        },
        markReplayed: () => {
          replayed = true;
        },
      });
      if (isInputRequiredResult(candidate)) return candidate;
    } catch (error) {
      candidate = options.failure(error instanceof PolicyError ? error : toAppError(error));
    }

    let output = validateOutput(candidate, options.outputSchema, options.internalFailure);
    const metrics: ToolAuditMetrics = {
      requestId: context.mcpReq.id,
      outcome: output.ok ? "success" : "failure",
      duration_ms: Math.max(0, Math.floor(performance.now() - startedAt)),
      attempt_count: attemptCount,
      replayed,
    };
    try {
      await options.dependencies.audit.write(options.auditInput(input, metrics));
    } catch {
      output = validateOutput(
        auditFailure(output, options.write),
        options.outputSchema,
        options.internalFailure,
      );
    }

    return packToolResult(output);
  };
  return handler as ToolCallback<TSchema>;
}
