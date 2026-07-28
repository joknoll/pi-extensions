import type { Model } from "@earendil-works/pi-ai";

export type CompactionProfile = "fast" | "balanced" | "thorough";

export interface PiCompactConfig {
  profile: CompactionProfile;
  summaryModel: string | null;
  review: boolean;
}

export type VerificationStatus = "verified" | "user-approved";

export interface SmartCompactionDetails {
  kind: "pi-compact";
  version: 1;
  profile: CompactionProfile;
  model: string;
  verification: {
    status: VerificationStatus;
    coveredFacts: number;
    totalFacts: number;
    repairCount: number;
    gapKinds: string[];
  };
  readFiles: string[];
  modifiedFiles: string[];
}

export interface RunOptions {
  profile: CompactionProfile;
  model?: Model<any>;
  explicitModel?: string;
  focus?: string;
  review: boolean;
}

export interface EvidenceFact {
  kind: "goal" | "constraint" | "decision" | "error" | "open-loop" | "file" | "focus";
  text: string;
  critical: boolean;
}

export interface VerificationReport {
  summary: string;
  coveredFacts: number;
  totalFacts: number;
  repairCount: number;
  gapKinds: string[];
  acceptable: boolean;
}

export interface ResolvedProfile {
  outputTokens: number;
  reasoning: "low" | "medium" | "high";
  toolResultChars: number;
  repairWithModel: boolean;
}
