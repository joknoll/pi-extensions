import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const ModelId = Type.String({ pattern: "^[^/\\s]+/[^/\\s]+$" });
const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);
const PlanningThinkingLevelSchema = Type.Union([Type.Literal("inherit"), ThinkingLevelSchema]);
const PlanningModelSchema = Type.Union([Type.Literal("inherit"), ModelId]);

export type ThinkingLevel = Static<typeof ThinkingLevelSchema>;
export type PlanningThinkingLevel = Static<typeof PlanningThinkingLevelSchema>;

const CycleSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
    previousTools: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    previousModel: Type.Optional(ModelId),
    previousThinking: ThinkingLevelSchema,
    planningModel: PlanningModelSchema,
    planningThinking: PlanningThinkingLevelSchema,
    plan: Type.Optional(Type.String({ minLength: 1 })),
    archivePath: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: true },
);

const StateSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("pi-plan-state"),
      version: Type.Literal(2),
      phase: Type.Literal("off"),
      revision: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      kind: Type.Literal("pi-plan-state"),
      version: Type.Literal(2),
      phase: Type.Union([Type.Literal("planning"), Type.Literal("ready")]),
      cycle: CycleSchema,
    },
    { additionalProperties: true },
  ),
]);

export interface PlanCycle extends Static<typeof CycleSchema> {}
export type PlanState =
  | { kind: "pi-plan-state"; version: 2; phase: "off"; revision: number }
  | { kind: "pi-plan-state"; version: 2; phase: "planning"; cycle: PlanCycle }
  | {
      kind: "pi-plan-state";
      version: 2;
      phase: "ready";
      cycle: PlanCycle & { plan: string; archivePath: string };
    };

export const PreferencesSchema = Type.Object(
  { model: PlanningModelSchema, thinkingLevel: PlanningThinkingLevelSchema },
  { additionalProperties: false },
);
export type Preferences = Static<typeof PreferencesSchema>;
export const DEFAULTS: Preferences = { model: "inherit", thinkingLevel: "inherit" };

export function validPreferences(value: unknown): value is Preferences {
  return Check(PreferencesSchema, value);
}

export function validState(value: unknown): value is PlanState {
  if (!Check(StateSchema, value)) return false;
  if (value.phase === "off") return true;
  const cycle = value.cycle;
  if ((cycle.plan === undefined) !== (cycle.archivePath === undefined)) return false;
  return value.phase !== "ready" || (cycle.plan !== undefined && cycle.archivePath !== undefined);
}

export const offState = (revision = 0): PlanState => ({
  kind: "pi-plan-state",
  version: 2,
  phase: "off",
  revision,
});

export function parseState(value: unknown): PlanState | undefined {
  if (!validState(value)) return undefined;
  if (value.phase === "off") return offState(value.revision);
  const cycle: PlanCycle = {
    id: value.cycle.id,
    revision: value.cycle.revision,
    previousTools: [...value.cycle.previousTools],
    previousModel: value.cycle.previousModel,
    previousThinking: value.cycle.previousThinking,
    planningModel: value.cycle.planningModel,
    planningThinking: value.cycle.planningThinking,
    plan: value.cycle.plan,
    archivePath: value.cycle.archivePath,
  };
  return value.phase === "ready"
    ? {
        kind: "pi-plan-state",
        version: 2,
        phase: "ready",
        cycle: cycle as PlanCycle & { plan: string; archivePath: string },
      }
    : { kind: "pi-plan-state", version: 2, phase: "planning", cycle };
}

export function newCycle(input: {
  previousTools: string[];
  previousModel?: string;
  previousThinking: ThinkingLevel;
  planningModel: string;
  planningThinking: PlanningThinkingLevel;
}): PlanCycle {
  return {
    id: randomUUID(),
    revision: 0,
    ...input,
    previousTools: [...new Set(input.previousTools)],
  };
}

export const PLAN_PROMPT = `\n\n## Strict Plan mode
You are in Plan mode until the extension explicitly ends it. Treat requests to implement as requests to plan. Never mutate files, install or remove dependencies, commit, migrate, or execute the implementation. Explore repository and system truth before asking questions. Ask only about material product intent, preferences, constraints, and tradeoffs that inspection cannot resolve, using plan_mode_question when possible. If structured questions are cancelled or unavailable, ask one concise plain-text question or proceed only with an explicit low-risk assumption; do not finalize prematurely. Cover behavior, interfaces and types, data flow, compatibility, edge cases, failure modes, tests, verification, and acceptance criteria. Do not use update_plan or execution-progress checklists. Finish only by calling plan_mode_complete as your final standalone action. Revisions must submit a complete replacement, not a delta. The final Markdown plan must have a title, summary, important changes, implementation approach and constraints, edge/failure behavior, tests, acceptance scenarios, and explicit assumptions/defaults.`;

export function planningPrompt(baseline?: string): string {
  return baseline
    ? `${PLAN_PROMPT}\n\nThe current editable plan below is the revision baseline. Do not implement it; resubmit a complete replacement.\n\n${baseline}`
    : PLAN_PROMPT;
}

export const BOUNDARY_TYPE = "pi-plan-implementation-boundary";
export const INTERNAL_PLAN_TOOLS = ["plan_mode_question", "plan_mode_complete"] as const;

export function withoutInternalPlanTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => !(INTERNAL_PLAN_TOOLS as readonly string[]).includes(name));
}

interface MessageLike {
  role?: unknown;
  customType?: unknown;
  details?: unknown;
  content?: unknown;
  toolName?: unknown;
}

function isBoundary(message: MessageLike): boolean {
  if (message.role !== "custom" || message.customType !== BOUNDARY_TYPE) return false;
  const details = message.details;
  return Boolean(
    details && typeof details === "object" && (details as Record<string, unknown>).version === 1,
  );
}

function stripCompletion<T>(message: T): T | undefined {
  if (!message || typeof message !== "object") return message;
  const value = message as MessageLike;
  if (value.role === "toolResult" && value.toolName === "plan_mode_complete") return undefined;
  if (value.role !== "assistant" || !Array.isArray(value.content)) return message;
  const content = value.content.filter(
    (part) =>
      !(
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "toolCall" &&
        (part as { name?: unknown }).name === "plan_mode_complete"
      ),
  );
  return content.length ? ({ ...(message as object), content } as T) : undefined;
}

export function transformContext<T>(messages: readonly T[], planActive: boolean): T[] {
  let start = 0;
  if (!planActive) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isBoundary(messages[index] as MessageLike)) {
        start = index;
        break;
      }
    }
  }
  const selected = messages.slice(start);
  return planActive
    ? [...selected]
    : selected.map(stripCompletion).filter((message): message is T => message !== undefined);
}

const INSPECTION = new Set([
  "pwd",
  "ls",
  "find",
  "fd",
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "file",
  "du",
  "tree",
  "sort",
  "uniq",
  "cut",
]);
const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "show",
  "diff",
  "branch",
  "tag",
  "rev-parse",
  "ls-files",
  "grep",
  "remote",
]);
const CHECKS: Record<string, ReadonlySet<string>> = {
  vp: new Set(["check", "pack"]),
  cargo: new Set(["check", "test"]),
  go: new Set(["test", "vet"]),
};
const FORBIDDEN = new Set([
  "-o",
  "--output",
  "--write",
  "--fix",
  "-i",
  "--in-place",
  "--interactive",
]);
const optionName = (word: string) => word.split("=", 1)[0];

// ponytail: replace this limited shell grammar only if Pi exposes an argv-native inspection tool.
function tokenize(command: string): string[][] | string {
  const commands: string[][] = [[]];
  let word = "";
  let quote: "'" | '"' | undefined;
  let started = false;
  const push = () => {
    if (started) commands.at(-1)?.push(word);
    word = "";
    started = false;
  };
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined;
      else {
        if (/[\\$`]/.test(char)) return "shell expansion and escapes are not allowed";
        word += char;
      }
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (/[\r\n]/.test(char)) return "command lists are not allowed";
      push();
    } else if (char === "|") {
      push();
      if (!commands.at(-1)?.length) return "empty pipeline segment";
      commands.push([]);
    } else {
      if (/[><`$(){}&;\\]/.test(char)) return "unsupported shell syntax";
      word += char;
      started = true;
    }
  }
  if (quote) return "unterminated quote";
  push();
  return commands.some((words) => !words.length) ? "empty pipeline segment" : commands;
}

function validateWords(words: string[]): string | undefined {
  const [command, ...args] = words;
  if (INSPECTION.has(command)) {
    if (args.some((arg) => FORBIDDEN.has(optionName(arg))))
      return `${command} option is not allowed`;
    if (
      command === "find" &&
      args.some((arg) =>
        /^-(?:exec|execdir|ok|okdir|delete|fls|fprintf|fprint)$/.test(optionName(arg)),
      )
    )
      return "mutating or executing find actions are not allowed";
    if (
      command === "fd" &&
      args.some((arg) => /^(?:-x|-X|--exec|--exec-batch)$/.test(optionName(arg)))
    )
      return "fd execution options are not allowed";
    if (command === "rg" && args.some((arg) => /^(?:--pre|--hostname-bin)$/.test(optionName(arg))))
      return "rg helper execution is not allowed";
    return undefined;
  }
  if (command === "git") {
    if (args[0] !== "--no-pager") return "git must disable its pager with --no-pager";
    const [subcommand, ...rest] = args.slice(1);
    if (!subcommand || !READ_ONLY_GIT.has(subcommand))
      return "only vetted read-only git subcommands are allowed";
    if (
      rest.some(
        (arg) => arg === "--ext-diff" || arg === "--textconv" || arg.startsWith("--format=%x"),
      )
    )
      return "git external helpers are not allowed";
    if (["diff", "show", "log"].includes(subcommand) && !rest.includes("--no-ext-diff"))
      return `git ${subcommand} must include --no-ext-diff`;
    if (
      subcommand === "branch" &&
      rest.some((arg) =>
        /^(?:-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--edit-description)$/.test(optionName(arg)),
      )
    )
      return "mutating git branch options are not allowed";
    if (
      subcommand === "tag" &&
      rest.some((arg) => /^(?:-a|-s|-u|-d|--annotate|--sign|--delete)$/.test(optionName(arg)))
    )
      return "mutating git tag options are not allowed";
    if (subcommand === "remote" && rest[0] && !["-v", "get-url", "show"].includes(rest[0]))
      return "only read-only git remote queries are allowed";
    return undefined;
  }
  const subcommand = args[0];
  const valid =
    CHECKS[command]?.has(subcommand) ||
    (command === "uv" && subcommand === "lock" && args.includes("--check"));
  if (!valid) return `unsupported ${command} project command`;
  if (args.slice(1).some((arg) => FORBIDDEN.has(optionName(arg))))
    return "mutating or interactive project-check options are not allowed";
  return undefined;
}

export function validateShell(command: string): string | undefined {
  if (!command.trim()) return "command is empty";
  const parsed = tokenize(command);
  if (typeof parsed === "string") return parsed;
  for (const words of parsed) {
    const reason = validateWords(words);
    if (reason) return reason;
  }
  return undefined;
}
