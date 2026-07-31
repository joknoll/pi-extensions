# @joknoll/pi-compact

Review and editing for Pi compaction checkpoints.

Pi retains control of native compaction behavior. This behavior includes context selection, summary merge, output limits, automatic compaction, and overflow recovery.

## Commands

```text
/smart-compact
/smart-compact fast
/smart-compact thorough --model=anthropic/claude-sonnet-4-6 -- focus on auth
/smart-compact balanced --apply
/smart-compact options
/smart-compact status
```

Profiles set summary effort. `fast` uses low effort, `balanced` uses medium effort, and `thorough` uses high effort.

The default command opens the native summary in the configured external editor. It requests confirmation before it applies the summary.

The extension records an unchanged summary as `reviewed`. It records an edited summary as `user-approved` and `--apply` output as `generated`.

The extension adds a limited `## Preserved Evidence` section. This section contains explicit user directives and tool results marked as errors.

Counts show unique entries that the extension preserved or omitted. They do not prove complete or verified coverage.

- Use `--model=provider/id` to select a summary model for one run.
- Use `--apply` to skip the editor and confirmation.
- Add text after `--` to set the native summary focus.
- Use `/smart-compact options` to open options for one run.

## Configuration

Add the optional namespace to `~/.pi/agent/settings.json` or a trusted project `.pi/settings.json`:

```json
{
  "piCompact": {
    "profile": "balanced",
    "summaryModel": null,
    "review": true
  }
}
```

Project settings override global settings.

If the configured model is unavailable, the extension uses the active model and shows a warning.

If a default uses another provider, TUI and RPC users must confirm before Pi sends context.

For non-interactive use, pass the cross-provider model through `--model`. An explicit command or menu selection records consent.

The review uses the Pi `externalEditor` setting and the platform fallback. RPC clients receive a standard extension editor request.

If review is active, use `--apply` in JSON and print modes.

## Failure behavior

- If the selected model fails, native compaction uses the active model.
- If you cancel review, the requested compaction stops without a second error.
- Native `/compact`, automatic compaction, overflow recovery, and tree summaries do not change.
- The extension adds no telemetry, long-term memory, repair calls, or secret-redaction claims.

## Development

```sh
vp test run
vp pack
```
