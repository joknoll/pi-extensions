# @joknoll/pi-interactive-shell

Pi extension providing shell-mode completion.

- `!command` and `!!command` complete Bash command names.
- `!nu <code>` and `!!nu <code>` run Nushell code and use Nu's `--ide-complete` API for completion.
- `!!` preserves Pi's hidden-shell behavior: output is not sent to the model.

Nushell must be available as `nu` on `PATH`. Bash completion currently covers command names; Pi's normal path completion handles subsequent arguments.

## Development

```sh
vp run --filter @joknoll/pi-interactive-shell check
vp run --filter @joknoll/pi-interactive-shell build
```
