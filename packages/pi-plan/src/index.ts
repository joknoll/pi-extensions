import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  defineTool,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  BOUNDARY_TYPE,
  DEFAULTS,
  newCycle,
  offState,
  parseState,
  planningPrompt,
  transformContext,
  type PlanCycle,
  type PlanState,
  type PlanningThinkingLevel,
  type Preferences,
  validateShell,
} from "./core.ts";
import {
  normalizeQuestions,
  PlanQuestionsParamsSchema,
  type PlanAnswer,
  type PlanQuestionsResult,
} from "./questions.ts";
import {
  agentDir,
  ensurePlanArchive,
  isArchivePath,
  loadPreferences,
  MAX_PLAN_SIZE,
  readPlanArchive,
  savePreferences,
  writePlanArchive,
} from "./storage.ts";
import {
  editArchivedPlan,
  showPlanQuestion,
  showPlanSelect,
  showReadyMenu,
  type ReadyIntent,
} from "./ui.ts";

const STATE_ENTRY = "pi-plan-state";
const BUILTIN_PLAN_TOOLS = ["read", "grep", "find", "ls", "bash"];
const INTERNAL_TOOLS = ["plan_mode_question", "plan_mode_complete"];
const THINKING_LEVELS = [
  "inherit",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const EXTENSION_PATH = resolve(fileURLToPath(import.meta.url));

function modelId(model: { provider: string; id: string } | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function completionNonce(cycle: PlanCycle): string {
  return `${cycle.id}:${cycle.revision}`;
}

export default function piPlan(pi: ExtensionAPI): void {
  let state: PlanState = offState();
  let preferences: Preferences = DEFAULTS;
  let menuOpen = false;
  let editorOpen = false;
  let disposed = false;
  let completionReady: string | undefined;
  let unsubscribeTerminal: (() => void) | undefined;
  let unavailableModelWarning: string | undefined;
  let unavailableToolsWarning: string | undefined;

  const persist = () => pi.appendEntry(STATE_ENTRY, state);
  const setStatus = (ctx: ExtensionContext) =>
    ctx.ui.setStatus(
      "plan-mode",
      state.phase === "ready" ? "plan ready" : state.phase === "planning" ? "plan" : undefined,
    );

  function findModel(ctx: ExtensionContext, id: string | undefined) {
    if (!id) return undefined;
    const slash = id.indexOf("/");
    return slash > 0 ? ctx.modelRegistry.find(id.slice(0, slash), id.slice(slash + 1)) : undefined;
  }

  function enabledPlanningModels(ctx: ExtensionContext) {
    const enabled = SettingsManager.create(ctx.cwd, agentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    }).getEnabledModels();
    const available = ctx.modelRegistry
      .getAvailable()
      .filter((model) => ctx.modelRegistry.hasConfiguredAuth(model));
    if (!enabled) return available;
    return available.filter(
      (model) => enabled.includes(model.id) || enabled.includes(`${model.provider}/${model.id}`),
    );
  }

  function isOwnInternalTool(tool: ReturnType<typeof pi.getAllTools>[number]): boolean {
    if (!INTERNAL_TOOLS.includes(tool.name)) return false;
    const path = tool.sourceInfo.path;
    return typeof path === "string" && !path.startsWith("<") && resolve(path) === EXTENSION_PATH;
  }

  function planningTools(ctx: ExtensionContext): string[] {
    const tools = pi.getAllTools();
    const approved = tools
      .filter(
        (tool) =>
          (BUILTIN_PLAN_TOOLS.includes(tool.name) && tool.sourceInfo.source === "builtin") ||
          isOwnInternalTool(tool),
      )
      .map((tool) => tool.name);
    const missing = [...BUILTIN_PLAN_TOOLS, ...INTERNAL_TOOLS].filter(
      (name) => !approved.includes(name),
    );
    const warning = missing.length > 0 ? missing.join(",") : undefined;
    if (warning && warning !== unavailableToolsWarning)
      ctx.ui.notify(
        `Plan mode disabled unavailable or overridden tools: ${missing.join(", ")}`,
        "warning",
      );
    unavailableToolsWarning = warning;
    return approved;
  }

  async function applyPlanning(ctx: ExtensionContext): Promise<void> {
    if (state.phase === "off") return;
    const cycle = state.cycle;
    const configured =
      cycle.planningModel === "inherit" ? undefined : findModel(ctx, cycle.planningModel);
    const configuredAvailable =
      configured &&
      enabledPlanningModels(ctx).some(
        (model) => model.provider === configured.provider && model.id === configured.id,
      );
    const fallback = findModel(ctx, cycle.previousModel);
    const fallbackAvailable = fallback && ctx.modelRegistry.hasConfiguredAuth(fallback);
    const selected = configuredAvailable ? configured : fallbackAvailable ? fallback : undefined;
    if (cycle.planningModel !== "inherit" && !configuredAvailable) {
      if (unavailableModelWarning !== cycle.planningModel) {
        ctx.ui.notify(
          `Planning model ${cycle.planningModel} is unavailable; using the entry model`,
          "warning",
        );
        unavailableModelWarning = cycle.planningModel;
      }
    } else unavailableModelWarning = undefined;
    if (selected) await pi.setModel(selected);
    const requested =
      cycle.planningThinking === "inherit" ? cycle.previousThinking : cycle.planningThinking;
    pi.setThinkingLevel(requested);
    pi.setActiveTools(planningTools(ctx));
    setStatus(ctx);
    persist();
  }

  async function restoreRuntime(ctx: ExtensionContext, cycle: PlanCycle): Promise<void> {
    const previous = findModel(ctx, cycle.previousModel);
    if (previous && ctx.modelRegistry.hasConfiguredAuth(previous)) {
      try {
        await pi.setModel(previous);
      } catch (error) {
        ctx.ui.notify(
          `Could not restore model ${cycle.previousModel}: ${String(error)}`,
          "warning",
        );
      }
    } else if (cycle.previousModel)
      ctx.ui.notify(
        `Original model ${cycle.previousModel} is unavailable; retaining the current model`,
        "warning",
      );
    pi.setThinkingLevel(cycle.previousThinking);
    const all = pi.getAllTools();
    const available = new Set(all.map((tool) => tool.name));
    const restored = cycle.previousTools.filter((name) => available.has(name));
    pi.setActiveTools(restored);
  }

  async function discard(ctx: ExtensionContext): Promise<void> {
    if (state.phase === "off") return;
    const cycle = state.cycle;
    await restoreRuntime(ctx, cycle);
    state = offState(cycle.revision + 1);
    completionReady = undefined;
    setStatus(ctx);
    persist();
    ctx.ui.notify("Plan mode exited; archived plan retained", "info");
  }

  async function planningOptions(ctx: ExtensionContext): Promise<void> {
    if (state.phase === "off") return;
    const models = [
      "Inherit current model",
      ...enabledPlanningModels(ctx).map((model) => `${model.provider}/${model.id}`),
    ];
    const selectedModel = await showPlanSelect(ctx, "Planning model", models);
    if (!selectedModel) return;
    const selectedThinking = await showPlanSelect(ctx, "Planning thinking effort", THINKING_LEVELS);
    if (!selectedThinking) return;
    const next: Preferences = {
      model: selectedModel === models[0] ? "inherit" : selectedModel,
      thinkingLevel: selectedThinking as PlanningThinkingLevel,
    };
    try {
      await savePreferences(next);
    } catch (error) {
      ctx.ui.notify(`Could not save planning preferences: ${String(error)}`, "error");
      return;
    }
    preferences = next;
    state.cycle.planningModel = next.model;
    state.cycle.planningThinking = next.thinkingLevel;
    await applyPlanning(ctx);
  }

  async function planningMenu(ctx: ExtensionContext): Promise<void> {
    while (state.phase === "planning") {
      const action = await showPlanSelect(ctx, "Plan mode", [
        "Planning options",
        "Keep planning",
        "Exit / discard",
      ]);
      if (action === "Planning options") await planningOptions(ctx);
      else if (action === "Exit / discard") await discard(ctx);
      else return;
    }
  }

  async function refreshReadyPlan(): Promise<string> {
    if (state.phase !== "ready") throw new Error("No completed plan is ready");
    const path = await ensurePlanArchive(state.cycle.plan, state.cycle.archivePath);
    const plan = (await readPlanArchive(path)).trim();
    if (!plan) throw new Error("Archived plan is empty");
    if (plan.length > MAX_PLAN_SIZE) throw new Error("Archived plan exceeds the size limit");
    if (plan !== state.cycle.plan || path !== state.cycle.archivePath) {
      state.cycle.plan = plan;
      state.cycle.archivePath = path;
      state.cycle.revision += 1;
      completionReady = completionNonce(state.cycle);
      persist();
    }
    return plan;
  }

  async function implementationHandoff(ctx: ExtensionContext, clear: boolean): Promise<void> {
    if (state.phase !== "ready") return;
    let plan: string;
    try {
      plan = await refreshReadyPlan();
    } catch (error) {
      ctx.ui.notify(`Cannot implement plan: ${String(error)}`, "error");
      return;
    }
    if (state.phase !== "ready") return;
    const cycle = state.cycle;
    try {
      await restoreRuntime(ctx, cycle);
      state = offState(cycle.revision + 1);
      completionReady = undefined;
      setStatus(ctx);
      persist();
      if (clear) {
        pi.sendMessage(
          {
            customType: BOUNDARY_TYPE,
            content: `Implement the following approved plan:\n\n${plan}`,
            display: true,
            details: { version: 1, cycleId: cycle.id, revision: cycle.revision },
          },
          { deliverAs: "nextTurn" },
        );
      } else pi.sendUserMessage(`Implement the following approved plan:\n\n${plan}`);
    } catch (error) {
      ctx.ui.notify(`Implementation handoff failed: ${String(error)}`, "error");
    }
  }

  async function editPlanAndReopen(ctx: ExtensionContext, expectedNonce: string): Promise<void> {
    if (editorOpen || state.phase !== "ready" || completionNonce(state.cycle) !== expectedNonce)
      return;
    editorOpen = true;
    try {
      const edited = await editArchivedPlan(ctx, state.cycle.plan, state.cycle.archivePath);
      if (state.phase !== "ready" || completionNonce(state.cycle) !== expectedNonce) return;
      if (edited.changed) {
        state.cycle.plan = edited.plan;
        state.cycle.archivePath = edited.archivePath;
        state.cycle.revision += 1;
        completionReady = completionNonce(state.cycle);
        persist();
        ctx.ui.notify(edited.plan, "info");
      }
    } catch (error) {
      ctx.ui.notify(`Plan editor failed: ${String(error)}`, "error");
    } finally {
      editorOpen = false;
    }
    if (state.phase === "ready") await readyMenu(ctx);
  }

  async function handleReadyIntent(
    ctx: ExtensionContext,
    intent: ReadyIntent | undefined,
    nonce: string,
  ): Promise<void> {
    if (!intent || state.phase !== "ready" || completionNonce(state.cycle) !== nonce) return;
    if (intent === "implement") await implementationHandoff(ctx, false);
    else if (intent === "clear") await implementationHandoff(ctx, true);
    else if (intent === "discard") await discard(ctx);
    else if (intent === "edit") await editPlanAndReopen(ctx, nonce);
  }

  async function readyMenu(ctx: ExtensionContext): Promise<void> {
    if (menuOpen || editorOpen || disposed || state.phase !== "ready") return;
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Plan ready; actions require interactive TUI mode", "info");
      return;
    }
    const nonce = completionNonce(state.cycle);
    menuOpen = true;
    let intent: ReadyIntent | undefined;
    try {
      intent = await showReadyMenu(ctx, state.cycle.archivePath);
    } finally {
      menuOpen = false;
    }
    await handleReadyIntent(ctx, intent, nonce);
  }

  function installTerminalListener(ctx: ExtensionContext): void {
    unsubscribeTerminal?.();
    unsubscribeTerminal = ctx.ui.onTerminalInput((data) => {
      if (
        !matchesKey(data, "ctrl+e") ||
        disposed ||
        state.phase !== "ready" ||
        menuOpen ||
        editorOpen ||
        !ctx.isIdle() ||
        ctx.hasPendingMessages()
      )
        return undefined;
      const nonce = completionNonce(state.cycle);
      void editPlanAndReopen(ctx, nonce);
      return { consume: true };
    });
  }

  const questionTool = defineTool({
    name: "plan_mode_question",
    label: "Plan clarification",
    description:
      "Ask one to three structured material clarification questions. Each question is single_choice, multiple_choice, yes_no, or essay.",
    parameters: PlanQuestionsParamsSchema,
    async execute(_id, params, _signal, _update, ctx) {
      const cancelled = (): {
        content: [{ type: "text"; text: string }];
        details: PlanQuestionsResult;
      } => {
        const result: PlanQuestionsResult = { cancelled: true, answers: [] };
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      };
      if (state.phase === "off" || !ctx.hasUI) return cancelled();
      const questions = normalizeQuestions(params.questions);
      if (!questions) return cancelled();
      const expectedCycle = state.cycle.id;
      const currentCycleId = () => (state.phase === "off" ? undefined : state.cycle.id);
      const answers: Array<PlanAnswer | undefined> = Array.from({ length: questions.length });
      let questionIndex = 0;
      while (questionIndex < questions.length) {
        const question = questions[questionIndex];
        const outcome = await showPlanQuestion(
          ctx,
          question,
          answers[questionIndex],
          questionIndex,
          questions.length,
        );
        if (!outcome || currentCycleId() !== expectedCycle) return cancelled();
        if (outcome === "previous") {
          questionIndex = Math.max(0, questionIndex - 1);
          continue;
        }
        if (outcome === "next") {
          questionIndex = Math.min(questions.length - 1, questionIndex + 1);
          continue;
        }
        answers[questionIndex] = outcome.answer;
        const nextUnanswered = answers.findIndex((answer) => answer === undefined);
        if (nextUnanswered < 0) break;
        questionIndex = nextUnanswered;
      }
      if (answers.some((answer) => answer === undefined)) return cancelled();
      const result: PlanQuestionsResult = { cancelled: false, answers: answers as PlanAnswer[] };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });

  const completionTool = defineTool({
    name: "plan_mode_complete",
    label: "Complete plan",
    description: "Submit the complete replacement Markdown plan as the final standalone action.",
    parameters: Type.Object(
      { plan: Type.String({ minLength: 1, maxLength: MAX_PLAN_SIZE }) },
      { additionalProperties: false },
    ),
    async execute(_id, params, _signal, _update, ctx) {
      const error = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: { version: 1, plan: "", revision: -1 },
        isError: true,
      });
      if (state.phase !== "planning") return error("Plan mode is not accepting a completion");
      const plan = params.plan.trim();
      if (!plan) return error("Plan is empty");
      if (plan.length > MAX_PLAN_SIZE) return error("Plan exceeds the size limit");
      const cycle = state.cycle;
      let archivePath: string;
      try {
        archivePath = await writePlanArchive(plan, cycle.archivePath);
      } catch (archiveError) {
        return error(`Could not archive plan: ${String(archiveError)}`);
      }
      cycle.plan = plan;
      cycle.archivePath = archivePath;
      cycle.revision += 1;
      state = {
        kind: "pi-plan-state",
        version: 2,
        phase: "ready",
        cycle: cycle as PlanCycle & { plan: string; archivePath: string },
      };
      completionReady = completionNonce(cycle);
      setStatus(ctx);
      persist();
      return {
        content: [{ type: "text" as const, text: plan }],
        details: { version: 1, plan, revision: cycle.revision },
        terminate: true,
      };
    },
  });

  pi.registerTool(questionTool);
  pi.registerTool(completionTool);

  pi.registerShortcut("shift+tab", {
    description: "Enter or operate strict Plan mode",
    handler: async (ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent turn to finish", "warning");
        return;
      }
      if (state.phase === "off") {
        const loaded = await loadPreferences();
        preferences = loaded.preferences;
        if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
        state = {
          kind: "pi-plan-state",
          version: 2,
          phase: "planning",
          cycle: newCycle({
            previousTools: pi.getActiveTools(),
            previousModel: modelId(ctx.model),
            previousThinking: pi.getThinkingLevel(),
            planningModel: preferences.model,
            planningThinking: preferences.thinkingLevel,
          }),
        };
        await applyPlanning(ctx);
      } else if (state.phase === "ready") await readyMenu(ctx);
      else await planningMenu(ctx);
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (state.phase === "off") return;
    if (state.phase === "ready") {
      state = { ...state, phase: "planning" };
      state.cycle.revision += 1;
      completionReady = undefined;
      setStatus(ctx);
      persist();
    }
    await applyPlanning(ctx);
    return { systemPrompt: `${event.systemPrompt}${planningPrompt(state.cycle.plan)}` };
  });

  pi.on("tool_call", (event, ctx) => {
    if (state.phase === "off") {
      if (INTERNAL_TOOLS.includes(event.toolName))
        return { block: true, reason: "Plan mode is not active" };
      return;
    }
    const approved = planningTools(ctx);
    if (!approved.includes(event.toolName))
      return { block: true, reason: "Tool unavailable in strict Plan mode" };
    if (event.toolName === "bash") {
      const command = (event.input as { command?: unknown }).command;
      const reason = typeof command === "string" ? validateShell(command) : "invalid command";
      if (reason) return { block: true, reason: `Plan-mode shell blocked: ${reason}` };
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    setStatus(ctx);
    if (
      state.phase === "ready" &&
      completionReady === completionNonce(state.cycle) &&
      ctx.isIdle() &&
      !ctx.hasPendingMessages()
    )
      await readyMenu(ctx);
  });

  pi.on("context", (event) => ({
    messages: transformContext(event.messages, state.phase !== "off"),
  }));

  pi.on("session_start", async (_event, ctx) => {
    disposed = false;
    menuOpen = false;
    editorOpen = false;
    completionReady = undefined;
    const branch = ctx.sessionManager.getBranch();
    const savedEntry = [...branch]
      .reverse()
      .find((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY);
    const saved =
      savedEntry?.type === "custom" && savedEntry.customType === STATE_ENTRY
        ? savedEntry.data
        : undefined;
    const restored = parseState(saved);
    if (restored) state = restored;
    else {
      state = offState();
      if (saved !== undefined)
        ctx.ui.notify("Stored Plan-mode state is invalid; Plan mode was disabled", "warning");
    }
    const loaded = await loadPreferences();
    preferences = loaded.preferences;
    if (loaded.warning) ctx.ui.notify(loaded.warning, "warning");
    if (state.phase !== "off" && state.cycle.plan && state.cycle.archivePath) {
      const revision = state.cycle.revision;
      if (!isArchivePath(state.cycle.archivePath)) {
        ctx.ui.notify("Stored Plan archive path is unsafe; Plan mode was disabled", "warning");
        state = offState(revision + 1);
        persist();
      } else {
        try {
          state.cycle.archivePath = await ensurePlanArchive(
            state.cycle.plan,
            state.cycle.archivePath,
          );
          if (state.phase === "ready") completionReady = completionNonce(state.cycle);
        } catch (error) {
          ctx.ui.notify(`Could not restore Plan archive: ${String(error)}`, "warning");
          state = offState(revision + 1);
          persist();
        }
      }
    }
    if (state.phase !== "off") await applyPlanning(ctx);
    else setStatus(ctx);
    installTerminalListener(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    disposed = true;
    unsubscribeTerminal?.();
    unsubscribeTerminal = undefined;
    menuOpen = false;
    editorOpen = false;
    completionReady = undefined;
    if (state.phase !== "off") await restoreRuntime(ctx, state.cycle);
    ctx.ui.setStatus("plan-mode", undefined);
  });
}
