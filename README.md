# Tundish

Tundish (the renamed slack-bridge) is a Slack app and a Cloudflare Worker that deliver every human message in the bridged Slack channels to the Crucible
workstream (Root, Forge, Ember or Other) that owns the channel or claimed the thread. The design and its acceptance
contract are in [`specs/0001-slack-bridge.md`](specs/0001-slack-bridge.md).

## Setup

Follow this order. The first deploy run after the merge fails at the secrets check; that is expected.

1. Create the Slack app from [`slack/manifest.yaml`](slack/manifest.yaml) (api.slack.com/apps > Create New App > From
   a manifest), with `<subdomain>` replaced by the Cloudflare account's `workers.dev` subdomain. If Slack refuses the
   request URL because the Worker does not answer yet, remove `settings.event_subscriptions` to create the app and add
   it back once the events endpoint is deployed.
2. Install the app to the workspace. Copy the signing secret (Basic Information) and the bot token (OAuth &
   Permissions).
3. Create a Cloudflare account API token with Workers Scripts: Edit and Workers KV Storage: Edit. Add Account
   Settings: Read only if the deploy reports it missing. The account needs a `workers.dev` subdomain.
4. Add the 8 GitHub Actions secrets in this repo (Settings > Secrets and variables > Actions):

   | Secret                  | Value                                                                       |
   | ----------------------- | --------------------------------------------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | The token from step 3                                                       |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard                                                        |
   | `SLACK_SIGNING_SECRET`  | From step 2                                                                 |
   | `SLACK_BOT_TOKEN`       | From step 2, starts with `xoxb-`                                            |
   | `CHANNEL_MAP`           | JSON, Slack channel id → workstream, at least one channel mapped to `root`  |
   | `RELAY_URLS`            | JSON, workstream → relay URL (`https://`); `root` and every mapped one      |
   | `RELAY_SECRETS`         | JSON with exactly the keys of `RELAY_URLS`, each the relay's webhook secret |
   | `BRIDGE_TOKEN`          | `openssl rand -hex 32`; the same value goes into the workstreams' file      |

5. Run the Deploy workflow on `main` (Actions > Deploy > Run workflow). It deploys the Worker, uploads the six Worker
   secrets and checks that `/health` answers 200.

To change a secret, edit it in GitHub and run the Deploy workflow again; it re-uploads every Worker secret.

## Development

```sh
bun install
bun run format:check && bun run lint && bun run typecheck && bun test && bun run build
```

`bun run build` is `wrangler deploy --dry-run --outdir dist`: it bundles the Worker without deploying. Deploys run
only from the Deploy workflow on `main`.
