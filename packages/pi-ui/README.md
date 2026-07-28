# @joknoll/pi-ui

Personal UI customizations for [Pi](https://pi.dev). Footer customization is deliberately kept separate in `@joknoll/pi-footer`.

Currently this extension replaces the stock input editor with a borderless, full-width surface using the theme's `userMessageBg` color. It preserves the stock editor's behavior, keybindings, autocomplete rendering, and distinct shell prompt.

## Development

```bash
vp run --filter @joknoll/pi-ui test
vp run --filter @joknoll/pi-ui check
vp run --filter @joknoll/pi-ui build
```
