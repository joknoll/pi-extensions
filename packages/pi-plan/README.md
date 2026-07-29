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

## Clarification questions

`plan_mode_question` asks one to three structured questions. Each question declares an explicit `type`:

- `single_choice` / `multiple_choice` — require 2 to 4 `{ label, impact }` options. A synthetic "Other" choice is always added; option labels may not collide with it (case-insensitively).

Keyboard controls:

- **Single Choice**: ↑↓ choose, ←→ move between questions, Enter submit, Esc/Ctrl+C cancel.
- **Multiple Choice**: ↑↓ move, Space toggle, Enter submit (at least one selection required), ←→ move between questions, Esc/Ctrl+C cancel.

Choosing "Other" (Single/Multiple Choice) opens a text prompt; cancelling that prompt returns to the question instead of cancelling the batch, and deselecting/reselecting "Other" lets the value be changed. Navigating back to an already-answered question restores its prior answer.

Answers are returned in question order, one per question, as a typed union:

```json
{ "id": "...", "type": "single_choice", "label": "...", "other": "optional custom text" }
{ "id": "...", "type": "multiple_choice", "labels": ["...", "Other"], "other": "optional custom text" }
```

Cancelling any question, submitting an empty custom answer, or a Plan-mode cycle change while a question is open returns `{ "cancelled": true, "answers": [] }` with no partial answers.

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

Plan mode exposes only effective built-in inspection tools, a fail-closed restricted shell, structured questions, and structured completion. The structured Plan tools are visible to the model only while Plan mode is active; implementation, discard, off-state session restoration, and shutdown restore normal tools without them. It blocks writing tools, unknown/custom tools, shell expansion and redirection, mutating Git, installers, and unknown commands. RTK-wrapped commands receive the same read-only authorization checks as their effective commands. This is risk reduction, not an OS sandbox: allowed builds and checks can still run project hooks or create ignored artifacts.

The clear-context implementation action writes a unique durable boundary and filters earlier conversation from all subsequent model context, including later Plan-mode cycles. The visible session remains intact, and normal system/project instructions and tools remain available.

The footer reports `plan` and `plan ready`. Ctrl+E is intercepted only while an archived plan is ready and Pi is idle; Pi's normal external prompt editor remains untouched at all other times. Invalid or failed archive edits restore the previous plan.

## Herdr integration

Install Herdr's Pi integration before launching Pi:

```sh
herdr integration install pi
```

Pi must run inside a Herdr-managed pane with `HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH` in its environment. The integration maps Pi's normal `agent_start` and `agent_end` lifecycle to Herdr `working → idle`; Herdr derives the blue `done` indicator when that idle pane is in the background and unseen. A focused completed pane remains seen/idle.

Successful `plan_mode_complete` calls terminate the agent turn, producing `agent_end`. While clarification dialogs and the Plan-ready action menu await input, Pi Plan emits `herdr:blocked`, which the installed integration maps to Herdr's red blocked indicator; closing or cancelling the interaction clears it. Planning options and the ordinary Plan-mode menu do not report blocked. Pi Plan contains no direct Herdr socket code or dependency: Herdr owns delivery retries, session identity, sequencing, and state arbitration. Without the integration, Plan mode still works normally, but Herdr's limited screen heuristic may not reliably show these states.

## Development

```sh
vp check
vp test run
vp pack
```
