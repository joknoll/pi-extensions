# My Pi Config

At its core, a coding harness manages three things: context, tools, and the orchestration between LLMs and the developer.

## Context

The goal of the context layer is to maximize the relevance of information the model sees while minimizing token bloat and noise.

### Directives & Enrichment (Adding Signal)

- System Prompt & AGENTS.md
  - Static rules defining the model's persona and constraints.
- Skills
  - On-demand domain knowledge and framework documentation.
- Memory
  - Persistent vector storage to recall architectural decisions across sessions.

### Compaction & Optimization (Removing Noise)

- rtk-optimizer
  - Cleans and condenses verbose CLI outputs
- lean-ctx https://pi.dev/packages/pi-lean-ctx
  - Caches redundant file reads into tiny token stubs
- Pruning / AST
  - Feeds lightweight structural blueprints of the codebase instead of full files.

Utilities like lean-ctx and AST parsers are executed as callable **tools**, but they belong under Context because their sole purpose is optimizing what the model reads.

## Tools

Tools give the model primitives to edit code, navigate files, and query systems.

### Core Execution

- File & Shell
  - The baseline abilities to `read`, `write`, `edit`, and execute `bash`.

### Search & Navigation

- rg
- fd
- tilth
- codegraph
- Patch Tool

### Specialized Capabilities

- chrome-devtools https://pi.dev/packages/@narumitw/pi-chrome-devtools
  - manipulate the DOM, inspect networks, and read visual feedback
- pi-simplify https://pi.dev/packages/pi-simplify
  - reviewer that refactors recently modified code for readability

## Orchestration

Orchestration routes tasks efficiently, enforces safety boundaries, and keeps the human in the loop.

### Behavioral Modes

- Plan / Architect
  - Restricts tools to read-only while forcing the agent to output structured plans.
- Implement
  - Unlocks full writing and shell capabilities.
- Research / Commit
  - Specialized tool constraints for browsing the web or writing git commits.

### Delegation & Isolation

- Sub-agents
  - Spawns isolated execution environments for sub-tasks to protect main context window

https://pi.dev/packages/@minhduydev/pi-subagents

### Workspace & UI Management

- herdr
  - multiplexer to spawn, view, and control multiple agents
- worktrunk https://worktrunk.dev/
  - Manage parallel git worktrees for multiple sub-agents

- decorated-pi replaces pi's built-in @ autocomplete with a high-speed file finder backed by @ff-labs/fff-node— a Rust SIMD fuzzy file search engine with in-memory index, frecency ranking, and git status awareness. Pi's native provider shells out to fd on every keystroke.
