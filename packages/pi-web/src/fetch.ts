import type { FetchedResource } from "./types.ts";

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_REDIRECTS = 5;
export const WEB_FETCH_USER_AGENT = "@joknoll/pi-web/0.0.0 (Pi web_fetch)";
export const WEB_FETCH_ACCEPT =
  "text/html,application/xhtml+xml,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.1";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class WebFetchTimeoutError extends Error {
  override name = "WebFetchTimeoutError";
}

export class WebFetchCancelledError extends Error {
  override name = "WebFetchCancelledError";
}

export interface FetchResourceOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxDownloadBytes?: number;
  maxRedirects?: number;
}

export function validateWebUrl(value: string): URL {
  if (!value.trim()) throw new Error("web_fetch URL must not be blank");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("web_fetch URL is malformed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`web_fetch only supports HTTP(S) URLs, not ${url.protocol}`);
  if (url.username || url.password)
    throw new Error("web_fetch rejects URLs containing embedded credentials");
  return url;
}

export function parseContentType(header: string | null): {
  mime: string;
  charset?: string;
} {
  if (!header?.trim()) throw new Error("web_fetch response has no Content-Type header");
  const [rawMime, ...parameters] = header.split(";");
  const mime = rawMime?.trim().toLowerCase();
  if (!mime) throw new Error("web_fetch response has an invalid Content-Type header");
  let charset: string | undefined;
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*$/i.exec(parameter);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value) charset = value.trim().toLowerCase();
  }
  return { mime, charset };
}

export function classifyContentType(mime: string): "html" | "text" | "json" {
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "application/json" || /^application\/.+\+json$/.test(mime)) return "json";
  if (mime.startsWith("text/")) return "text";
  throw new Error(`web_fetch does not support Content-Type ${mime}`);
}

export function decodeText(body: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset ?? "utf-8", { fatal: false }).decode(body);
  } catch {
    throw new Error(`web_fetch does not support declared charset ${charset}`);
  }
}

async function readBodyWithLimit(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`web_fetch response is too large: ${length} bytes exceeds ${limit}`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const abort = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) {
        if (signal.aborted) throw signal.reason;
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`web_fetch response exceeded the ${limit}-byte download limit`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function describeFetchFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

export async function fetchResource(
  input: string,
  callerSignal?: AbortSignal,
  options: FetchResourceOptions = {},
): Promise<FetchedResource> {
  const requested = validateWebUrl(input);
  if (callerSignal?.aborted)
    throw new WebFetchCancelledError("web_fetch was cancelled before the request started");

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new WebFetchTimeoutError(`web_fetch timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const cancel = () =>
    controller.abort(new WebFetchCancelledError("web_fetch was cancelled by the caller"));
  callerSignal?.addEventListener("abort", cancel, { once: true });

  try {
    let current = requested;
    let redirectCount = 0;
    const visited = new Set<string>();

    while (true) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (visited.has(current.href)) throw new Error("web_fetch detected a redirect loop");
      visited.add(current.href);

      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: WEB_FETCH_ACCEPT,
          "User-Agent": WEB_FETCH_USER_AGENT,
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location)
          throw new Error(`web_fetch received HTTP ${response.status} without Location`);
        redirectCount += 1;
        if (redirectCount > maxRedirects)
          throw new Error(`web_fetch exceeded the ${maxRedirects}-redirect limit`);
        current = validateWebUrl(new URL(location, current).href);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(
          `web_fetch request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        );
      }

      const { mime, charset } = parseContentType(response.headers.get("content-type"));
      classifyContentType(mime);
      const body = await readBodyWithLimit(response, maxBytes, controller.signal);
      if (body.byteLength === 0) throw new Error("web_fetch response body is empty");
      return {
        requestedUrl: requested.href,
        finalUrl: current.href,
        contentType: mime,
        charset,
        body,
        fetchedBytes: body.byteLength,
        redirectCount,
      };
    }
  } catch (error) {
    if (timedOut) throw new WebFetchTimeoutError(`web_fetch timed out after ${timeoutMs}ms`);
    if (callerSignal?.aborted || error instanceof WebFetchCancelledError)
      throw new WebFetchCancelledError("web_fetch was cancelled by the caller");
    throw describeFetchFailure(error);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", cancel);
  }
}
