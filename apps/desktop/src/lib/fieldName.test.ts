import { describe, expect, it } from "vitest";
import { fieldNameProblem } from "./fieldName";

describe("fieldNameProblem", () => {
  const others = ["Front", "Extra"];

  it("accepts a new unique name", () => {
    expect(fieldNameProblem("Question", others)).toBeNull();
    expect(fieldNameProblem("السؤال", others)).toBeNull();
  });

  it("rejects empty names", () => {
    expect(fieldNameProblem("   ", others)).toBe("empty");
  });

  it("rejects names another field already uses, ignoring case", () => {
    expect(fieldNameProblem("front", others)).toBe("duplicate");
  });

  it("rejects template syntax, as the backend does", () => {
    for (const bad of ["A:B", "A{B", "A}B", 'A"B', "#A", "^A", "/A"]) {
      expect(fieldNameProblem(bad, others)).toBe("syntax");
    }
  });
});
