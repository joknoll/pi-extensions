# @joknoll/pi-ui

Custom interface features for [Pi](https://pi.dev). The separate `@joknoll/pi-footer` package provides footer changes.

## Input editor

The extension replaces the standard input editor with a borderless, full-width editor.

The editor uses the theme `userMessageBg` color. It keeps standard behavior, key bindings, autocomplete, and the shell prompt.

## Edit display

The extension replaces the standard `edit` display. Pi still runs its native edit tool.

The display provides:

- Theme-aware diffs
- Syntax highlighting
- Word-level emphasis
- Accurate line gutters
- Adaptive split and unified layouts

The compact view shows 16 logical diff rows. Expand the tool row to show the full change.

The extension uses the standard Pi display for `write` calls. It does not start an external diff process.

## Development

```sh
vp test run
vp pack
```
