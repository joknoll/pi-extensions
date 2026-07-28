# @joknoll/pi-plan

Keyboard-first, strict Plan mode for Pi.

## Install

Install the package globally through Pi:

```sh
pi install npm:@joknoll/pi-plan
```

For local development, build it and load the package directory temporarily:

```sh
vp pack
pi -e .
```

The package manifest exposes `dist/index.mjs` through `pi.extensions`.

Shift+Tab must be available to the extension. Move `app.thinking.cycle` to another key (for example Ctrl+Shift+P); Pi treats Shift+Tab as reserved and it must not remain assigned to thinking-level cycling.

## Workflow

- Press **Shift+Tab** to enter Plan mode. Existing editor text is preserved and the footer shows `plan`.
- Discuss the work while the model inspects the repository with read-only tools.
- While idle, press **Shift+Tab** again for planning model/effort options or to exit.
- The model submits a structured completion; the footer shows `plan ready` and an action menu appears.
- Choose implementation with existing discussion, implementation with logically cleared conversation context, keep planning, or exit/discard.
- While a plan is ready, press **Ctrl+E** in the menu or while idle to edit its archived Markdown file in Pi's configured external editor.
- A following message after Keep planning uses the current plan as a revision baseline and requires a complete replacement.

Planning options include inherited settings, models allowed by Pi's `enabledModels` setting, and efforts from `off` through `max`. Add each planning model as its model ID (or `provider/model` ID) in Pi's configuration. Pi may clamp effort to model capabilities. The entry model, effort, and exact available tool set are restored on implementation or exit.

Global defaults live at `$PI_CODING_AGENT_DIR/pi-plan.json` (normally `~/.pi/agent/pi-plan.json`):

```json
{
  "model": "inherit",
  "thinkingLevel": "inherit"
}
```

Invalid settings warn and fall back to inherited values without rewriting the file.

## Plans and safety

Plans are archived under `$PI_CODING_AGENT_DIR/plans/`. Revisions overwrite the cycle's archive; new cycles create new files. Implementation and discard retain archives.

Plan mode exposes only effective built-in inspection tools, a fail-closed restricted shell, structured questions, and structured completion. It blocks writing tools, unknown/custom tools, shell expansion and redirection, mutating Git, installers, and unknown commands. This is risk reduction, not an OS sandbox: allowed builds and checks can still run project hooks or create ignored artifacts.

The clear-context implementation action writes a unique durable boundary and filters earlier conversation from subsequent model context. The visible session remains intact, and normal system/project instructions and tools remain available.

The footer reports `plan` and `plan ready`. Ctrl+E is intercepted only while an archived plan is ready and Pi is idle; Pi's normal external prompt editor remains untouched at all other times. Invalid or failed archive edits restore the previous plan.

## Development

```sh
vp check
vp test run
vp pack
```
