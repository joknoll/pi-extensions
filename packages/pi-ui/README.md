# @joknoll/pi-ui

Personal UI customizations for [Pi](https://pi.dev). Footer customization is deliberately kept separate in `@joknoll/pi-footer`.

This extension replaces the stock input editor with a borderless, full-width surface using the theme's `userMessageBg` color. It preserves the stock editor's behavior, keybindings, autocomplete rendering, and distinct shell prompt.

It also replaces the built-in `write` renderer, while delegating to Pi's native write implementation. Write calls now show a Delta-powered, side-by-side diff before execution and retain the final diff after completion. The compact view shows 16 diff rows; expand the tool row to view the full change. If Delta is unavailable, the renderer immediately falls back to Pi's theme-aware split diff.

## Development

```bash
vp run --filter @joknoll/pi-ui test
vp run --filter @joknoll/pi-ui check
vp run --filter @joknoll/pi-ui build
```
