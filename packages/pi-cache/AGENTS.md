# pi-cache contributor guide

`@joknoll/pi-cache` is a deliberately narrow Pi extension: it reports
provider-supplied prompt-cache usage for the **active Pi session**. It is an
observability module, not a cache-management module.

## Commands

Run commands from this package or use workspace filtering from the repository
root. Use `vp`, never `npm`.

```bash
vp test
vp check
vp check --fix
vp pack

# From the repository root
vp run --filter @joknoll/pi-cache test
vp run --filter @joknoll/pi-cache check
vp run --filter @joknoll/pi-cache build
```

Before considering a change complete, run:

```bash
vp check
vp test
vp pack
```

## Scope and invariants

This extension must remain safe to install for every provider. Preserve these
invariants unless the user explicitly changes the product scope:

1. **Read-only request behavior.** Do not rewrite system prompts, messages,
   tools, request bodies, headers, cache keys, environment variables, cache
   retention, or `models.json`.
2. **No synthetic cache results.** A missing `cacheRead` / `cacheWrite` field
   means telemetry is unavailable, not a cache miss. The footer must say
   `cache n/a` rather than lowering a hit rate.
3. **Session-only state.** Do not create a stats database or persist a separate
   ledger. On `session_start`, rebuild from `ctx.sessionManager.getBranch()`;
   this permits extension reloads to recover the active session's history
   without retaining cross-session data.
4. **No sensitive data.** Never store or log prompts, message content, session
   IDs, API keys, request payloads, headers, responses, or model output.
5. **Truthful denominators.** Include a response in hit-rate/token totals only
   when Pi exposes cache usage. `input + cacheRead + cacheWrite` is the total
   prompt-token count for Pi's normalized usage shape.
6. **Do not compete for footer ownership.** The extension publishes a status
   through `ctx.ui.setStatus("pi-cache", value)`. It must not call
   `ctx.ui.setFooter()`: users may own their footer with another extension.

## Architecture

All implementation currently lives in `src/index.ts`. Keep the public surface
small and preserve the following seams:

- **Pure aggregation seam:** `readCacheUsage`, `addMessageToStats`, and the
  formatting helpers accept plain values and return plain values. Unit tests
  should exercise behavior here without a Pi runtime.
- **Pi adapter seam:** the default export registers `session_start`,
  `message_end`, and `/cache-stats`; it owns in-memory state and status
  publication.
- **Footer seam:** callers render the published `pi-cache` status value. A
  custom footer can obtain it through
  `footerData.getExtensionStatuses().get("pi-cache")`.

Avoid creating configuration layers, provider adapters, persistence adapters,
or broad compatibility heuristics until there is a concrete second use case.
They would make this small module shallow without improving its current job.

## Event lifecycle

1. `session_start`
   - Clear in-memory counters and identity deduplication.
   - Walk the active branch and add prior assistant messages.
   - Publish the current status.
2. `message_end`
   - Accept assistant messages only.
   - Ignore the same message object more than once; Pi hooks/reloads must not
     double count it.
   - Add normalized usage, then republish the status.
3. `/cache-stats`
   - With no argument, display a current-session report.
   - With `reset`, clear only the in-process measurement. Reloading rebuilds
     from active session history, by design.

`message_end` is the authoritative point for a completed assistant response.
Do not count streamed `message_update` events or tool messages.

## Usage interpretation

Pi normalizes provider-specific cache fields into:

```ts
usage: {
  input: number; // uncached prompt tokens
  cacheRead: number; // tokens read from an existing prompt cache entry
  cacheWrite: number; // newly written cache tokens
}
```

A request is a hit when `cacheRead > 0`. The token cache rate is:

```text
cacheRead / (input + cacheRead + cacheWrite)
```

`cacheWrite` belongs in the denominator because it was part of the request's
prompt input, but it is not a hit. Keep request-hit rate and token-hit rate
distinct.

Providers may omit cache fields entirely, even when they cache internally.
This extension reports only observable usage and must under-report rather than
infer or guess.

## Testing guidance

Add or update tests in `tests/index.test.ts` for every behavior change. Cover
at least:

- fully normalized cache usage;
- missing cache fields resulting in `cache n/a`, not a miss;
- zero-read cache writes as a reported miss;
- hit and token-rate aggregation;
- invalid, negative, or non-numeric usage values being rejected;
- user-facing status/report text where it changes.

Prefer tests for exported pure functions. Do not require a real provider,
credentials, or a running Pi TUI to test accounting logic.

## Packaging

`package.json` declares the extension entry under `pi.extensions` and exposes
`dist/index.mjs`. Keep `@earendil-works/pi-coding-agent` as both a development
dependency (for type checking) and peer dependency (Pi provides it at runtime).
Do not bundle Pi itself or add a runtime dependency solely for telemetry.

The package is intended to work with Pi's built-in footer and with custom
footers that render extension statuses. Document any new visible status key or
command in `README.md`.

## Out of scope unless explicitly requested

- injecting `prompt_cache_key`;
- OpenAI proxy session affinity;
- long cache retention;
- Anthropic cache-control breakpoints;
- system-prompt reordering or skill compression;
- editing `models.json`;
- daily, cross-session, or machine-wide statistics;
- provider-specific cost estimates.

Those capabilities need a separate design because they introduce request
mutation, provider compatibility risk, or persistent data responsibilities.
