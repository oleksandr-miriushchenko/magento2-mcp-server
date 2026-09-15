import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { registerCustomerGet } from "./customer-get/register.js";
import { registerCustomerGroupSearch } from "./customer-group-search/register.js";
import { registerCustomerSearch } from "./customer-search/register.js";

export function registerCustomerTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerCustomerSearch(registerTool, dependencies);
  registerCustomerGet(registerTool, dependencies);
  registerCustomerGroupSearch(registerTool, dependencies);
}
