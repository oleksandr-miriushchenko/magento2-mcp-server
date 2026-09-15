import { extractMagentoErrorMessage } from "../../src/magento/error-response.js";

describe("extractMagentoErrorMessage", () => {
  it("substitutes positional parameters from the documented Magento envelope", () => {
    expect(
      extractMagentoErrorMessage({
        message: "Invalid product data: %1",
        parameters: ["Invalid attribute set entity type"],
      }),
    ).toBe("Invalid product data: Invalid attribute set entity type");
  });

  it("substitutes exact named parameters", () => {
    expect(
      extractMagentoErrorMessage({
        message: 'Validation Failed: "%field" should be %expected.',
        parameters: { field: "status", expected: "a known status" },
      }),
    ).toBe('Validation Failed: "status" should be a known status.');
  });

  it("normalizes controls and whitespace in templates and parameters", () => {
    expect(
      extractMagentoErrorMessage({
        message: "Invoice\u0000 Document\r\nValidation\tError: %1\u0085",
        parameters: ["  cannot\nbe\tcreated  "],
      }),
    ).toBe("Invoice Document Validation Error: cannot be created");
  });

  it("preserves unresolved placeholders", () => {
    expect(extractMagentoErrorMessage({ message: "%1 / %2 / %name", parameters: ["first"] })).toBe(
      "first / %2 / %name",
    );
    expect(
      extractMagentoErrorMessage({ message: "%known / %missing", parameters: { known: "value" } }),
    ).toBe("value / %missing");
  });

  it("renders finite numbers and booleans", () => {
    expect(
      extractMagentoErrorMessage({ message: "Quantity %1, enabled %2", parameters: [12.5, false] }),
    ).toBe("Quantity 12.5, enabled false");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty object", {}],
    ["an empty message", { message: "" }],
    ["a whitespace-only message", { message: " \r\n\t " }],
    ["a message longer than 1,000 characters", { message: "x".repeat(1_001) }],
    [
      "a string parameter longer than 256 characters",
      { message: "%1", parameters: ["x".repeat(257)] },
    ],
    ["a nested parameter", { message: "%1", parameters: [{ nested: true }] }],
    ["a non-finite numeric parameter", { message: "%1", parameters: [Number.POSITIVE_INFINITY] }],
    ["more than ten positional parameters", { message: "%1", parameters: Array(11).fill("x") }],
    [
      "more than ten named parameters",
      {
        message: "%one",
        parameters: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [index, index])),
      },
    ],
  ])("rejects %s", (_scenario, value) => {
    expect(extractMagentoErrorMessage(value)).toBeUndefined();
  });

  it("truncates a valid long rendered message to one bounded ellipsis", () => {
    const result = extractMagentoErrorMessage({
      message: "%1".repeat(500),
      parameters: ["long"],
    });

    expect(result).toHaveLength(1_500);
    expect(result?.endsWith("…")).toBe(true);
    expect(result?.endsWith("……")).toBe(false);
  });

  it("ignores trace, nested errors, and unrelated fields", () => {
    const result = extractMagentoErrorMessage({
      message: "A hold action is not available.",
      trace: "private trace",
      errors: [{ message: "private nested error" }],
      code: "private code",
      arbitrary: { private: true },
    });

    expect(result).toBe("A hold action is not available.");
    expect(result).not.toContain("private");
  });
});
