import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { registerInventoryGet } from "./inventory-get/register.js";
import { registerInventorySourceSearch } from "./inventory-source-search/register.js";
import { registerInventoryStockSearch } from "./inventory-stock-search/register.js";
import { registerInventoryUpdate } from "./inventory-update/register.js";

export function registerInventoryTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerInventoryGet(registerTool, dependencies);
  registerInventorySourceSearch(registerTool, dependencies);
  registerInventoryStockSearch(registerTool, dependencies);
  registerInventoryUpdate(registerTool, dependencies);
}
