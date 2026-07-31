export interface PiGitMetaConfig {
  enabled: boolean;
  maxTraceBytes: number;
  command: string;
}
export interface GitState {
  root: string;
  gitDir: string;
  head?: string;
  branch?: string;
}
export interface RunCapture {
  traceId: string;
  sessionId: string;
  baseEntryId?: string;
  prompt: string;
  startedAt: string;
  thinkingLevel: string;
  model?: string;
  baseHead?: string;
  branch?: string;
}
export interface Trace {
  schemaVersion: 1;
  traceId: string;
  session: { id: string };
  run: {
    startedAt: string;
    endedAt: string;
    prompt: string;
    thinkingLevelAtStart: string;
    baseEntryId?: string;
  };
  git: {
    branch?: string;
    baseCommit?: string;
    headAtCompletion?: string;
    detectedCommits: string[];
  };
  entries: unknown[];
}
