# Pi Coding Agent Extensions

A collection of focused extensions for [Pi](https://pi.dev).

Each package provides one feature and keeps its configuration separate.

## Packages

| Package                                                          | Description                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| [`@joknoll/pi-cache`](packages/pi-cache)                         | Session prompt cache metrics for Pi.                          |
| [`@joknoll/pi-compact`](packages/pi-compact)                     | Review and editing for Pi compaction checkpoints.             |
| [`@joknoll/pi-footer`](packages/pi-footer)                       | Compact footer with Starship support for Pi.                  |
| [`@joknoll/pi-git-meta`](packages/pi-git-meta)                   | Immutable Pi agent provenance records stored with `git-meta`. |
| [`@joknoll/pi-interactive-shell`](packages/pi-interactive-shell) | Bash and Nushell command completion for Pi shell commands.    |
| [`@joknoll/pi-plan`](packages/pi-plan)                           | Strict, keyboard-controlled plan mode for Pi.                 |
| [`@joknoll/pi-rtk`](packages/pi-rtk)                             | Pi integration for RTK command rewriting.                     |
| [`@joknoll/pi-ui`](packages/pi-ui)                               | Custom Pi interface features, except the footer.              |

Open a package README for its requirements, commands, and configuration.

## Install

Install a package through Pi:

```sh
pi install npm:@joknoll/pi-plan
```

Replace `pi-plan` with the required package name.

## Development

Install the workspace dependencies:

```sh
vp install
```

Run all checks, tests, and builds:

```sh
vp run ready
```

Run a package script from its package directory:

```sh
vp test run
vp pack
```

## Architecture

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for the coding harness design model.

The document explains context, tools, orchestration, and their boundaries.
