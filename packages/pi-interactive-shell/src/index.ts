import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { nuSuggestions, shellResult } from "./helpers.ts";

const execFileAsync = promisify(execFile);
const COMPLETION_TIMEOUT_MS = 1_000;
const EXECUTION_TIMEOUT_MS = 120_000;

interface ShellInput {
  prefix: "!" | "!!";
  body: string;
}

function parseShellInput(line: string): ShellInput | undefined {
  const match = /^(\s*)(!!?)(.*)$/.exec(line);
  if (!match) return undefined;
  return { prefix: match[2] as "!" | "!!", body: match[3] };
}

function items(values: string[]): AutocompleteItem[] {
  return [...new Set(values)].map((value) => ({ value, label: value }));
}

async function bashCommandCompletions(prefix: string, signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) return [];
  try {
    // Passing the prefix as $1 keeps incomplete user input out of Bash source code.
    const { stdout } = await execFileAsync(
      "bash",
      ["-lc", 'compgen -c -- "$1"', "bash-complete", prefix],
      {
        timeout: COMPLETION_TIMEOUT_MS,
        signal,
        maxBuffer: 64 * 1024,
      },
    );
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function nuCompletions(source: string, signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) return [];

  const directory = await mkdtemp(join(tmpdir(), "pi-nu-complete-"));
  const file = join(directory, "input.nu");
  try {
    await writeFile(file, source);
    // Nu's IDE interface accepts a cursor byte offset and returns JSON completions.
    const { stdout } = await execFileAsync(
      "nu",
      ["--ide-complete", String(Buffer.byteLength(source)), file],
      {
        timeout: COMPLETION_TIMEOUT_MS,
        signal,
        maxBuffer: 64 * 1024,
      },
    );
    const response: unknown = JSON.parse(stdout);
    if (
      typeof response !== "object" ||
      response === null ||
      !("completions" in response) ||
      !Array.isArray(response.completions)
    ) {
      return [];
    }
    return response.completions.filter(
      (completion): completion is string => typeof completion === "string",
    );
  } catch {
    return [];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function shellAutocomplete(current: AutocompleteProvider): AutocompleteProvider {
  return {
    triggerCharacters: ["!"],
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const line = lines[cursorLine] ?? "";
      const beforeCursor = line.slice(0, cursorCol);
      const shell = parseShellInput(beforeCursor);
      if (!shell) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      // Make the !nu runner discoverable as soon as a user types !n or !!n.
      if (/^n(?:u)?$/.test(shell.body)) {
        return {
          prefix: `${shell.prefix}${shell.body}`,
          items: [
            {
              value: `${shell.prefix}nu `,
              label: `${shell.prefix}nu `,
              description: "Run Nushell code",
            },
          ],
        };
      }

      if (shell.body.startsWith("nu ")) {
        const source = shell.body.slice(3);
        const completions = await nuCompletions(source, options.signal);
        if (options.signal.aborted || completions.length === 0) return null;
        return nuSuggestions(source, completions);
      }

      // Bash's programmable completion API needs an interactive completion context.
      // `compgen -c` is safe and useful for completing the command word; defer later
      // arguments to Pi's normal file completion provider.
      if (!/\s/.test(shell.body)) {
        const completions = await bashCommandCompletions(shell.body, options.signal);
        if (options.signal.aborted || completions.length === 0) return null;
        return { prefix: shell.body, items: items(completions) };
      }

      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
      current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
    shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
      current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true,
  };
}

export default function interactiveShell(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider(shellAutocomplete);
  });

  // !nu <code> and !!nu <code> run code through Nu. The latter retains Pi's
  // built-in hidden-shell semantics (its output is not added to model context).
  pi.on("user_bash", async (event) => {
    if (!event.command.startsWith("nu ")) return;

    const result = await pi.exec("nu", ["--table-mode", "markdown", "-c", event.command.slice(3)], {
      timeout: EXECUTION_TIMEOUT_MS,
    });
    return {
      result: shellResult(result),
    };
  });
}
