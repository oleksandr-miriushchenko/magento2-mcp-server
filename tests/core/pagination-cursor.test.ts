import { z } from "zod";

import { createCursorCodec } from "../../src/core/cursor.js";
import { createPageInputSchema } from "../../src/core/pagination.js";

describe("pagination and cursor policy", () => {
  it("defaults to the server maximum, accepts it, and rejects larger values", () => {
    const schema = createPageInputSchema(25);
    const defaulted = schema.safeParse({});
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data).toEqual({ page_size: 25 });
    expect(schema.safeParse({ page_size: 25 }).success).toBe(true);
    expect(schema.safeParse({ page_size: 26 }).success).toBe(false);
    expect(schema.safeParse({ page_size: 1, sort: "entity_id" }).success).toBe(false);
  });

  it("requires a process key of at least 32 bytes", () => {
    expect(() =>
      createCursorCodec({
        key: new Uint8Array(31),
        kind: "orders",
        payloadSchema: z.strictObject({ after_id: z.number() }),
      }),
    ).toThrow(RangeError);
  });
});
