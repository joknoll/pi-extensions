# @joknoll/pi-rtk

A thin [Pi](https://pi.dev) extension for [RTK](https://github.com/rtk-ai/rtk).

It intercepts Pi's native `bash` tool and delegates every command to `rtk rewrite`. RTK alone decides whether and how to rewrite a command; Pi executes the rewritten command and the model receives its filtered output.

## Requirements

- Pi
- `rtk` on `PATH`

If RTK is unavailable, unsupported, times out, or fails, the original bash command runs unchanged.

## Scope

Only Pi's `bash` tool is intercepted. Pi's native `read`, `grep`, `find`, and `ls` tools run directly and are intentionally not modified.

RTK exit-code 3 (“ask”) rewrites are applied automatically. The extension has no configuration, commands, or prompt injection.

## Development

```bash
vp run --filter @joknoll/pi-rtk check
vp run --filter @joknoll/pi-rtk build
```
