import { registerAnalyticsTools } from "./analytics/index.js";
import { registerCmsTools } from "./cms/index.js";
import { registerCustomerTools } from "./customers/index.js";
import type { ToolDependencies } from "./dependencies.js";
import { registerInventoryTools } from "./inventory/index.js";
import { registerOrderTools } from "./orders/index.js";
import { registerProductTools } from "./products/index.js";
import { registerPromotionTools } from "./promotions/index.js";
import { registerQuoteTools } from "./quotes/index.js";
import type { RegisterTool } from "./registration.js";
import { registerStoreTools } from "./store/index.js";

type ToolRegistrar = (registerTool: RegisterTool, dependencies: ToolDependencies) => void;

const TOOL_REGISTRARS = [
  registerAnalyticsTools,
  registerCmsTools,
  registerCustomerTools,
  registerInventoryTools,
  registerOrderTools,
  registerProductTools,
  registerPromotionTools,
  registerQuoteTools,
  registerStoreTools,
] satisfies readonly ToolRegistrar[];

export function registerTools(registerTool: RegisterTool, dependencies: ToolDependencies): void {
  for (const register of TOOL_REGISTRARS) {
    register(registerTool, dependencies);
  }
}
