import type {
  Icon,
  RegisteredTool,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from "@modelcontextprotocol/server";

/** The SDK's schema-based tool registration signature, without its deprecated raw-shape overload. */
export type RegisterTool = <InputSchema extends StandardSchemaWithJSON | undefined = undefined>(
  name: string,
  config: {
    readonly title?: string;
    readonly description?: string;
    readonly inputSchema?: InputSchema;
    readonly outputSchema: StandardSchemaWithJSON;
    readonly annotations?: ToolAnnotations;
    readonly icons?: Icon[];
    readonly _meta?: Record<string, unknown>;
  },
  callback: ToolCallback<InputSchema>,
) => RegisteredTool;
