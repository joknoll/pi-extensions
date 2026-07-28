import type { CompactionProfile } from "./types.ts";

export interface ParsedArguments {
  action: "run" | "options" | "status" | "help";
  profile?: CompactionProfile;
  model?: string;
  apply: boolean;
  focus?: string;
}

const PROFILES = new Set<CompactionProfile>(["fast", "balanced", "thorough"]);

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"' && index + 1 < input.length)
        token += input[(index += 1)];
      else token += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (quote) throw new Error("Unclosed quote in smart-compact arguments");
  if (token) tokens.push(token);
  return tokens;
}

export function parseArguments(input: string): ParsedArguments {
  const tokens = tokenize(input.trim());
  const first = tokens[0]?.toLowerCase();
  if (first === "status" || first === "help" || first === "options") {
    if (tokens.length > 1) throw new Error(`/${first} does not accept additional arguments`);
    return { action: first, apply: false };
  }

  let profile: CompactionProfile | undefined;
  let model: string | undefined;
  let apply = false;
  const focus: string[] = [];
  let remainder = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (remainder) {
      focus.push(token);
      continue;
    }
    if (token === "--") {
      remainder = true;
    } else if (token === "--apply") {
      apply = true;
    } else if (token === "--model") {
      model = tokens[(index += 1)];
      if (!model) throw new Error("--model requires provider/model");
    } else if (token.startsWith("--model=")) {
      model = token.slice("--model=".length);
      if (!model) throw new Error("--model requires provider/model");
    } else if (!profile && PROFILES.has(token as CompactionProfile)) {
      profile = token as CompactionProfile;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      focus.push(token);
    }
  }
  return { action: "run", profile, model, apply, focus: focus.join(" ").trim() || undefined };
}
