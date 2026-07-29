import { describe, expect, test } from "vite-plus/test";
import { Check } from "typebox/value";
import {
  normalizeQuestions,
  OTHER_LABEL,
  PlanQuestionsParamsSchema,
  type PlanQuestion,
} from "./questions.ts";

const option = (label: string, impact = "impact") => ({ label, impact });

const singleChoice: PlanQuestion = {
  id: "sc",
  header: "Header",
  question: "Which?",
  type: "single_choice",
  options: [option("A"), option("B")],
};
const multipleChoice: PlanQuestion = {
  id: "mc",
  header: "Header",
  question: "Which ones?",
  type: "multiple_choice",
  options: [option("A"), option("B")],
};

describe("plan question schema", () => {
  test("accepts each valid variant and a mixed batch", () => {
    expect(Check(PlanQuestionsParamsSchema, { questions: [singleChoice] })).toBe(true);
    expect(Check(PlanQuestionsParamsSchema, { questions: [multipleChoice] })).toBe(true);
    expect(Check(PlanQuestionsParamsSchema, { questions: [singleChoice, multipleChoice] })).toBe(
      true,
    );
  });

  test("rejects a question missing the type discriminator", () => {
    const { type: _type, ...withoutType } = singleChoice;
    expect(Check(PlanQuestionsParamsSchema, { questions: [withoutType] })).toBe(false);
  });

  test("rejects removed and unknown question types", () => {
    for (const type of ["yes_no", "essay", "unknown"]) {
      expect(
        Check(PlanQuestionsParamsSchema, {
          questions: [{ id: "q", header: "Header", question: "Prompt", type }],
        }),
      ).toBe(false);
    }
  });

  test("rejects unknown extra properties", () => {
    expect(
      Check(PlanQuestionsParamsSchema, { questions: [{ ...singleChoice, extra: "nope" }] }),
    ).toBe(false);
  });

  test("rejects option counts outside 2-4", () => {
    expect(
      Check(PlanQuestionsParamsSchema, {
        questions: [{ ...singleChoice, options: [option("A")] }],
      }),
    ).toBe(false);
    expect(
      Check(PlanQuestionsParamsSchema, {
        questions: [
          {
            ...singleChoice,
            options: [option("A"), option("B"), option("C"), option("D"), option("E")],
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("normalizeQuestions", () => {
  test("trims whitespace without mutating the input", () => {
    const input: PlanQuestion = {
      ...singleChoice,
      id: "  sc  ",
      header: "  Header  ",
      question: "  Which?  ",
      options: [option(" A "), option("B", " impact ")],
    };
    const original = structuredClone(input);
    const normalized = normalizeQuestions([input]);
    expect(input).toEqual(original);
    const result = normalized?.[0] as typeof singleChoice | undefined;
    expect(result).toMatchObject({ id: "sc", header: "Header", question: "Which?" });
    expect(result?.options).toEqual([option("A"), option("B")]);
  });

  test("rejects duplicate question ids", () => {
    expect(
      normalizeQuestions([singleChoice, { ...multipleChoice, id: singleChoice.id }]),
    ).toBeUndefined();
  });

  test("rejects duplicate option labels case-insensitively", () => {
    expect(
      normalizeQuestions([{ ...singleChoice, options: [option("A"), option("a")] }]),
    ).toBeUndefined();
  });

  test("rejects options that collide with the reserved Other label", () => {
    expect(
      normalizeQuestions([{ ...singleChoice, options: [option(OTHER_LABEL), option("B")] }]),
    ).toBeUndefined();
    expect(
      normalizeQuestions([{ ...singleChoice, options: [option("other"), option("B")] }]),
    ).toBeUndefined();
  });
});
