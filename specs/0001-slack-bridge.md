---
id: "0001"
title: "Slack bridge"
status: approved
scope: project
target_repos: [slack-bridge]
assets: none
size: mission
idea_issue: "crucibledx/slack-bridge#2"
created: 2026-11-25
---

# 0001: Slack bridge

## Problem

The Crucible workstreams (Root, Forge, Ember, Other) take work from Slack through one automation that acks top-level
messages in one channel and forwards them to Root. Thread replies never reach a workstream, so a requester who answers
a question in Slack is not heard and has to repeat it on the GitHub issue. In practice one person drives the work, and
usage cannot be attributed to the person who asked.

The bridge delivers every human message in the bridged channels, top-level or in a thread, to the workstream that owns
the channel or claimed the thread, without polling, and records who asked so usage per requester stays accurate.

## Complete, don't compete

- Slack's Events API and Web API carry the messages; Factory webhook automations ("relays") wake the workstreams. The
  bridge only connects them. It does not replace the workstreams, their prompts, or Slack.
- Factory's Slack app keeps follow-ups in a thread inside the session that thread started, and Factory's Slack
  automations start one run per top-level message and none for replies. Neither delivers a message into an existing,
  long-running workstream session chosen by routing rules, hands a thread over to another workstream, or keeps the
  workstream budgets, the issue-first flow and a per-requester ledger. Mentioning Factory directly would bypass Root's
  routing and the agent limits. This routing is specific to our workstream layout; no vendor will build it.
- Cloudflare Workers and KV run it on the free plan with no server to operate (see Cost).

## Goals

- G1. Verify every Slack request, drop repeats, ignore bots, and never loop on the bridge's or a workstream's posts.
- G2. Route each human message in a bridged channel to exactly one workstream by directive, thread claim or channel,
  and deliver it to that workstream's relay with an envelope the relays' payload filter accepts.
- G3. Let any workstream claim a thread (`POST /claim`) so later replies go to it.
- G4. Tell the requester in Slack when a relay accepted the message, or that it did not; tell the operator when the
  bridge gives up.
- G5. Publish a ledger feed (`GET /ledger`) that the existing usage-per-requester report reads without changes.
- G6. Deploy from `main` only, with every secret in GitHub Actions secrets or Worker secrets.

## Non-goals

- No replies from workstreams through the bridge: workstreams keep posting to Slack with their own Slack access.
- No issue creation, triage or answers in the Worker; the receiving workstreams keep doing that.
- No direct messages, slash commands, message edits or deletions, and no files beyond the message text.
- No quotas or caps per user (D6 decides who may use it; D8 caps each workstream), no custom domain (D7), no paid Cloudflare plan. One
  Durable Object class (the relay gate, for an exact hourly count); no other Durable Objects.

## Product defaults

Decisions for Nazar. Each default is in force until he answers; the design and the contract refer to them by ID, so a
different answer changes the matching lines only.

| ID | Decision | Default | Alternative |
|----|----------|---------|-------------|
| D1 | Ack form | Top-level message: one thread reply `Sent to <Ws>.` once the relay accepts it. Thread reply: an `eyes` reaction once accepted (scope `reactions:write`). Root also replies `Routed to <Ws>: <issue>` today, so a routed request gets two bot replies | (a) A thread message for every reply too; (b) a reaction for top-level messages as well, leaving all text to the workstreams |
| D2 | Delivery failure | Thread reply `Could not reach <Ws> yet, retrying.`; retries for 1 hour; then thread reply `Could not deliver this to <Ws>. The maintainers have been told.` and one alert message in the Root channel | Retry silently; only the alert |
| D3 | Bridged channels | `#crucible-work`, mapped to `root`. In a bridged channel, a message with no directive and no claimed thread goes to the channel's workstream (Root). Messages in channels that are not mapped are ignored. Channels change by editing the `CHANNEL_MAP` secret and re-running the deploy | Project channels for Forge, Ember and Other from day one |
| D4 | App and bot name | `Crucible` (`@Crucible ember: ...`) | Another name, set in `slack/manifest.yaml` |
| D5 | Usage counting | The bridge is the only source of `route` ledger lines: one per top-level human message in a bridged channel, so "runs" include thanks and questions Root answers itself, and the line carries no issue link (the `agent` and `pr` lines keep theirs). Thread replies are `reply` lines, which the report ignores | Root keeps writing `route` lines, with the issue link, only for messages that became issues; the bridge's top-level lines use event `message`, which the report ignores |
| D6 | Who may use it | Channel membership decides who can drive the workstreams; bridged channels should be private and invite-only. Messages from external (Slack Connect) users are ignored | An `ALLOWED_USERS` secret (user ids) checked on every message |
| D7 | Hosting | The default `workers.dev` URL; no DNS change | A custom domain on `crucibledx.dev` |
| D8 | Relay run limit | A relay drops (not delays) deliveries over its hourly run limit while still answering 200. Root raises each relay's limit to 60, the maximum. Every sender to a relay (the bridge, and Root for its deliveries to projects) reserves from one shared budget of 50 per workstream per clock hour, kept by the bridge; 10 runs stay free for manual and test deliveries. Over budget, the bridge holds the message until the next hour with a notice naming that hour | Relays stay at 30 an hour and the shared budget is 25 |

## Design

### Overview

```
Slack (message.channels, message.groups)
  │ HTTPS, signed
  ▼
Worker  POST /slack/events ─ verify ─ filter ─ dedupe ─ route ─ record + thread map (KV) ─▶ 200 to Slack
          │ waitUntil
          ├─▶ POST relay[ws] (X-Webhook-Secret) ─ retry ─▶ pending (KV) ─▶ cron every 10 min
          └─▶ chat.postMessage / reactions.add (D1, D2)
        POST /claim   (Bearer) ─▶ thread map (KV)
        POST /reserve (Bearer) ─▶ RelayGate (Durable Object, one per workstream) ◀─ every send
        GET  /ledger  (Bearer) ◀─ message records (KV)
        GET  /health           ─▶ config check, no data
```

Workstreams (`ws`) are `root`, `forge`, `ember`, `other`; display names `Root`, `Forge`, `Ember`, `Other`.

### Code layout

TypeScript Cloudflare Worker, Bun for install and tests, `wrangler` (a pinned `devDependency`, 4.45 or later) for
build and deploy, `@cloudflare/workers-types` for the runtime types. The org layout applies: `src/domain/` (`zod`
schemas, routing, envelope, ledger line; no I/O), `src/application/` (`handleSlackEvent`, `claimThread`, `readLedger`,
`retryPending`, `reserve`), `src/infrastructure/` (router, signature check, Slack Web API client, relay client, KV
store, the `RelayGate` Durable Object, logging), `src/index.ts` (`fetch`, `scheduled` and the `RelayGate` export). Unit tests use in-memory fakes for KV, `fetch` and the clock; no
network. `AGENTS.md` changes "dedupe by `event_id`" to the message key below.

### Configuration

All configuration is Worker secrets, validated with `zod` on first use in each isolate:

| Secret | Shape |
|--------|-------|
| `SLACK_SIGNING_SECRET` | non-empty string |
| `SLACK_BOT_TOKEN` | string starting `xoxb-` |
| `CHANNEL_MAP` | JSON object, Slack channel id → `ws`, with at least one channel mapped to `root` (the alert channel, D2, D3) |
| `RELAY_URLS` | JSON object `ws` → `https://` URL. `root` and every `ws` in `CHANNEL_MAP` are required; others optional |
| `RELAY_SECRETS` | JSON object with exactly the keys of `RELAY_URLS`, each a non-empty string |
| `BRIDGE_TOKEN` | string of at least 32 characters, the bearer token for `/claim`, `/reserve` and `/ledger` |

A workstream with no relay entry is "not connected". Invalid configuration: `GET /health` returns 503 naming the bad
secret (never its value); `/slack/events` returns 200 and logs `config_invalid` (a 5xx makes Slack retry and
eventually disable the app); `/claim` and `/ledger` return 503.

### Slack events endpoint: `POST /slack/events`

1. **Size.** The body is read with a 256 KB cap, whatever `Content-Length` says; over it, 413.
2. **Signature.** `X-Slack-Request-Timestamp` within 300 s of now, and `X-Slack-Signature` equal to `v0=` + hex
   HMAC-SHA256 of `v0:<timestamp>:<raw body>` with `SLACK_SIGNING_SECRET`, checked in constant time
   (`crypto.subtle.verify`). Otherwise 401 and nothing else happens.
3. **URL verification.** `type: url_verification` returns 200 `{"challenge": <challenge>}`.
4. **Envelope.** Only `type: event_callback` with `event.type: message` is processed; anything else gets 200. The
   payload is parsed with a `zod` schema; a payload that fails it gets 200 and a `bad_payload` log line.
5. **Filter** (200, logged as `ignored:<reason>`):
   - `bot`: `event.bot_id` is set, `event.user` is missing, or `event.user` is the bridge's own bot user
     (`authorizations[0].user_id`). The workstreams post through Factory's Slack app, whose messages carry `bot_id`,
     so neither the bridge's acks nor workstream posts loop back.
   - `subtype`: `event.subtype` is set and is not `file_share` or `thread_broadcast`.
   - `channel`: `event.channel` is not a key of `CHANNEL_MAP` (D3).
   - `external`: `event.user_team` is set and differs from the payload's `team_id` (D6).
6. **Dedupe.** If the message record (below) exists, 200 and stop. KV is eventually consistent, so this is best
   effort; Factory's relay also drops an identical body within 10 minutes, and Root keeps its own dedupe.
7. **Route** (next section), then write the message record and, for a top-level message, the thread map; respond 200.
   Delivery and acks run in `ctx.waitUntil`. Every KV failure is logged as `kv_limit` and handled so a message is
   never lost or sent over the relay limit: a failed write still delivers; a failed dedupe read delivers; a failed
   thread-map read routes by channel; a failed relay-gate call holds the envelope as pending (and, if that write
   fails too, it is given up with the D2 notice); a failed cron list skips that run.

`app_mention` is not subscribed: Slack sends it in addition to the `message` event for the same message, which would
deliver mentions twice. Mentions are read from the message text instead.

### Routing

A pure function `route(message, channelMap, claimedWs, connected, botUserId) → { ws, kind, via, unconnected? }`.

- `kind` is `reply` when `thread_ts` is set and differs from `ts`, else `top`; `thread_broadcast` messages are replies.
- **Directives**, on the text with leading whitespace removed, case-insensitive:
  - prefix (`via: prefix`): `^(root|forge|ember|other)\s*:`;
  - mention (`via: mention`): `^<@BOT(\|[^>]*)?>\s*(root|forge|ember|other)\s*[:,]`, `BOT` being the bot user id.
    The separator is required, so `@Crucible other than that, ...` is plain text.
- Precedence, first match wins: (1) a directive naming a connected workstream; (2) for a reply, the thread map entry
  for `(channel, thread_ts)` if that workstream is connected, `via: thread`; (3) the channel's `CHANNEL_MAP` entry,
  `via: channel` (always connected, see Configuration).
- A directive or a thread owner naming a workstream that is not connected (for example, its relay was removed after
  it claimed the thread) falls through and sets `unconnected`, so the ack reads
  `<Ws> is not connected yet; sent to <Target>.` The stale thread entry is left to expire.
- Mapped and unmapped channels: inside a bridged channel, a message with no directive and no claimed thread goes to
  the channel's workstream, Root for `#crucible-work`. Messages in channels outside `CHANNEL_MAP` are dropped by the
  filter and never routed.
- A directive in a reply routes that message only and leaves the claim unchanged. Text is delivered verbatim, prefix
  included. A mention without a workstream word routes like plain text.

### Thread map and claims

- Key `thread:<channel>:<thread_ts>`, value the `ws`, TTL 30 days. A top-level message writes its own thread with the
  routed `ws` in the request path, before the 200, so a later claim wins. KV is eventually consistent, so for up to
  about 60 s after a claim a reply can still route to the previous owner (see Receivers). Replies do not refresh the
  TTL; a thread unclaimed for 30 days falls back to its channel's workstream.
- `POST /claim`, `Authorization: Bearer <BRIDGE_TOKEN>` (constant-time compare), body
  `{"channel":"C…","thread_ts":"…","ws":"forge"}` validated with `zod`: `thread_ts` matches `^\d+\.\d+$`, `ws` is one
  of the four and connected, `channel` is a key of `CHANNEL_MAP`. Last claim wins; each claim resets the TTL to 30
  days.
  - 200 `{"ok":true,"channel","thread_ts","ws","previous":<ws or null>}`;
  - 401 missing or wrong token; 400 invalid body, unbridged channel or `not_connected` (`{"ok":false,"error":"…"}`);
    405 other methods; 503 invalid configuration. Claiming posts nothing to Slack.

### Relay gate and `POST /reserve`

The hourly budget (D8) lives in `RelayGate`, a SQLite-backed Durable Object with one instance per workstream
(`idFromName(ws)`). A Durable Object handles one call at a time, so `reserve(now)` is atomic: if fewer than 50
reservations exist for the current UTC hour it records one and returns `{ok:true}`, else `{ok:false, retry_at}` (the
next hour). Factory's run limit resets at the top of each hour, so a clock-hour count matches it. Rows for past hours
are deleted on the next reservation.

- The bridge reserves before every send, from the request or the cron. A refusal, or a failed or timed-out (2 s) gate
  call, holds the envelope (fail closed).
- Root reserves before each delivery it makes to a project relay: `POST /reserve`, `Authorization: Bearer
  <BRIDGE_TOKEN>`, body `{"ws":"forge"}`. 200 `{"ok":true}`; 429 `{"ok":false,"retry_at":"<ISO>"}`; 401 bad token;
  400 invalid or unconnected `ws`; 405 other methods; 503 invalid configuration or gate unavailable. On anything but
  200, Root keeps the delivery in its own pending list and retries on its next tick (hq#18).

### Relay delivery and envelope

The Worker POSTs to `RELAY_URLS[ws]` with `Content-Type: application/json` and `X-Webhook-Secret: RELAY_SECRETS[ws]`.
The body is `JSON.stringify` of exactly these keys, in this order:

```json
{"source":"crucible-bridge","kind":"top","ws":"forge","channel":"C…","ts":"…","thread_ts":"…","user":"U…","user_name":"…","text":"…"}
```

- `kind` is `top` or `reply`. `thread_ts` is the thread root, equal to `ts` for a top-level message.
- `user_name` is the profile display name, else the real name, else the user id when `users.info` fails or times out
  (cached in memory per isolate).
- `text` is capped at 16,000 characters; longer text is cut and ends with `… [truncated, see the Slack thread]`.
- Every relay's payload filter is `"source"\s*:\s*"crucible-(root|bridge)"`. `JSON.stringify` escapes quotes in `text`
  and `source` is the first key, so message text cannot fake or break the match.

The relay receiver answers before any run starts, so a 2xx means "accepted by the relay", not "read by the
workstream". Factory records each accepted delivery as Dispatched, Filtered, Deduped (identical body within 10
minutes), Rate-capped (over the hourly run limit), Skipped (automation paused, a run in progress, or its computer over
capacity) or Failed. The bridge avoids the ones it can: every body is unique (`ts`), the filter always matches, and D8
keeps it under the run limit. The relays deliver into an existing workstream session; their Events feeds show
deliveries 3 seconds apart all Dispatched while the session was busy, so "a run in progress" does not drop them. AC-35
checks this live with two messages to one workstream within a minute; if either is not Dispatched, delivery
confirmation becomes a spec change before #5. Handling by response:

| Response | Meaning (Factory docs) | Bridge action |
|----------|------------------------|---------------|
| 2xx | Accepted. A delivery over the run limit or not matching the filter is also accepted and then dropped | Ack (D1); D8 keeps the bridge under the limit |
| 429 | Over 60 requests a minute to that URL | Straight to pending |
| 5xx, network error, timeout | Transient | Retry in the request, then pending |
| 401, 404, 413, other 4xx | Wrong secret, unknown URL, body too large | No retry: give up (D2) and alert at once |

Timing inside `waitUntil`: each relay attempt times out after 5 s and each Slack Web API call after 3 s. Retries come
after 2 s and 6 s, but only while the next attempt can finish within 20 s of the response; otherwise the envelope goes
to pending at once. So the pending write and the D2 notice always happen before Cloudflare ends `waitUntil` work.

Hourly budget (D8): a send the relay gate refuses goes to pending with `not_before` = `retry_at`, and the hold notice
`<Ws> is at its hourly limit; this will be sent after <HH>:00 UTC.` is posted instead of the D2 "retrying" notice.

Pending: key `pending:<channel>:<ts>`, value the envelope, `attempts`, `not_before` and `deadline` (1 hour after the
entry was first stored, whatever the reason: failure or budget hold), TTL 24 hours as a backstop only. A cron trigger
(`*/10 * * * *`) lists `pending:` keys and handles at most 8 entries per run (the free plan allows 50 subrequests),
expired entries first, then the oldest message first:

- past `deadline`: the D2 give-up notice is posted and the entry deleted, even if it never got a budget reservation;
- target workstream no longer connected: re-routed by channel with the "not connected" note;
- `not_before` in the future: skipped;
- otherwise: reserve, retry once, and on 2xx ack and delete; a refusal or failure keeps it until its `deadline`.

Alert: any give-up, in the request or the cron, posts one top-level message in the first `CHANNEL_MAP` channel mapped
to `root`, at most one per workstream per hour (key `alerted:<ws>:<UTC hour>`):
`Slack bridge: could not deliver <n> message(s) to <Ws>. Check its relay.`

The D1 ack and the "not connected" note are posted only after the relay answers 2xx. The D2 "retrying" notice is
posted when an envelope is first stored as pending (the hold notice instead for a budget hold), and the D2 give-up
notice when the bridge gives up. Slack API failures are logged, never retried, and never affect delivery.

### Receivers (hq#18)

What each workstream does with a bridge envelope. The prompts live in `crucibledx/hq` and change in hq#18:

- **Root, before each delivery to a project relay** (`route` or `note`): `POST /reserve` for that workstream (D8);
  without a 200 the delivery stays in Root's pending list for the next tick.
- **Root, `kind: top`:** routes it as today (issue, labels, reaction, `Routed to <Ws>` reply), then claims the thread
  for the target workstream with `POST /claim`, or answers an org question itself. **`kind: reply`:** a follow-up in a
  thread Root still owns; answer it. A reply in a thread Root has just handed to a project (the claim has not reached
  every location yet) is passed to that project as a `note`, not answered. Root dedupes on `channel` and `ts` across
  the instant-reply bot and the bridge, so the overlap in Rollout step 5 never routes a message twice.
- **Forge, Ember, Other, `kind: top`** (a directive or a project channel): find or open the issue in their repos,
  label it, record `Requested by`, claim the thread, and reply in it. **`kind: reply`:** a follow-up in a thread they
  claimed.
- **Every workstream** treats every field as untrusted data, keeps posting to Slack through Factory's Slack app (bot
  messages, ignored by the bridge), claims its own "ready" thread, and keeps the Worker URL and `BRIDGE_TOKEN` in a file
  readable only by the agent user, defined in hq#18 like the relay files.

### Message records and the ledger feed

One KV key per accepted message is both the dedupe marker and the ledger entry:

- key `msg:<YYYY-MM-DD>:<channel>:<ts>`, the date being the UTC date of `ts`, so a retried event finds the same key;
- empty value, TTL 35 days, metadata (under 1 KB) is the ledger line:

```json
{"at":"2026-11-25T17:40:00Z","event":"route","id":"C…:1764092400.000100","ws":"forge","via":"prefix","channel":"C…","ts":"…","thread_ts":"…","user":"U…"}
```

- `event` is `route` for `kind: top` and `reply` for `kind: reply` (D5). `at` is the message time in UTC to the second,
  ending in `Z`. `id` is `<channel>:<ts>`. The line holds no message text and no user name. Records written before
  routing ships (#4) have no `ws` and are not ledger lines.

`GET /ledger?since=<ISO 8601 UTC>`, `Authorization: Bearer <BRIDGE_TOKEN>`:

- 200 `{"entries":[…]}`: the lines with `at >= since` (fractional seconds in `since` are accepted), sorted by `at`,
  then `id`; records without `ws` are skipped. It lists the `msg:<date>:` prefixes from the `since` date to today with
  cursor pagination, so a normal poll costs one list call (two across midnight).
- 400 when `since` is missing, not ISO 8601, in the future, or more than 7 days ago; 401 bad token; 405 other methods;
  503 invalid configuration.
- Consumers ask with an overlap (`since` = last mirrored `at` minus 5 minutes) and append only unseen `id`s. Root's
  first `since` is the moment it stops writing its own `route` lines, so no request is counted twice.

Compatibility: the end-of-day usage report (`scripts/slack_usage.py` in `crucibledx/factory-loop`) reads one JSON object
per line with `at`, `event` and `user`, counts `route` lines as runs, requires `user` to match `[A-Z][A-Z0-9]+`, and
ignores events it does not know. Mirrored `/ledger` lines keep it working unchanged, next to the `agent` and `pr` lines.

### Health and logging

- `GET /health` → 200 `{"ok":true}` or 503 `{"ok":false,"error":"<SECRET_NAME> is invalid"}`. No other data.
- Any other path → 404; wrong method on a known path → 405.
- Workers Logs (`observability.enabled`), one JSON line per decision with `event_id`, `channel`, `ts`, `outcome`
  (`recorded`, `delivered`, `ignored:<reason>`, `pending`, `failed`, `kv_limit`, `config_invalid`, `bad_payload`), `ws`,
  `via` and the relay status code. Never message text, user ids or names, tokens, secrets or relay URLs.

### Deploy and secrets

- `.github/workflows/ci.yml` calls the org CI (`loop-ci.yml`): format check, lint, typecheck, `bun test`, and build
  (`wrangler deploy --dry-run --outdir dist`).
- `.github/workflows/deploy.yml` runs only on `push` to `main` and `workflow_dispatch`, never on `pull_request`, and
  its job has `if: github.ref == 'refs/heads/main'`, so a manual run on any other branch or tag deploys nothing:
  1. `scripts/check-secrets.sh` reads the 8 secrets from `env` and exits non-zero naming each missing one, printing no
     values;
  2. `cloudflare/wrangler-action`, pinned to a commit SHA, with `wranglerVersion` equal to the `package.json` version,
     runs `wrangler deploy` (the first run creates the Worker), then `wrangler secret bulk` with a JSON object built
     by `jq -n --arg` from `env` and piped on stdin, so no value is echoed or written to disk;
  3. `scripts/check-health.sh <deployment-url>` calls `/health` and fails the job on anything but 200, printing only
     the `error` field.
- The workflow has `concurrency: deploy` without cancel-in-progress, so two merges never overlap their deploys.
- `wrangler.jsonc` declares the `RelayGate` Durable Object binding and its `new_sqlite_classes` migration (available on
  the free plan).
- The KV namespace is a binding without an id; wrangler's automatic provisioning creates it on the first deploy and
  keeps it linked. If provisioning fails, Nazar creates the namespace and its id is committed (it is not a secret).
- First-deploy prerequisites: the Cloudflare account has a `workers.dev` subdomain.
- Change and rotation: edit the GitHub secret, then run the deploy with `workflow_dispatch`, which re-uploads every
  Worker secret. A new channel also needs the bot invited. A new `BRIDGE_TOKEN` also goes into the workstreams' file.

GitHub Actions secrets Nazar creates in `crucibledx/slack-bridge` (8):

| GitHub secret | Becomes | Where it comes from |
|---------------|---------|---------------------|
| `CLOUDFLARE_API_TOKEN` | wrangler only | Account API token with Workers Scripts: Edit and Workers KV Storage: Edit on the Crucible account. Add Account Settings: Read only if the deploy reports it missing |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler only | Cloudflare dashboard |
| `SLACK_SIGNING_SECRET` | Worker secret | Slack app, Basic Information |
| `SLACK_BOT_TOKEN` | Worker secret | Slack app, OAuth & Permissions, after install |
| `CHANNEL_MAP` | Worker secret | JSON per D3 |
| `RELAY_URLS` | Worker secret | JSON map of relay receiver URLs, from Root |
| `RELAY_SECRETS` | Worker secret | JSON map of relay webhook secrets, handed over out of band (not through Slack or GitHub) |
| `BRIDGE_TOKEN` | Worker secret | `openssl rand -hex 32`; the same value goes into the workstreams' file |

No secret, real channel id, user id or relay URL is committed or used in fixtures (fixtures use fakes such as
`C000TEST`). Logs carry channel ids and `ts` (see Health and logging) but never user ids, secrets or relay URLs.

### Slack app manifest

`slack/manifest.yaml`: app and bot name per D4; bot scopes `channels:history`, `groups:history`, `chat:write`,
`reactions:write` (D1), `users:read`; bot events `message.channels`, `message.groups`; request URL
`https://slack-bridge.<subdomain>.workers.dev/slack/events` with `<subdomain>` left for Nazar; socket mode,
interactivity and slash commands off. The README gives the setup order in Rollout steps 1-2.

## Implementation split

Each issue is one PR under about 1,500 changed lines and closes the listed contract rows. Order: #3, #4, then hq#18
(prompts must handle bridge envelopes before anything is delivered), then #6, then #5 (the ledger needs routed
records). Live rows run after the deploy and are recorded as a comment on the listed issue, ids redacted.

| Issue | Scope | Rows |
|-------|-------|------|
| slack-bridge#3 Worker skeleton, CI and deploy | Code layout, Configuration, Health and logging, Deploy and secrets, Slack app manifest; the loop contract gains install and checks | AC-1 to AC-9, AC-41 |
| slack-bridge#4 Slack events endpoint | Events endpoint steps 1-7 without routing or delivery: records have no `ws`, nothing is acked, so the deployed bridge stays silent. Dedupe uses the message record key, which also covers the issue's `event_id` dedupe (Slack retries reuse both). The ack moved to #6 | AC-10 to AC-19 |
| crucibledx/hq#18 Prompts and docs | Receivers, credentials file, claims, attribution and mentions, ledger mirroring and cutover, retiring the instant reply right after the first acked test message, D8 relay limits and Root's `POST /reserve` calls. Merges before #6 | AC-40 |
| slack-bridge#6 Routing and relay delivery | Routing, Thread map and claims, Relay delivery (envelope, retries, hourly budget, pending, cron, acks), Slack Web API client. Merge preconditions: Rollout step 4, confirmed in the PR body. If it exceeds the size limit, it splits into routing and `/claim` (AC-20 to AC-26, safe to deploy alone: nothing is delivered), then delivery (AC-27 to AC-35, AC-42, AC-43); the merge preconditions apply to the delivery half | AC-20 to AC-35, AC-42, AC-43 |
| slack-bridge#5 Ledger feed | `GET /ledger`, compatibility with the usage report, Root's mirroring; the end-to-end check (AC-39) is recorded on this issue | AC-36 to AC-39 |
| crucibledx/factory-loop#21 Usage per requester (merged) | No change; kept compatible by AC-38 | — |

## Rollout

1. Done: Root's relay payload filter accepts `crucible-bridge` as well as the current bot source. Project relays
   already accept it.
2. #3 merges; its first deploy run fails at the secrets check, as expected. Nazar creates the Slack app from the manifest (if Slack refuses the unverified request URL, he removes
   `settings.event_subscriptions` for creation and adds it back in step 3), installs it, and copies the signing secret
   and bot token; creates the Cloudflare token; sets the 8 GitHub secrets; re-runs the deploy. `/health` is 200 (AC-9).
3. #4 merges and deploys. Nazar retries the request URL verification and invites the bot to `#crucible-work`. Events
   are recorded; nothing is delivered (AC-19).
4. Preconditions for merging #6, confirmed in its PR body: hq#18 merged, Root's relay prompt updated to handle bridge
   envelopes (Root), relay limits raised per D8 (Root), and the workstreams' file holds the Worker URL and token.
5. #6 merges and deploys. One test message is sent; once it is acked, Root pauses the instant-reply automation so no
   message is acked twice (AC-35). Until then Root sees top-level messages from both and its dedupe drops the second.
6. #5 merges and deploys. Root's tick mirrors `GET /ledger` and stops writing `route` lines (D5). A second Slack user
   runs the end-to-end check (AC-39); hq docs drop the "thread replies are not forwarded" limit.

Rollback: disable the request URL in the Slack app, remove the cron trigger (or disable the Worker) so pending entries
stop, re-enable the instant-reply automation, and have Root write its own `route` lines again and stop mirroring
`/ledger`. No data migration.

## Cost

Everything fits the Cloudflare Workers free plan. Expected volume with several active users: about 50 top-level
messages and 150 thread replies a day, plus about 500 bot messages (acks and workstream posts) that Slack also sends
and the Worker filters.

| Resource | Free limit | Expected use per day |
|----------|------------|----------------------|
| Worker requests | 100,000 | ~1,100 (700 events, 144 cron runs, ~150 ledger polls, claims, ~50 Root reservations) |
| CPU per request | 10 ms | ~1-3 ms: one HMAC and one JSON parse; network waits do not count |
| Subrequests per request | 50 | ≤ ~12 per event; ≤ ~36 per cron run (8 entries) |
| Cron triggers per account | 5 | 1 |
| KV reads | 100,000 | ~400 (dedupe and thread lookups) |
| KV writes | 1,000 | ~300 (1 per message, 1 more per top-level, 1 per claim, rare pending and alerts) |
| Durable Object requests | 100,000 | ~250 (1 reservation per delivery, bridge and Root) |
| Durable Object rows written | 100,000 | ~500 (1 per reservation, plus deletes of past hours) |
| KV lists | 1,000 | ~300 (144 cron, ~150 ledger polls) |
| KV storage | 1 GB | under 5 MB (records under 1 KB, 35-day TTL) |

KV writes are the first limit, at about 600 human messages a day; past it the bridge still delivers (dedupe and ledger are
lost and logged as `kv_limit`). KV lists come next. The fix for both is Workers Paid ($5 a month). The real cost driver
is outside Cloudflare: every delivered message is a workstream model turn, bounded per workstream by D8.

## Open questions

- D1 to D8 above, for Nazar.

## Acceptance contract

Written before implementation. The implementing agent may not edit this section. Test file names are suggestions;
the check is the behavior.

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|----|----------------------------|--------------|-----------------------|
| AC-1 | Install, format check, lint, typecheck, `bun test` and build pass in CI; from #5, the `ledger-compat` job too | test | `gh pr checks`: `ci / quality`, `ci / test`, `ci / build` (and `ledger-compat`) green |
| AC-2 | Only `deploy.yml` runs `wrangler deploy` without `--dry-run`; it triggers only on `push` to `main` and `workflow_dispatch`, its deploy job has `if: github.ref == 'refs/heads/main'`, and it has a `deploy` concurrency group without cancel-in-progress; `wrangler-action` is pinned to a SHA and its `wranglerVersion` equals `package.json` | test | `actionlint`; a test parses `.github/workflows/*.yml` and checks each condition, so a `workflow_dispatch` on another ref cannot reach the deploy step |
| AC-3 | `scripts/check-secrets.sh` exits non-zero naming each missing one of the 8 secrets and never prints a value | test | Test runs it with fake values and one or more unset: exit code, names in stderr, no fake value in any output |
| AC-4 | No secret, Slack id or relay URL in tracked files | test | Test greps tracked files for `xox[abpr]-[0-9A-Za-z-]{10,}` (a bare documented prefix such as `xoxb-` passes), `hooks\.slack\.com`, `api\.factory\.ai/api/webhooks/` and `\b[CUGTW](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b`, allowing only fakes matching `[CUGTW]000TEST\w*`; the scanner test covers a token-shaped string (fails) and the bare prefix (passes) |
| AC-5 | `/health` is 200 with valid config and 503 naming the first invalid secret without its value, including a missing `root` relay, a `CHANNEL_MAP` workstream without a relay, a `CHANNEL_MAP` with no channel mapped to `root`, and mismatched `RELAY_URLS`/`RELAY_SECRETS` keys | test | `test/health.test.ts`, one case each |
| AC-6 | Unknown path → 404; wrong method on a known path → 405 | test | `test/router.test.ts` |
| AC-7 | `slack/manifest.yaml` has exactly the scopes and events in this spec and the D4 name | test | Test parses the manifest and compares |
| AC-8 | `scripts/check-health.sh` fails on a non-200 `/health`, printing only the `error` field | test | Test runs it against a local stub server returning 503 with a fake secret name |
| AC-9 | After #3 merges and the secrets are set, the `workflow_dispatch` re-run of the deploy on `main` is green, including the secret upload, and `/health` returns 200 | e2e | Live: run link and `/health` response, comment on #4 |
| AC-10 | `url_verification` with a valid signature returns the challenge | test | `test/events.test.ts` |
| AC-11 | Bad signature, missing headers, or a timestamp more than 300 s off → 401 with no KV or network call | test | `test/signature.test.ts`; fakes record zero calls |
| AC-12 | A body over 256 KB → 413, also when `Content-Length` is missing or understated | test | `test/events.test.ts` |
| AC-13 | `bot_id` set, own bot user, no `user`, and subtypes other than `file_share`/`thread_broadcast` → 200, `ignored:<reason>`, nothing written | test | Table test, one case per reason; `file_share` and `thread_broadcast` pass |
| AC-14 | Messages in channels not in `CHANNEL_MAP`, and from external users (`user_team` ≠ `team_id`), → 200, ignored, nothing written | test | `test/events.test.ts` |
| AC-15 | The same signed event sent twice produces one record (and, from #6, one delivery) | test | Twice against fake KV and fetch |
| AC-16 | Invalid config → `/slack/events` 200 and `config_invalid`; a payload failing the schema → 200 and `bad_payload`; an `event_callback` whose event is not `message` → 200, nothing written | test | `test/events.test.ts` |
| AC-17 | A failing KV write is logged as `kv_limit` and the request still returns 200 (from #6, the message is still delivered) | test | Fake KV whose `put` throws |
| AC-18 | A record is `msg:<UTC date of ts>:<channel>:<ts>` with TTL 35 days and metadata without text or user name; an accepted message costs one KV write, plus one for a top-level thread map from #6 | test | `test/events.test.ts` counts fake KV writes and inspects keys |
| AC-19 | After #4 deploys, Slack's URL verification passes and a real message is logged as `recorded` | e2e | Live: Slack app screen and log line, comment on #6 |
| AC-20 | `root:`/`forge:`/`ember:`/`other:` (any case, leading spaces) routes to that workstream, `via: prefix` | test | `test/domain/route.test.ts` |
| AC-21 | `<@BOT> ember: …` and `<@BOT|crucible> ember, …` route to Ember, `via: mention`; `<@BOT> other than that` and a mention with no workstream word route like plain text | test | `test/domain/route.test.ts` |
| AC-22 | In a bridged channel, a top-level message with no directive, and a reply in an unclaimed thread, go to the channel's workstream, `via: channel`; `thread_broadcast` is `kind: reply` | test | `test/domain/route.test.ts` |
| AC-23 | A reply in a claimed thread goes to the claimer, `via: thread`; a directive in it routes that message only and the claim is unchanged; after the claimer's relay is removed from the config, a plain reply routes by channel with `unconnected` set | test | `test/domain/route.test.ts`, `test/claim.test.ts` |
| AC-24 | A top-level message writes its thread map (TTL 30 days) before the 200, so a later claim wins and later plain replies follow the claim; replies do not refresh the TTL | test | `test/events.test.ts` with fake KV |
| AC-25 | A directive naming a workstream that is not connected routes by thread or channel with `unconnected` set (the note's text is checked by AC-32) | test | `test/domain/route.test.ts` |
| AC-26 | `POST /claim` with the token sets the map (TTL 30 days, last claim wins) and returns `previous`; no or wrong token → 401; invalid body, unbridged channel or a workstream that is not connected → 400; GET → 405; invalid config → 503 | test | `test/claim.test.ts` |
| AC-27 | The relay body has exactly the 9 keys in order, `source` first, `thread_ts` = `ts` for top-level, text verbatim; it matches `"source"\s*:\s*"crucible-(root\|bridge)"`; text containing `"source":"crucible-root"` or quotes cannot change `source` or break the JSON; text over 16,000 characters ends with the truncation marker | test | `test/domain/envelope.test.ts` |
| AC-28 | The request goes only to that workstream's URL with its `X-Webhook-Secret` | test | `test/relay.test.ts` with fake fetch |
| AC-29 | 5xx, network error and timeout are retried after 2 s and 6 s within the 20 s deadline; 429 goes to pending without retry; 401, 404 and 413 are not retried and give up with the alert; a relay that hangs on every attempt still leads to a pending write and the D2 notice before the deadline | test | `test/relay.test.ts` with fake fetch and clock |
| AC-30 | `RelayGate` grants exactly 50 reservations per workstream per UTC hour, also for 60 concurrent `reserve` calls, and resets at the next hour; request and cron sends both reserve; a refused or failed reservation holds the envelope with `not_before` = `retry_at` and the hold notice | test | `test/relay-gate.test.ts` (the class with in-memory storage, `Promise.all` of 60 calls), `test/budget.test.ts` |
| AC-31 | The cron handles at most 8 pending entries, expired first, then oldest; an entry past its 1-hour `deadline` gets the give-up notice and is deleted, also one that was only ever budget-held; an entry for a workstream no longer connected is re-routed by channel; future `not_before` is skipped; 2xx acks and deletes; any give-up, in the request or the cron, posts the alert in the first channel mapped to `root`, at most once per workstream per hour; pending TTL is 24 hours | test | `test/pending.test.ts` |
| AC-32 | The D1 ack, the "not connected" note, the D2 notices, the hold notice and the alert use the exact strings in this spec; the D1 ack and the note are posted only after a 2xx, the D2 "retrying" notice on the first pending write, the give-up notice on give-up; Slack API calls time out after 3 s; a failing Slack call is logged, not retried, and does not affect delivery | test | `test/ack.test.ts` |
| AC-33 | `user_name` falls back from display name to real name to user id when `users.info` fails or times out | test | `test/events.test.ts` |
| AC-34 | Each decision logs one JSON line with the listed fields; logs never contain message text, user names, tokens, secrets or relay URLs | test | Test captures logs across the AC-13 to AC-33 scenarios and greps for the fixture values |
| AC-35 | After #6 deploys, a real top-level message is delivered to Root's relay (Dispatched in its Events feed) and acked; two messages sent to one workstream within a minute are both Dispatched; a workstream's post in that thread logs `ignored:bot` | e2e | Live: Events feed entry and log lines, comment on #5 |
| AC-36 | `GET /ledger?since=` with the token returns lines with `at >= since` sorted by `at` then `id`, `route` for top-level and `reply` for replies, no text or user name, records without `ws` skipped, fractional seconds accepted | test | `test/ledger.test.ts` |
| AC-37 | `/ledger` → 401 without the token; 400 for missing, malformed, future or older-than-7-days `since`; 405 for POST; 503 for invalid config | test | `test/ledger.test.ts` |
| AC-38 | Lines from `/ledger` appended to a ledger file are read by `slack_usage.py` without warnings, counting one run per top-level message and none for replies | test | CI job `ledger-compat` fetches `scripts/slack_usage.py` from `crucibledx/factory-loop` at a pinned commit (`0cc5cd0` or later) and runs it with `TZ=UTC` and an explicit date on the test's output: stdout equals the expected lines, stderr is empty |
| AC-39 | End to end: a second Slack user posts a request in `#crucible-work`, a workstream claims the thread, the user replies there, the reply reaches that workstream's session as `kind: reply` without polling, the PR and Slack replies name the user, and the end-of-day summary shows the user's usage | e2e | Live after #5: thread link, relay delivery, PR, summary line, ids redacted, comment on #5 |
| AC-40 | hq docs describe the receivers for `kind: top` and `kind: reply` from `crucible-bridge`, `/claim` calls including the ready thread, the credentials file, ledger mirroring and its cutover, the D8 relay limits and Root reserving through `POST /reserve` before each delivery to a project, Root passing replies in just-handed-over threads as a `note`, Root's `channel`/`ts` dedupe across both sources, and the retired instant reply; no "thread replies are not forwarded" limit remains | doc | `crucibledx/hq` `docs/workstream.md` and `docs/workstreams/*.md` |
| AC-41 | `.factory/loop-contract.md` lists the install command and the CI checks, and `AGENTS.md` describes dedupe by the message key instead of `event_id` | doc | Both files in the #3 PR |
| AC-42 | With a fake KV whose `get` or `list` throws: a failed dedupe read still delivers, a failed thread-map read routes by channel, a failed or slow relay-gate call holds the envelope as pending, and a failed cron list skips the run; each logs `kv_limit` | test | `test/kv-failure.test.ts` |
| AC-43 | `POST /reserve` with the token returns 200 while the workstream has budget and 429 with `retry_at` once 50 are reserved, sharing the count with the bridge's own sends; no or wrong token → 401; invalid or unconnected `ws` → 400; GET → 405; invalid config → 503 | test | `test/reserve.test.ts` |
