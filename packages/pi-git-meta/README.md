# @joknoll/pi-git-meta

Stores one complete Pi trace for each top-level agent run in `git-meta`. It never changes checked-out files or synchronizes metadata automatically.

Install `git-meta-cli` 0.1.10 or newer and configure Git author name/email. The extension runs only in trusted non-bare Git worktrees.

```json
{
  "piGitMeta": {
    "enabled": true,
    "maxTraceBytes": 104857600,
    "command": "git-meta"
  }
}
```

Project settings override global settings. Traces include source, assistant thinking, tool results, images, and potentially secrets. Nothing is redacted.

Commits observed on the same branch and fast-forward path during a run are linked automatically. If exactly one trace is pending, the extension also links later same-branch commits when the next Pi session or run starts. This is correlation, not proof that Pi authored them. Ambiguous pending traces remain manual:

```text
/git-meta status
/git-meta attach [trace-id|all] [ref]
```

## Query traces

List pending trace IDs:

```sh
git meta get project meta:local:pi:pending-traces
```

List traces attached to a commit:

```sh
git meta get commit:HEAD agent:traces
```

Trace data is stored as small base64 chunks to avoid `git-meta 0.1.10`'s broken large-string offloading path.

Traces created by the earlier single-value implementation remain affected by that git-meta bug; the browser can read traces created after this change.

Open the interactive trace browser from the package directory:

```nu
nu scripts/git-meta-traces.nu
```

Use native `git meta serialize`, `git meta sync`, and `git meta setup` commands when needed. Serialization may include other dirty records from the local git-meta database.
