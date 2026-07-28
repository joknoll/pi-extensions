import type { Model } from "@earendil-works/pi-ai";

export type CompactionProfile = "fast" | "balanced" | "thorough";
export type CompactionReviewStatus = "generated" | "reviewed" | "user-approved";

export interface PiCompactConfig {
  profile: CompactionProfile;
  summaryModel: string | null;
  review: boolean;
}

export interface SmartCompactionDetails {
  kind: "pi-compact";
  version: 1;
  profile: CompactionProfile;
  model: string;
  status: CompactionReviewStatus;
  preservedEvidence: number;
  omittedEvidence: number;
  readFiles: string[];
  modifiedFiles: string[];
}

export interface RunOptions {
  profile: CompactionProfile;
  model: Model<any>;
  focus?: string;
  review: boolean;
}

export interface GeneratedCompaction {
  result: import("@earendil-works/pi-coding-agent").CompactionResult<SmartCompactionDetails>;
  modelLabel: string;
}
