# Coding Harness Architecture

A coding harness manages three layers: context, tools, and orchestration.

Each layer has a separate purpose. Their boundaries keep the system clear and predictable.

## Context

The context layer controls the information that the model receives.

It adds relevant information and removes noise. It also limits token use.

### Signal controls

- **System prompt and `AGENTS.md`** define stable rules, roles, and constraints.
- **Skills** provide domain knowledge and framework documents when a task requires them.
- **Memory** can preserve architecture decisions across sessions.

Memory is an optional system. This repository does not provide a memory system.

### Noise controls

- Output filters reduce verbose command output.
- Read caches replace repeated file content with small references.
- AST tools can provide structure without full source files.

These controls can run as tools. Their purpose still belongs to the context layer.

Optional examples include [RTK](https://github.com/rtk-ai/rtk) and [pi-lean-ctx](https://pi.dev/packages/pi-lean-ctx).

This repository does not include AST tools or `pi-lean-ctx`.

## Tools

The tools layer gives the model controlled access to files, commands, and external systems.

### Core tools

- `read` reads file content.
- `write` creates or replaces files.
- `edit` changes selected file content.
- `bash` runs shell commands.

### Search tools

- `rg` searches file content.
- `fd` searches file and directory names.
- Indexed search tools can add fuzzy search, ranking, and Git status data.

### Specialized tools

Specialized tools add a narrow capability for a specific task.

Optional examples include:

- [pi-chrome-devtools](https://pi.dev/packages/@narumitw/pi-chrome-devtools) inspects pages, network requests, and visual output.
- [pi-simplify](https://pi.dev/packages/pi-simplify) reviews recent code changes for readability.
- [pi-fff](https://pi.dev/packages/@ff-labs/pi-fff) provides indexed file search and autocomplete.

These projects are external examples. They are not components of this repository.

## Orchestration

The orchestration layer controls task flow, tool access, and human approval.

It selects a mode for each task phase. It also defines transitions between modes.

### Behavioral modes

- **Plan mode** permits inspection and produces a structured plan.
- **Implement mode** permits file changes and required commands.
- **Research mode** permits information access without repository changes.
- **Commit mode** permits the operations required for a Git commit.

Each mode exposes only the tools that its task requires.

Human approval controls important transitions. Examples include plan approval, cross-provider access, and destructive operations.

### Delegation and isolation

A harness can delegate a small task to a separate agent.

Isolation protects the main context and limits tool access. It does not guarantee operating system security.

[pi-subagents](https://pi.dev/packages/@minhduydev/pi-subagents) is an optional external example.

This repository does not provide a general subagent system.

### Workspace control

Workspace tools can separate concurrent tasks and expose their status.

Optional examples include:

- Herdr controls multiple agent panes and reports their states.
- [Worktrunk](https://worktrunk.dev/) manages separate Git worktrees.

These tools are external systems. They are not components of this repository.

## Layer boundaries

A component can use one layer while it serves another layer.

For example, a read cache runs as a tool but controls context.

A mode can hide a tool but does not change the tool implementation.

Clear boundaries reduce duplicate controls and unclear ownership.
