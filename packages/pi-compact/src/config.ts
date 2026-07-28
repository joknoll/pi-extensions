import { SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CompactionProfile, PiCompactConfig } from "./types.ts";

export const DEFAULT_CONFIG: PiCompactConfig = {
  profile: "balanced",
  summaryModel: null,
  review: true,
};

export interface LoadedConfig {
  config: PiCompactConfig;
  externalEditor: string;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScope(
  value: unknown,
  scope: string,
): { value: Partial<PiCompactConfig>; warnings: string[] } {
  if (!isRecord(value) || !("piCompact" in value)) return { value: {}, warnings: [] };
  const raw = value.piCompact;
  if (!isRecord(raw))
    return { value: {}, warnings: [`${scope} piCompact setting must be an object`] };

  const parsed: Partial<PiCompactConfig> = {};
  const warnings: string[] = [];
  if (raw.profile !== undefined) {
    if (raw.profile === "fast" || raw.profile === "balanced" || raw.profile === "thorough") {
      parsed.profile = raw.profile satisfies CompactionProfile;
    } else {
      warnings.push(`${scope} piCompact.profile must be fast, balanced, or thorough`);
    }
  }
  if (raw.summaryModel !== undefined) {
    if (typeof raw.summaryModel === "string" || raw.summaryModel === null)
      parsed.summaryModel = raw.summaryModel;
    else warnings.push(`${scope} piCompact.summaryModel must be a provider/model string or null`);
  }
  if (raw.review !== undefined) {
    if (typeof raw.review === "boolean") parsed.review = raw.review;
    else warnings.push(`${scope} piCompact.review must be true or false`);
  }
  return { value: parsed, warnings };
}

export function resolveConfig(
  globalSettings: unknown,
  projectSettings: unknown,
): {
  config: PiCompactConfig;
  warnings: string[];
} {
  const global = parseScope(globalSettings, "Global");
  const project = parseScope(projectSettings, "Project");
  return {
    config: { ...DEFAULT_CONFIG, ...global.value, ...project.value },
    warnings: [...global.warnings, ...project.warnings],
  };
}

export function loadConfig(ctx: ExtensionContext): LoadedConfig {
  const settings = SettingsManager.create(ctx.cwd, undefined, {
    projectTrusted: ctx.isProjectTrusted(),
  });
  const resolved = resolveConfig(settings.getGlobalSettings(), settings.getProjectSettings());
  return {
    config: resolved.config,
    externalEditor:
      settings.getExternalEditorCommand() ?? (process.platform === "win32" ? "notepad" : "nano"),
    warnings: resolved.warnings,
  };
}
