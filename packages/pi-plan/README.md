# @joknoll/pi-plan

Strict, keyboard-controlled plan mode for Pi.

## Install

Install the package through Pi:

```sh
pi install npm:@joknoll/pi-plan
```

For local development, build and load the package directory:

```sh
vp pack
pi -e .
```

Assign `app.thinking.cycle` to a key other than Shift+Tab. The extension requires Shift+Tab.

## Workflow

1. Press **Shift+Tab** to enter Plan mode.
2. Discuss the work while the model uses read-only tools.
3. Press **Shift+Tab** while idle to change options or exit.
4. Wait for the model to submit a structured plan.
5. Select an implementation, revision, or exit action.

The footer shows `plan` during the cycle and `plan ready` after plan completion.

Press **Ctrl+E** to edit a ready plan in the configured external editor.

After **Keep planning**, send a message to request a complete plan replacement.

Plan options include inherited settings, enabled models, and effort levels from `off` through `max`.

Add each plan model to the Pi `enabledModels` setting. Pi limits effort to the model capabilities.

The extension restores the original model, effort, and tools after implementation or exit.

## Clarification questions

The `plan_mode_question` tool asks one to three questions. Each question uses `single_choice` or `multiple_choice`.

Provide two to four `{ label, impact }` options for each question. The extension adds an `Other` option.

Do not use an option label that matches `Other`, regardless of case.

### Keyboard controls

- Use ↑↓ or j/k to select an option.
- Use ←→ or h/l to move between questions.
- Use Space to toggle multiple choices.
- Use n to add an optional note to the current question.
- Use Enter to submit.
- Use Esc or Ctrl+C to cancel.

A multiple-choice answer requires at least one selection.

Select `Other` to open a text prompt. If you cancel that prompt, the extension returns to the current question.

The extension restores prior answers when you return to a question.

Answers use a typed union:

```json
{ "id": "...", "type": "single_choice", "label": "...", "other": "optional custom text", "note": "optional note" }
{ "id": "...", "type": "multiple_choice", "labels": ["...", "Other"], "other": "optional custom text", "note": "optional note" }
```

A canceled question returns this result without partial answers:

```json
{ "cancelled": true, "answers": [] }
```

An empty custom answer or a Plan mode cycle change returns the same result.

## Defaults

Store global defaults in `$PI_CODING_AGENT_DIR/pi-plan.json`:

```json
{
  "model": "inherit",
  "thinkingLevel": "inherit"
}
```

The default directory is `~/.pi/agent`. Invalid values use inherited settings and produce a warning.

## Plans and safety

The extension stores plans under `$PI_CODING_AGENT_DIR/plans/`. A revision replaces the current cycle file.

A new cycle creates a new file. Implementation and discard keep the archived file.

Plan mode permits built-in inspection tools, a restricted shell, questions, and plan completion.

It blocks write tools, unknown tools, shell expansion, redirection, Git changes, installers, and unknown commands.

RTK commands receive the same checks as their effective commands.

This control reduces risk but does not provide an operating system sandbox. Allowed builds and checks can run hooks or create ignored files.

The clear-context action adds a durable boundary. Later model context excludes all conversation before that boundary.

The visible session, system instructions, project instructions, and standard tools remain available.

Ctrl+E changes only a ready archived plan while Pi is idle. Failed edits restore the prior plan.

## Herdr integration

Install the Herdr Pi integration before you start Pi:

```sh
herdr integration install pi
```

Run Pi in a Herdr pane with `HERDR_ENV=1`, `HERDR_PANE_ID`, and `HERDR_SOCKET_PATH`.

Herdr maps `agent_start` and `agent_end` to its `working` and `idle` states.

The extension emits `herdr:blocked` during question dialogs and the ready-plan action menu. It clears this state when the interaction ends.

Plan options and the standard Plan mode menu do not emit the blocked state.

The extension contains no Herdr socket code or dependency. Herdr controls delivery, identity, sequence, and state arbitration.

Plan mode works without Herdr integration. The Herdr screen heuristic can then report less accurate states.

## Development

```sh
vp test run
vp pack
```
