# @joknoll/pi-cache

Session prompt cache metrics for Pi.

The extension reads normalized usage data from Pi provider responses. It shows a footer status such as `cache 8/12 · 84%`.

The extension does not change prompts, requests, cache retention, or model configuration.

## Commands

```text
/cache-stats
/cache-stats reset
```

`/cache-stats` shows token totals for the current session. `/cache-stats reset` starts a new in-process measurement.

After a reload, the extension rebuilds metrics from the active session history. It does not write a separate metrics file.

If a provider omits `cacheRead` or `cacheWrite`, the footer shows `cache n/a`.

## Footer integration

The extension publishes text under the `pi-cache` status key. The standard Pi footer shows this status.

A custom footer can read the status:

```ts
footerData.getExtensionStatuses().get("pi-cache");
```
