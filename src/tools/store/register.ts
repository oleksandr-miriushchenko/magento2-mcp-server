import { AUDIT_TOOL } from "../../core/audit.js";
import { createAppError, ERROR_CODE } from "../../core/errors.js";
import { MagentoStore } from "../../magento/store.js";
import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { createReadHandler, defaultReadFailure } from "../shared/read-handler.js";
import {
  type StoreHierarchyData,
  type StoreHierarchyGetFailure,
  StoreHierarchyGetInputSchema,
  StoreHierarchyGetOutputSchema,
  STORE_HIERARCHY_GET_TOOL,
} from "./schemas.js";

function internalFailure(): StoreHierarchyGetFailure {
  const error = createAppError(ERROR_CODE.INTERNAL_ERROR);
  return {
    ok: false,
    error: { code: ERROR_CODE.INTERNAL_ERROR, message: error.message, retryable: false },
  };
}
function flag(value: boolean | 0 | 1): boolean {
  return value === true || value === 1;
}

export function registerStoreTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  const store = new MagentoStore(dependencies.client);
  registerTool(
    STORE_HIERARCHY_GET_TOOL,
    {
      title: "Get Magento Store Hierarchy",
      description: "Get websites, store groups, and store views as one nested hierarchy.",
      annotations: { readOnlyHint: true },
      inputSchema: StoreHierarchyGetInputSchema,
      outputSchema: StoreHierarchyGetOutputSchema,
    },
    createReadHandler({
      dependencies,
      tool: AUDIT_TOOL.STORE_HIERARCHY_GET,
      inputSchema: StoreHierarchyGetInputSchema,
      outputSchema: StoreHierarchyGetOutputSchema,
      internalFailure,
      failure: defaultReadFailure,
      execute: async (_input, signal, onAttempt) => {
        const raw = await store.getHierarchy(signal, onAttempt);
        const data: StoreHierarchyData = {
          websites: raw.websites.map((website) => ({
            website_id: website.id,
            code: website.code,
            name: website.name,
            default_store_group_id: website.default_group_id,
            store_groups: raw.groups
              .filter((group) => group.website_id === website.id)
              .map((group) => ({
                store_group_id: group.id,
                name: group.name,
                root_category_id: group.root_category_id,
                default_store_view_id: group.default_store_id,
                store_views: raw.views
                  .filter((view) => view.store_group_id === group.id)
                  .map((view) => ({
                    store_view_id: view.id,
                    code: view.code,
                    name: view.name,
                    is_active: flag(view.is_active),
                  })),
              })),
          })),
        };
        return { ok: true, data };
      },
    }),
  );
}
