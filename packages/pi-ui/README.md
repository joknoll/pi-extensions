# @joknoll/pi-ui

Personal UI customizations for [Pi](https://pi.dev). Footer customization is deliberately kept separate in `@joknoll/pi-footer`.

This extension replaces the stock input editor with a borderless, full-width surface using the theme's `userMessageBg` color. It preserves the stock editor's behavior, keybindings, autocomplete rendering, and distinct shell prompt.

It replaces the built-in `edit` renderer while delegating execution to Pi's native edit tool. Edit calls use a native, theme-aware diff with syntax highlighting, word-level emphasis, accurate line gutters, and an adaptive split/unified layout. The compact view shows 16 logical diff rows; expand the tool row to view the full change. Write calls use Pi's built-in renderer, with no external diff process.

## Development

```bash
vp run --filter @joknoll/pi-ui test
vp run --filter @joknoll/pi-ui check
vp run --filter @joknoll/pi-ui build
```
