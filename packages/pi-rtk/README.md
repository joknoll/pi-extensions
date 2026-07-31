# @joknoll/pi-rtk

Pi integration for [RTK](https://github.com/rtk-ai/rtk) command rewriting.

The extension sends each Pi `bash` command to `rtk rewrite`. RTK decides whether to rewrite the command.

Pi runs the result and sends the filtered output to the model.

## Requirements

- [Pi](https://pi.dev)
- `rtk` on `PATH`

If RTK fails, times out, or does not support a command, Pi runs the original command.

## Scope

The extension changes only the Pi `bash` tool. The `read`, `grep`, `find`, and `ls` tools run without changes.

The extension applies RTK exit code 3 (`ask`) rewrites automatically. It has no configuration, commands, or prompt injection.

## Development

```sh
vp pack
```
