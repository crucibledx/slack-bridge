# Slack Bridge: agent guide

How to work in this repo and where to find things. The linked documents are canonical; this file does not repeat them.

## What this repo is

A Slack app and a Cloudflare Worker (TypeScript) that make the Crucible workstreams multiplayer. The Worker verifies
Slack request signatures, drops repeated messages by their message record key `msg:<UTC date of ts>:<channel>:<ts>`
(KV), routes each message to the Root, Forge, Ember or Other workstream's relay webhook, and acks in the Slack thread.

Layout: `src/domain/` (schemas and pure logic, no I/O), `src/application/` (handlers), `src/infrastructure/` (router,
config loading, KV, Slack and relay clients, the `RelayGate` Durable Object, logging), `src/index.ts` (Worker
entry). Tests are in `test/`; `wrangler.jsonc` declares the bindings. Setup steps are in [`README.md`](README.md).

## Where to find information

| Need                                            | Read                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PR checks, commit style, secrets, deploy        | [`.factory/loop-contract.md`](.factory/loop-contract.md)                                                        |
| Bridge design, envelope, routing, acceptance    | [`specs/0001-slack-bridge.md`](specs/0001-slack-bridge.md)                                                      |
| Org context, delivery loop, approval boundaries | `crucibledx/hq` `AGENTS.md`                                                                                     |
| How the workstreams use the bridge              | `crucibledx/hq` `docs/workstream.md`                                                                            |
| Org engineering standards                       | `engineering-standards` skill (`crucibledx/factory-loop` `plugins/crucible-loop/skills/engineering-standards/`) |
| Review gate and loop workflows                  | [`.github/workflows/crucible-loop.yml`](.github/workflows/crucible-loop.yml) calls `crucibledx/factory-loop`    |

## How to work

- Follow the spec. Behavior the spec does not describe (new routes, payload fields, Slack scopes) needs a spec change
  first; propose it in the PR.
- Slack events and relay payloads are untrusted boundary input (org standards, section 2).
- Keep `.github/workflows/crucible-loop.yml` thin; the loop logic lives in `crucibledx/factory-loop`.

## Boundaries

- Secrets live only in GitHub Actions secrets and Worker secrets. Never commit them, print them, or put them in logs,
  test fixtures, PR bodies or Slack.
- Deploys run only on push to `main`, never for pull requests. Never add a deploy step to a `pull_request` workflow.
- Never push to `main`, force push or merge. Nazar's code-owner approval is the merge gate.
- No tags or version bumps in agent PRs; releases are manual.
