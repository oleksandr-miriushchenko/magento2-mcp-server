import {
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { canonicalDigest } from "./canonical-json.js";
import { createPolicyError, POLICY_ERROR_REASON } from "./errors.js";

const ApprovalStateSchema = z.strictObject({
  tool: z.string().min(1).max(64),
  argument_digest: z.string().length(64),
});
type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export interface WriteApprovalPolicy {
  readonly verify: (state: string, context: ServerContext) => Promise<ApprovalState>;
  requireApproval(
    tool: string,
    validatedArguments: unknown,
    message: string,
    context: ServerContext,
  ): Promise<InputRequiredResult | { readonly approved: true }>;
}

/**
 * Future write sequence: validate, obtain native approval, verify protected state,
 * re-check ACL/store/entity state, reserve idempotency, mutate, store the completed
 * result, then audit. Release the matching reservation when mutation fails.
 */
export function createWriteApprovalPolicy(key: Uint8Array): WriteApprovalPolicy {
  if (key.byteLength !== 32) throw new RangeError("Approval key must be exactly 32 bytes.");
  const codec = createRequestStateCodec<ApprovalState>({
    key: Uint8Array.from(key),
    ttlSeconds: 300,
    bind: (context) => context.mcpReq.method,
  });

  return {
    verify: (state, context) => codec.verify(state, context),
    async requireApproval(tool, validatedArguments, message, context) {
      const expected = {
        tool,
        argument_digest: canonicalDigest(validatedArguments),
      };
      const current = context.mcpReq.requestState();
      if (current === undefined) {
        if (context.mcpReq.inputResponses !== undefined) {
          throw createPolicyError(POLICY_ERROR_REASON.INVALID_APPROVAL_STATE);
        }
        const requestState = await codec.mint(expected, context);
        return inputRequired({
          inputRequests: {
            approval: inputRequired.elicit({
              message,
              requestedSchema: {
                type: "object",
                properties: { confirm: { type: "boolean", title: "Confirm operation" } },
                required: ["confirm"],
              },
            }),
          },
          requestState,
        });
      }

      const parsed = ApprovalStateSchema.safeParse(current);
      if (
        !parsed.success ||
        parsed.data.tool !== expected.tool ||
        parsed.data.argument_digest !== expected.argument_digest
      ) {
        throw createPolicyError(POLICY_ERROR_REASON.INVALID_APPROVAL_STATE);
      }

      const response = inputResponse(context.mcpReq.inputResponses, "approval");
      if (response.kind !== "elicit") {
        throw createPolicyError(POLICY_ERROR_REASON.INVALID_APPROVAL_RESPONSE);
      }
      if (response.action !== "accept" || response.content?.confirm !== true) {
        throw createPolicyError(POLICY_ERROR_REASON.DECLINED_APPROVAL);
      }
      return { approved: true };
    },
  };
}
