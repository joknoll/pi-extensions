import { Type, type Static } from "typebox";

export const OTHER_LABEL = "Other";

const QuestionOptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 120 }),
    impact: Type.String({ minLength: 1, maxLength: 300 }),
  },
  { additionalProperties: false },
);

const questionBase = {
  id: Type.String({ minLength: 1, maxLength: 64 }),
  header: Type.String({ minLength: 1, maxLength: 80 }),
  question: Type.String({ minLength: 1, maxLength: 500 }),
};

const SingleChoiceQuestionSchema = Type.Object(
  {
    ...questionBase,
    type: Type.Literal("single_choice"),
    options: Type.Array(QuestionOptionSchema, { minItems: 2, maxItems: 4 }),
  },
  { additionalProperties: false },
);

const MultipleChoiceQuestionSchema = Type.Object(
  {
    ...questionBase,
    type: Type.Literal("multiple_choice"),
    options: Type.Array(QuestionOptionSchema, { minItems: 2, maxItems: 4 }),
  },
  { additionalProperties: false },
);

const YesNoQuestionSchema = Type.Object(
  { ...questionBase, type: Type.Literal("yes_no") },
  { additionalProperties: false },
);

const EssayQuestionSchema = Type.Object(
  { ...questionBase, type: Type.Literal("essay") },
  { additionalProperties: false },
);

export const PlanQuestionSchema = Type.Union([
  SingleChoiceQuestionSchema,
  MultipleChoiceQuestionSchema,
  YesNoQuestionSchema,
  EssayQuestionSchema,
]);

export const PlanQuestionsParamsSchema = Type.Object(
  { questions: Type.Array(PlanQuestionSchema, { minItems: 1, maxItems: 3 }) },
  { additionalProperties: false },
);

export type QuestionOption = Static<typeof QuestionOptionSchema>;
export type SingleChoiceQuestion = Static<typeof SingleChoiceQuestionSchema>;
export type MultipleChoiceQuestion = Static<typeof MultipleChoiceQuestionSchema>;
export type YesNoQuestion = Static<typeof YesNoQuestionSchema>;
export type EssayQuestion = Static<typeof EssayQuestionSchema>;
export type PlanQuestion = Static<typeof PlanQuestionSchema>;
export type PlanQuestionsParams = Static<typeof PlanQuestionsParamsSchema>;

export type SingleChoiceAnswer = {
  id: string;
  type: "single_choice";
  label: string;
  other?: string;
};
export type MultipleChoiceAnswer = {
  id: string;
  type: "multiple_choice";
  labels: string[];
  other?: string;
};
export type YesNoAnswer = { id: string; type: "yes_no"; answer: boolean };
export type EssayAnswer = { id: string; type: "essay"; text: string };
export type PlanAnswer = SingleChoiceAnswer | MultipleChoiceAnswer | YesNoAnswer | EssayAnswer;
export type PlanQuestionsResult = { cancelled: boolean; answers: PlanAnswer[] };

function normalizeOptions(options: readonly QuestionOption[]): QuestionOption[] | undefined {
  const normalized = options.map((option) => ({
    label: option.label.trim(),
    impact: option.impact.trim(),
  }));
  if (normalized.some((option) => !option.label || !option.impact)) return undefined;
  const labels = normalized.map((option) => option.label.toLowerCase());
  if (new Set(labels).size !== labels.length) return undefined;
  if (labels.some((label) => label === OTHER_LABEL.toLowerCase())) return undefined;
  return normalized;
}

/** Trims and validates question text; rejects duplicate IDs, duplicate option labels,
 * and options that collide with the synthetic "Other" answer. Returns a new array
 * rather than mutating the input, or undefined if any question is invalid. */
export function normalizeQuestions(questions: readonly PlanQuestion[]): PlanQuestion[] | undefined {
  const ids = new Set<string>();
  const normalized: PlanQuestion[] = [];
  for (const question of questions) {
    const id = question.id.trim();
    const header = question.header.trim();
    const prompt = question.question.trim();
    if (!id || !header || !prompt || ids.has(id)) return undefined;
    ids.add(id);
    if (question.type === "single_choice" || question.type === "multiple_choice") {
      const options = normalizeOptions(question.options);
      if (!options) return undefined;
      normalized.push({ ...question, id, header, question: prompt, options });
    } else {
      normalized.push({ ...question, id, header, question: prompt });
    }
  }
  return normalized;
}
