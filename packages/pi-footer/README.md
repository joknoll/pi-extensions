# @joknoll/pi-footer

A packaged version of the author's Pi footer configuration.

It renders a single line with:

- the current directory, styled by optional [Starship](https://starship.rs/);
- the active plan-mode status, when present;
- the selected model;
- thinking level;
- session prompt/output totals (including cache reads and writes); and
- context-window utilization.

Starship is optional. If it is unavailable or errors, the footer displays the
plain working directory.

## Notes

This package intentionally mirrors the original local footer before further
design changes. It replaces Pi's footer with `ctx.ui.setFooter()`, so other
extensions should publish short values via `ctx.ui.setStatus()` rather than
installing a second footer. This footer currently renders the `plan-mode`
status key. It also renders the `pi-cache` status when that extension is installed.
