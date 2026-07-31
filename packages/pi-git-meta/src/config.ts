import { SettingsManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiGitMetaConfig } from "./types.ts";
export const DEFAULT_CONFIG: PiGitMetaConfig = {
  enabled: true,
  maxTraceBytes: 104857600,
  command: "git-meta",
};
const record = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
export function parseScope(
  value: unknown,
  scope: string,
): { value: Partial<PiGitMetaConfig>; warnings: string[] } {
  const raw = record(value)?.piGitMeta;
  if (raw === undefined) return { value: {}, warnings: [] };
  const o = record(raw);
  if (!o) return { value: {}, warnings: [`${scope} piGitMeta must be an object`] };
  const result: Partial<PiGitMetaConfig> = {};
  const warnings: string[] = [];
  for (const key of ["enabled"] as const) {
    if (o[key] === undefined) continue;
    if (typeof o[key] === "boolean") result[key] = o[key];
    else warnings.push(`${scope} piGitMeta.${key} must be boolean`);
  }
  if (o.maxTraceBytes !== undefined) {
    if (Number.isSafeInteger(o.maxTraceBytes) && (o.maxTraceBytes as number) > 0)
      result.maxTraceBytes = o.maxTraceBytes as number;
    else warnings.push(`${scope} piGitMeta.maxTraceBytes must be a positive integer`);
  }
  if (o.command !== undefined) {
    if (typeof o.command === "string" && o.command.trim()) result.command = o.command;
    else warnings.push(`${scope} piGitMeta.command must be a non-empty string`);
  }
  return { value: result, warnings };
}
export function loadConfig(ctx: ExtensionContext) {
  const s = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
  const a = parseScope(s.getGlobalSettings(), "Global"),
    b = parseScope(s.getProjectSettings(), "Project");
  return {
    config: { ...DEFAULT_CONFIG, ...a.value, ...b.value },
    warnings: [...a.warnings, ...b.warnings],
  };
}
