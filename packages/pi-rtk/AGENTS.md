# pi-rtk contributor guide

## Purpose

`@joknoll/pi-rtk` is a deliberately thin [Pi](https://pi.dev) integration for [RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer).

It intercepts Pi's native `bash` tool, asks RTK whether the requested shell command should be rewritten, and replaces the command when RTK returns a rewrite. The shell then executes the RTK command and Pi returns its filtered output to the model.

```text
Model requests: git status
        ↓
Pi `tool_call` hook: rtk rewrite "git status"
        ↓
Pi executes: rtk git status
        ↓
Model receives RTK-filtered output
```

The model must not need to know about RTK, be prompted to use RTK, or be required to invoke `rtk` directly.

## Architectural boundary

### Pi owns

- Intercepting `bash` tool calls.
- Probing whether `rtk` is available on `PATH`.
- Calling `rtk rewrite <original-command>` with timeout and cancellation support.
- Replacing the bash command for successful RTK rewrite results.
- Failing open: when anything is unavailable or fails, execute the original command unchanged.

### RTK owns

- Recognizing commands and shell syntax.
- Mapping commands to its subcommands.
- Output filtering, compression, truncation, and summarization.
- Source filtering and all command-specific rules.

**Do not reimplement RTK filtering logic, command registries, parsers, or output compaction in TypeScript.** The `rtk rewrite` process boundary is the single source of truth.

## Scope and non-goals

- Only the built-in Pi `bash` tool is modified.
- Native Pi `read`, `grep`, `find`, and `ls` tools are intentionally untouched because they do not execute shell commands.
- Do not add local compaction to `tool_result` events.
- Do not replace native Pi tools with RTK-backed versions without an explicit, separate design decision.
- Do not inject an RTK-awareness system prompt or add model-visible configuration tools.
- Do not add commands, settings, dashboards, metrics storage, or per-technique toggles.
- Do not special-case individual RTK commands in Pi. Every non-empty bash command is offered to `rtk rewrite`; RTK decides whether it supports it.

This narrow scope avoids policy drift, output corruption, and edit/read semantic mismatches.

## Runtime contract

- Probe once during extension initialization with `rtk --version`.
- If the probe is killed, times out, exits unsuccessfully, or errors, do not notify at startup and leave bash commands unchanged.
- `rtk rewrite` exit codes:
  - `0`: apply non-empty, changed stdout as the rewritten command.
  - `3`: also apply the rewrite automatically. RTK's “ask” verdict is intentionally auto-approved.
  - Any other code: pass through unchanged.
- Never let RTK failures block or replace the requested bash command.
- Do not add startup notifications, a status-bar item, or a system prompt contribution.

## Project layout

```text
src/index.ts     Extension implementation
README.md        User-facing package documentation
package.json     npm/Pi package manifest; declares `dist/index.mjs` as the extension
vite.config.ts   Vite Plus configuration
tsconfig.json    TypeScript configuration
```

The package is distributed as compiled JavaScript. Its Pi manifest points to `./dist/index.mjs`; retain that contract when changing packaging.

`@earendil-works/pi-coding-agent` is a peer dependency because Pi supplies it at runtime. It is also a dev dependency for local type checking.

## Development

Use `vp`, never `npm`:

```bash
# From the repository root
vp install
vp run --filter @joknoll/pi-rtk check
vp run --filter @joknoll/pi-rtk build

# Or from this package directory
vp check
vp run build
```

`vp check` runs formatting, linting, and type checking. Run it after every code change. `vp run build` must succeed before publishing because it produces the package entry point.

There is intentionally no unit-test suite. Keep the implementation small, type-safe, and directly verifiable through the checks above. If adding tests is proposed, first confirm that the project requirements have changed.

## Implementation guidance

- Use `isToolCallEventType("bash", event)` before accessing bash-specific input.
- Pass the full original command as one argument to `rtk rewrite`; do not split or parse shell syntax in TypeScript.
- Forward `ctx.signal` and use bounded timeouts for subprocesses.
- Treat `result.killed`, exceptions, empty stdout, unchanged stdout, and unsupported exit codes as pass-through cases.
- Keep both RTK subprocess calls explicit (`rtk --version`, `rtk rewrite`) and use `pi.exec`, not a shell wrapper.
- Preserve the original command exactly unless RTK supplied a valid replacement.
- Normal startup and rewriting must remain silent.
- Keep README behavior documentation aligned with this file and the implementation.

## Before submitting changes

1. Confirm the change preserves the Pi/RTK responsibility boundary.
2. Confirm native Pi tools and tool results are still untouched.
3. Run `vp run --filter @joknoll/pi-rtk check`.
4. Run `vp run --filter @joknoll/pi-rtk build`.
5. Review the built package manifest: `pi.extensions` must still resolve to `dist/index.mjs`.
