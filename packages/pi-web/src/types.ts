export type WebFetchFormat = "markdown" | "text" | "json";
export type ExtractionMethod = "readability" | "body-fallback";

export interface FetchedResource {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  charset?: string;
  body: Uint8Array;
  fetchedBytes: number;
  redirectCount: number;
}

export interface ExtractedHtml {
  content: string;
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  wordCount: number;
  extractionMethod: ExtractionMethod;
}

export interface FormattedDocument {
  body: string;
  format: WebFetchFormat;
  finalUrl: string;
  title?: string;
}

export interface BoundedOutput {
  content: string;
  outputBytes: number;
  outputLines: number;
  truncated: boolean;
  fullOutputPath?: string;
  preservationWarning?: string;
}

export interface WebFetchDetails {
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  format: WebFetchFormat;
  fetchedBytes: number;
  outputBytes: number;
  outputLines: number;
  truncated: boolean;
  fullOutputPath?: string;
  preservationWarning?: string;
  redirectCount: number;
  fetchedAt: string;
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  wordCount?: number;
  extractionMethod?: ExtractionMethod;
}
