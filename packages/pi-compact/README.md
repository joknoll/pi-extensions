# @joknoll/pi-compact

`pi-compact` adds a reviewed, editable checkpoint around Pi's native compaction. Pi still owns the cut point, retained recent context, previous-summary merging, split turns, output budget, structured summary, file metadata, automatic threshold, overflow recovery, and native `/compact`.

## Usage

```text
/smart-compact
/smart-compact fast
/smart-compact thorough --model=anthropic/claude-sonnet-4-6 -- focus on auth
/smart-compact balanced --apply
/smart-compact options
/smart-compact status
```

Profiles map directly to summary reasoning: Fast uses low, Balanced medium, and Thorough high. The default command opens Pi's native summary in the configured external editor and asks before applying it. An unchanged reviewed summary is recorded as `reviewed`; an edited summary as `user-approved`; and `--apply` output as `generated`.

The extension adds a bounded `## Preserved Evidence` appendix containing explicit user directive lines and tool results explicitly marked as errors. Counts report how many unique entries were preserved or omitted by the bound; they do not claim complete coverage or machine verification.

- `--model=provider/id` explicitly selects and consents to a summary model for one run.
- `--apply` skips editing and confirmation for scripts or non-interactive use.
- Remaining text, preferably after `--`, supplies Pi's native custom summary focus.
- `/smart-compact options` is a per-run menu and does not rewrite settings.

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

Project values override global values. An unavailable configured model falls back to the active model with a warning. If a configured default uses a different provider than the active model, TUI and RPC users must confirm before context is sent; non-interactive use must pass that model explicitly with `--model`. Explicit command and menu selection show a cross-provider warning and count as consent.

The review uses Pi's `externalEditor` setting and platform fallback. RPC clients receive a normal extension editor request. JSON and print modes require `--apply` when review is enabled.

## Failure behavior

- If the selected summary model fails, Pi's native compaction runs with its normal active model.
- Cancelling review cancels the requested compaction without surfacing a second error notification.
- Native `/compact`, automatic compaction, overflow recovery, and tree summaries remain unchanged.
- The extension does not add transcript serialization, secret-redaction claims, verification scoring, repair calls, telemetry, or long-term memory.

## Development

Use Vite Plus exclusively:

```bash
vp check
vp test
vp run build
```
