# @joknoll/pi-footer

Compact footer with Starship support for Pi.

The footer shows:

- The current directory
- The active plan mode status
- The selected model
- The thinking level
- Session prompt and output totals
- Cache read and write totals
- Context window use

[Starship](https://starship.rs/) can style the current directory. If Starship fails or is unavailable, the footer shows the plain directory.

## Extension status

The package replaces the Pi footer through `ctx.ui.setFooter()`.

Publish short values through `ctx.ui.setStatus()`. Do not install a second footer.

The footer supports the `plan-mode` and `pi-cache` status keys.
