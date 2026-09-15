import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { registerFulfillmentReadTools } from "./fulfillment-read/register.js";
import { registerFulfillmentWriteTools } from "./fulfillment-write/register.js";
import { registerOrderAddComment } from "./order-add-comment/register.js";
import { registerOrderGet } from "./order-get/register.js";
import { registerOrderSearch } from "./order-search/register.js";

export function registerOrderTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerFulfillmentReadTools(registerTool, dependencies);
  registerFulfillmentWriteTools(registerTool, dependencies);
  registerOrderGet(registerTool, dependencies);
  registerOrderSearch(registerTool, dependencies);
  registerOrderAddComment(registerTool, dependencies);
}
