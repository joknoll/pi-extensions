# @joknoll/pi-compact

`pi-compact` adds an audited, editable compaction checkpoint to Pi. It is for sessions where losing a constraint, unresolved error, decision, or file state would be costly.

Pi still owns the safe cut point, retained recent context, automatic threshold, overflow recovery, and native `/compact`. This extension only handles compactions explicitly started with `/smart-compact`.

## Usage

```text
/smart-compact
/smart-compact fast
/smart-compact thorough --model=anthropic/claude-sonnet-4-6 -- focus on auth
/smart-compact balanced --apply
/smart-compact options
/smart-compact status
```

The default command runs the Balanced profile, verifies the generated summary, opens it in Pi's configured external editor, and asks before applying it. A changed summary is trusted as a user-approved checkpoint rather than described as machine-verified.

- **Fast** uses a smaller budget and deterministic repairs only.
- **Balanced** uses medium reasoning and may make one repair call.
- **Thorough** keeps more transcript evidence and uses a larger summary budget.
- `--model=provider/id` selects a summary model for one run.
- `--apply` skips editing and confirmation for scripts or non-interactive use.
- Remaining text, preferably after `--`, focuses the summary without changing what is considered critical evidence.

`/smart-compact options` is a per-run menu. It does not rewrite settings.

## Configuration

Add this optional namespace to `~/.pi/agent/settings.json` or a trusted project's `.pi/settings.json`:

```json
{
  "piCompact": {
    "profile": "balanced",
    "summaryModel": null,
    "review": true
  }
}
```

Project values override global values. An unavailable configured summary model falls back to the active model with a warning; an invalid explicit `--model` is rejected.

The review uses Pi's `externalEditor` setting, then `$VISUAL`, then `$EDITOR`, with Pi's platform fallback. RPC clients receive a normal extension editor request. JSON and print modes require `--apply` when review is enabled.

## Failure behavior

- A synthesis or verification failure falls back to native Pi compaction.
- Cancelling review cancels the requested compaction; it does not apply an unreviewed native summary.
- Native `/compact`, automatic compaction, overflow recovery, and tree summaries remain unchanged.
- The extension does not add agent-callable tools, backups, dashboards, telemetry, or long-term memory.

## Development

Use Vite Plus exclusively:

```bash
vp check
vp test
vp run build
```
