import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { ExtractedHtml } from "./types.ts";

const MIN_READABLE_CHARACTERS = 50;
const REMOVE_ALWAYS = [
  "script",
  "style",
  "noscript",
  "template",
  "form",
  "iframe",
  "svg",
  "canvas",
  "audio",
  "video",
  "picture",
  "figure",
  "object",
  "embed",
];
const REMOVE_FALLBACK_CHROME = ["nav", "header", "footer", "aside"];

interface ReadableArticle {
  title?: string | null;
  byline?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  textContent?: string | null;
  content?: string | null;
}

export interface ExtractHtmlOptions {
  readArticle?: (document: Document) => ReadableArticle | null;
}

function cleanMetadata(value: string | null | undefined, maximum = 500): string | undefined {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length <= maximum ? clean : `${clean.slice(0, maximum - 1).trimEnd()}…`;
}

function removeElements(document: Document, selectors: string[]): void {
  for (const selector of selectors)
    for (const element of document.querySelectorAll(selector)) element.remove();
}

function normalizeLinks(document: Document, finalUrl: string): void {
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const resolved = new URL(href, finalUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:")
        anchor.setAttribute("href", resolved.href);
      else if (resolved.protocol === "javascript:" || resolved.protocol === "data:")
        anchor.removeAttribute("href");
    } catch {
      anchor.removeAttribute("href");
    }
  }
}

function createDocument(html: string, finalUrl: string): Document {
  const parsed = parseHTML(html).document as unknown as Document;
  try {
    Object.defineProperty(parsed, "documentURI", {
      configurable: true,
      value: finalUrl,
    });
  } catch {
    // Linkedom versions differ in how documentURI is defined; links are normalized explicitly.
  }
  removeElements(parsed, REMOVE_ALWAYS);
  normalizeLinks(parsed, finalUrl);
  return parsed;
}

function markdownConverter(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  return turndown;
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function metadataFromDocument(document: Document): {
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
} {
  const meta = (selector: string) =>
    cleanMetadata(document.querySelector(selector)?.getAttribute("content"));
  return {
    title: cleanMetadata(document.title) ?? meta('meta[property="og:title"]'),
    byline: meta('meta[name="author"]') ?? meta('meta[property="article:author"]'),
    siteName: meta('meta[property="og:site_name"]'),
    excerpt: meta('meta[name="description"]') ?? meta('meta[property="og:description"]'),
  };
}

export function extractHtml(
  html: string,
  finalUrl: string,
  options: ExtractHtmlOptions = {},
): ExtractedHtml {
  if (!html.trim()) throw new Error("web_fetch HTML response is empty");

  const readabilityDocument = createDocument(html, finalUrl);
  const article = options.readArticle
    ? options.readArticle(readabilityDocument)
    : new Readability(readabilityDocument).parse();
  const articleText = cleanMetadata(article?.textContent, Number.MAX_SAFE_INTEGER);
  if (article?.content && articleText && articleText.length >= MIN_READABLE_CHARACTERS) {
    const content = normalizeMarkdown(markdownConverter().turndown(article.content));
    if (content.length >= MIN_READABLE_CHARACTERS) {
      return {
        content,
        title: cleanMetadata(article.title),
        byline: cleanMetadata(article.byline),
        siteName: cleanMetadata(article.siteName),
        excerpt: cleanMetadata(article.excerpt),
        wordCount: wordCount(articleText),
        extractionMethod: "readability",
      };
    }
  }

  const fallbackDocument = createDocument(html, finalUrl);
  const metadata = metadataFromDocument(fallbackDocument);
  removeElements(fallbackDocument, REMOVE_FALLBACK_CHROME);
  const body = fallbackDocument.body;
  const text = cleanMetadata(body?.textContent, Number.MAX_SAFE_INTEGER);
  const content = body ? normalizeMarkdown(markdownConverter().turndown(body.innerHTML)) : "";
  if (!text || text.length < MIN_READABLE_CHARACTERS || content.length < MIN_READABLE_CHARACTERS) {
    throw new Error(
      "web_fetch found no substantial readable content; the page may require JavaScript rendering",
    );
  }

  return {
    content,
    ...metadata,
    wordCount: wordCount(text),
    extractionMethod: "body-fallback",
  };
}
