# @joknoll/pi-cache

Session-only prompt-cache telemetry for Pi.

It observes normalized usage returned by Pi/provider responses and displays a
footer status such as `cache 8/12 · 84%`. It never rewrites prompts, changes
request payloads, changes cache retention, or edits model configuration.

`/cache-stats` shows the current session's token totals. `/cache-stats reset`
starts a fresh in-process measurement. On reload, stats are rebuilt from the
active session history; no separate stats file is written to disk.

If a provider does not expose `cacheRead` or `cacheWrite`, it displays
`cache n/a` rather than treating the response as a cache miss.

The extension publishes its footer text through the `pi-cache` extension-status
key. Pi's standard footer shows extension statuses; a custom footer can render
it with `footerData.getExtensionStatuses().get("pi-cache")`.
