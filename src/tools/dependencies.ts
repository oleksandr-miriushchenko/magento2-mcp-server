import type { AuditWriter } from "../core/audit.js";
import type { IdempotencyRegistry } from "../core/idempotency.js";
import type { WriteApprovalPolicy } from "../core/write-approval.js";
import type { MagentoClient } from "../magento/client.js";

export interface ToolDependencies {
  readonly client: MagentoClient;
  readonly audit: AuditWriter;
  readonly approval: WriteApprovalPolicy;
  readonly idempotency: IdempotencyRegistry;
  readonly maxPageSize: number;
  readonly cursorKey: Uint8Array;
}
