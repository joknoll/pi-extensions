import type { AutocompleteSuggestions } from "@earendil-works/pi-tui";

export function nuSuggestions(source: string, values: string[]): AutocompleteSuggestions {
  const prefix = source.match(/[^\s]*$/)?.[0] ?? "";
  const beforePrefix = source.slice(0, source.length - prefix.length);
  const qualifier = prefix.slice(0, prefix.lastIndexOf(".") + 1);

  return {
    prefix,
    items: [...new Set(values)].map((completion) => {
      const command = completion.slice(0, completion.lastIndexOf(" ") + 1);
      const value =
        command && beforePrefix.endsWith(command)
          ? completion.slice(command.length)
          : qualifier && !completion.startsWith(qualifier)
            ? qualifier + completion
            : completion;
      return { value, label: completion };
    }),
  };
}

export function shellResult(result: {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}) {
  return {
    output:
      result.stdout && result.stderr
        ? `${result.stdout}${result.stdout.endsWith("\n") ? "" : "\n"}${result.stderr}`
        : result.stdout || result.stderr,
    exitCode: result.killed ? 1 : result.code,
    cancelled: result.killed,
    truncated: false,
  };
}
