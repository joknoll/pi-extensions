# @joknoll/pi-interactive-shell

Bash and Nushell command completion for Pi shell commands.

- Use `!command` or `!!command` to complete Bash command names.
- Use `!nu <code>` or `!!nu <code>` to run Nushell code with completion.
- Use `!!` to keep command output hidden from the model.

The extension uses the Nushell `--ide-complete` API. Install `nu` on `PATH` before you use Nushell completion.

Bash completion supports command names. Pi handles path completion for later arguments.

## Development

```sh
vp test run
vp pack
```
