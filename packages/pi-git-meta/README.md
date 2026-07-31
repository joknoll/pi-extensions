# @joknoll/pi-git-meta

Immutable Pi agent provenance records stored with `git-meta`.

The extension stores one complete trace for each top-level agent run. It does not change checked-out files or synchronize metadata.

## Requirements

- Install `git-meta-cli` 0.1.10 or later.
- Configure the Git author name and email.
- Use a trusted, non-bare Git worktree.

## Configuration

```json
{
  "piGitMeta": {
    "enabled": true,
    "maxTraceBytes": 104857600,
    "command": "git-meta"
  }
}
```

Project settings override global settings.

Traces can contain source code, model thoughts, tool results, images, and secrets. The extension does not redact data.

## Commit links

The extension links commits from the same branch and fast-forward path during a run.

If one trace is pending, the next Pi session links later commits from the same branch. This link shows correlation, not authorship.

If multiple traces are pending, attach them manually:

```text
/git-meta status
/git-meta attach [trace-id|all] [ref]
```

## Query traces

List pending trace IDs:

```sh
git meta get project meta:local:pi:pending-traces
```

List traces for a commit:

```sh
git meta get commit:HEAD agent:traces
```

The extension stores trace data as small Base64 chunks. This format avoids the broken large-string path in `git-meta` 0.1.10.

Earlier single-value traces remain subject to that defect. The browser can read traces that use the chunk format.

Open the trace browser from this package directory:

```nu
nu scripts/git-meta-traces.nu
```

Use native `git meta serialize`, `git meta sync`, and `git meta setup` commands when required.

Serialization can include other dirty records from the local `git-meta` database.

## Development

```sh
vp test run
vp pack
```
