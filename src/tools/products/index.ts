import type { ToolDependencies } from "../dependencies.js";
import type { RegisterTool } from "../registration.js";
import { registerCategoryTreeGet } from "./category-tree-get/register.js";
import { registerProductAttributeGet } from "./product-attribute-get/register.js";
import { registerProductAttributeSearch } from "./product-attribute-search/register.js";
import { registerProductGet } from "./product-get/register.js";
import { registerProductSearch } from "./product-search/register.js";
import { registerProductUpdate } from "./product-update/register.js";

export function registerProductTools(
  registerTool: RegisterTool,
  dependencies: ToolDependencies,
): void {
  registerCategoryTreeGet(registerTool, dependencies);
  registerProductAttributeGet(registerTool, dependencies);
  registerProductAttributeSearch(registerTool, dependencies);
  registerProductGet(registerTool, dependencies);
  registerProductSearch(registerTool, dependencies);
  registerProductUpdate(registerTool, dependencies);
}
