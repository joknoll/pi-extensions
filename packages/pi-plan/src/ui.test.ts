import { describe, expect, test } from "vite-plus/test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { showPlanQuestion } from "./ui.ts";
import type {
  EssayAnswer,
  EssayQuestion,
  MultipleChoiceAnswer,
  MultipleChoiceQuestion,
  SingleChoiceAnswer,
  SingleChoiceQuestion,
  YesNoAnswer,
  YesNoQuestion,
} from "./questions.ts";

const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  enter: "\r",
  escape: "\x1b",
  ctrlC: "\x03",
  space: " ",
};

interface Component {
  handleInput(data: string): void;
  invalidate(): void;
  render(width: number): string[];
}

function makeCtx() {
  let current: Component | undefined;
  const inputAnswers: Array<string | undefined> = [];
  const editorAnswers: Array<string | undefined> = [];
  const editorCalls: Array<{ title: string; prefill?: string }> = [];
  const ctx = {
    mode: "tui",
    cwd: "/",
    ui: {
      theme: { getBgAnsi: () => "" },
      custom: (factory: (...args: unknown[]) => Component) =>
        new Promise((resolve) => {
          current = factory(
            { requestRender: () => {}, stop: () => {}, start: () => {} },
            {},
            {},
            resolve,
          );
        }),
      input: async () => inputAnswers.shift(),
      editor: async (title: string, prefill?: string) => {
        editorCalls.push({ title, prefill });
        return editorAnswers.shift();
      },
    },
  } as unknown as ExtensionContext;
  async function send(key: string): Promise<void> {
    current?.handleInput(key);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { ctx, send, inputAnswers, editorAnswers, editorCalls };
}

const singleChoiceQuestion: SingleChoiceQuestion = {
  id: "sc",
  header: "Header",
  question: "Which?",
  type: "single_choice",
  options: [
    { label: "A", impact: "a" },
    { label: "B", impact: "b" },
  ],
};

const multipleChoiceQuestion: MultipleChoiceQuestion = {
  id: "mc",
  header: "Header",
  question: "Pick some",
  type: "multiple_choice",
  options: [
    { label: "A", impact: "a" },
    { label: "B", impact: "b" },
    { label: "C", impact: "c" },
  ],
};

const yesNoQuestion: YesNoQuestion = {
  id: "yn",
  header: "Header",
  question: "OK?",
  type: "yes_no",
};
const essayQuestion: EssayQuestion = {
  id: "es",
  header: "Header",
  question: "Explain",
  type: "essay",
};

describe("single choice question", () => {
  test("selects a declared option", async () => {
    const { ctx, send } = makeCtx();
    const promise = showPlanQuestion(ctx, singleChoiceQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "sc", type: "single_choice", label: "B" } });
  });

  test("selecting Other opens an input for a custom answer", async () => {
    const { ctx, send, inputAnswers } = makeCtx();
    inputAnswers.push("custom reason");
    const promise = showPlanQuestion(ctx, singleChoiceQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.down);
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "sc", type: "single_choice", label: "Other", other: "custom reason" },
    });
  });

  test("cancelling the Other input returns to the question instead of cancelling the batch", async () => {
    const { ctx, send, inputAnswers } = makeCtx();
    inputAnswers.push(undefined, "final answer");
    const promise = showPlanQuestion(ctx, singleChoiceQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.down);
    await send(KEY.enter);
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "sc", type: "single_choice", label: "Other", other: "final answer" },
    });
  });

  test("restores the previous selection when revisited", async () => {
    const { ctx, send } = makeCtx();
    const previous: SingleChoiceAnswer = { id: "sc", type: "single_choice", label: "B" };
    const promise = showPlanQuestion(ctx, singleChoiceQuestion, previous, 0, 1);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "sc", type: "single_choice", label: "B" } });
  });

  test("left/right report navigation intent", async () => {
    const { ctx, send } = makeCtx();
    let promise = showPlanQuestion(ctx, singleChoiceQuestion, undefined, 0, 2);
    await send(KEY.right);
    expect(await promise).toBe("next");
    promise = showPlanQuestion(ctx, singleChoiceQuestion, undefined, 1, 2);
    await send(KEY.left);
    expect(await promise).toBe("previous");
  });
});

describe("multiple choice question", () => {
  test("ignores submit with nothing selected, then submits once something is toggled", async () => {
    const { ctx, send } = makeCtx();
    const promise = showPlanQuestion(ctx, multipleChoiceQuestion, undefined, 0, 1);
    await send(KEY.enter);
    await send(KEY.space);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "mc", type: "multiple_choice", labels: ["A"] } });
  });

  test("returns labels in declared option order regardless of toggle order", async () => {
    const { ctx, send } = makeCtx();
    const promise = showPlanQuestion(ctx, multipleChoiceQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.down);
    await send(KEY.space);
    await send(KEY.up);
    await send(KEY.up);
    await send(KEY.space);
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "mc", type: "multiple_choice", labels: ["A", "C"] },
    });
  });

  test("Other: deselecting and reselecting allows the value to change, cancel keeps prior state", async () => {
    const { ctx, send, inputAnswers } = makeCtx();
    inputAnswers.push("first note", undefined, "second note");
    const promise = showPlanQuestion(ctx, multipleChoiceQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.down);
    await send(KEY.down);
    await send(KEY.space); // select Other -> "first note"
    await send(KEY.space); // deselect Other
    await send(KEY.space); // reselect -> cancelled input -> stays deselected
    await send(KEY.space); // reselect -> "second note"
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "mc", type: "multiple_choice", labels: ["Other"], other: "second note" },
    });
  });

  test("restores previous selections including Other", async () => {
    const { ctx, send } = makeCtx();
    const previous: MultipleChoiceAnswer = {
      id: "mc",
      type: "multiple_choice",
      labels: ["B", "Other"],
      other: "note",
    };
    const promise = showPlanQuestion(ctx, multipleChoiceQuestion, previous, 0, 1);
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "mc", type: "multiple_choice", labels: ["B", "Other"], other: "note" },
    });
  });
});

describe("yes/no question", () => {
  test("Yes maps to true and No maps to false", async () => {
    const { ctx, send } = makeCtx();
    let promise = showPlanQuestion(ctx, yesNoQuestion, undefined, 0, 1);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "yn", type: "yes_no", answer: true } });

    promise = showPlanQuestion(ctx, yesNoQuestion, undefined, 0, 1);
    await send(KEY.down);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "yn", type: "yes_no", answer: false } });
  });

  test("restores the previous boolean answer", async () => {
    const { ctx, send } = makeCtx();
    const previous: YesNoAnswer = { id: "yn", type: "yes_no", answer: false };
    const promise = showPlanQuestion(ctx, yesNoQuestion, previous, 0, 1);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "yn", type: "yes_no", answer: false } });
  });
});

describe("essay question", () => {
  test("opens the editor and accepts multiline content", async () => {
    const { ctx, send, editorAnswers } = makeCtx();
    editorAnswers.push("line one\nline two");
    const promise = showPlanQuestion(ctx, essayQuestion, undefined, 0, 1);
    await send(KEY.enter);
    expect(await promise).toEqual({
      answer: { id: "es", type: "essay", text: "line one\nline two" },
    });
  });

  test("cancelling or submitting empty content returns to the question frame", async () => {
    const { ctx, send, editorAnswers } = makeCtx();
    editorAnswers.push(undefined, "   ", "real answer");
    const promise = showPlanQuestion(ctx, essayQuestion, undefined, 0, 1);
    await send(KEY.enter);
    await send(KEY.enter);
    await send(KEY.enter);
    expect(await promise).toEqual({ answer: { id: "es", type: "essay", text: "real answer" } });
  });

  test("prefills the editor with the previous answer", async () => {
    const { ctx, send, editorAnswers, editorCalls } = makeCtx();
    editorAnswers.push("edited text");
    const previous: EssayAnswer = { id: "es", type: "essay", text: "old text" };
    const promise = showPlanQuestion(ctx, essayQuestion, previous, 0, 1);
    await send(KEY.enter);
    await promise;
    expect(editorCalls[0]?.prefill).toBe("old text");
  });
});

describe("cancellation", () => {
  test("escape or ctrl+c cancels every question type", async () => {
    for (const [question, key] of [
      [singleChoiceQuestion, KEY.escape],
      [multipleChoiceQuestion, KEY.ctrlC],
      [yesNoQuestion, KEY.escape],
      [essayQuestion, KEY.ctrlC],
    ] as const) {
      const { ctx, send } = makeCtx();
      const promise = showPlanQuestion(ctx, question, undefined, 0, 1);
      await send(key);
      expect(await promise).toBeUndefined();
    }
  });
});
