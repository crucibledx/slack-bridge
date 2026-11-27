import {readFileSync} from 'node:fs'
import {expect, test} from 'bun:test'

type Manifest = {
  display_information: {name: string}
  features: Record<string, unknown> & {bot_user: {display_name: string}}
  oauth_config: {scopes: Record<string, string[]>}
  settings: {
    event_subscriptions: {request_url: string; bot_events: string[]; user_events?: string[]}
    interactivity: {is_enabled: boolean}
    socket_mode_enabled: boolean
  }
}

const manifest = Bun.YAML.parse(readFileSync('slack/manifest.yaml', 'utf8')) as Manifest

test('the app and bot are named Crucible (D4)', () => {
  expect(manifest.display_information.name).toBe('Crucible')
  expect(manifest.features.bot_user.display_name).toBe('Crucible')
})

test('exactly the bot scopes in the spec, and no user scopes', () => {
  expect(Object.keys(manifest.oauth_config.scopes)).toEqual(['bot'])
  expect([...manifest.oauth_config.scopes.bot!].sort()).toEqual(
    ['channels:history', 'chat:write', 'groups:history', 'reactions:write', 'users:read'].sort(),
  )
})

test('exactly the bot events in the spec, at the workers.dev request URL', () => {
  const events = manifest.settings.event_subscriptions
  expect([...events.bot_events].sort()).toEqual(['message.channels', 'message.groups'])
  expect(events.user_events).toBeUndefined()
  expect(events.request_url).toBe('https://tundish.<subdomain>.workers.dev/slack/events')
})

test('socket mode, interactivity and slash commands are off', () => {
  expect(manifest.settings.socket_mode_enabled).toBe(false)
  expect(manifest.settings.interactivity.is_enabled).toBe(false)
  expect(manifest.features.slash_commands).toBeUndefined()
})
