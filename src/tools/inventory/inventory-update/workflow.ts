import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { InventoryWriter, MagentoSourceItemUpdate } from "../../../magento/inventory.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import {
  INVENTORY_UPDATE_STATUS,
  INVENTORY_UPDATE_TOOL,
  type InventoryUpdateInput,
  type InventoryUpdateSuccess,
} from "./schemas.js";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceItems(input: InventoryUpdateInput): MagentoSourceItemUpdate[] {
  return input.source_items
    .map((item) => ({
      sku: item.sku,
      sourceCode: item.source_code,
      quantity: item.quantity,
      status: item.status === INVENTORY_UPDATE_STATUS.IN_STOCK ? (1 as const) : (0 as const),
    }))
    .sort(
      (left, right) => compare(left.sku, right.sku) || compare(left.sourceCode, right.sourceCode),
    );
}

function fingerprint(input: InventoryUpdateInput): string {
  return canonicalDigest({ source_items: sourceItems(input) });
}

export type InventoryUpdateWorkflow = IdempotentWriteWorkflow<
  InventoryUpdateInput,
  InventoryUpdateSuccess
>;

export function createInventoryUpdateWorkflow(
  inventory: InventoryWriter,
  idempotency: IdempotencyStore<InventoryUpdateSuccess>,
): InventoryUpdateWorkflow {
  return createIdempotentWriteWorkflow({
    tool: INVENTORY_UPDATE_TOOL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      const items = sourceItems(input);
      await inventory.updateSourceItems(items, signal, onAttempt);
      return { ok: true, data: { updated_count: items.length } };
    },
  });
}
