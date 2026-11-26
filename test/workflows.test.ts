import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'bun:test'

type Step = {uses?: string; run?: string; with?: Record<string, unknown>}
type Job = {if?: string; steps?: Step[]; uses?: string}
type Workflow = {
  on: Record<string, unknown>
  concurrency?: {group?: string; 'cancel-in-progress'?: boolean}
  jobs: Record<string, Job>
}

const DIR = '.github/workflows'
const workflows = readdirSync(DIR)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({file, workflow: Bun.YAML.parse(readFileSync(join(DIR, file), 'utf8')) as Workflow}))
const deploy = workflows.find(({file}) => file === 'deploy.yml')?.workflow
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {devDependencies: Record<string, string>}

const strings = (node: unknown): string[] =>
  typeof node === 'string' ? [node] : node && typeof node === 'object' ? Object.values(node).flatMap(strings) : []
const steps = (workflow: Workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
const isWranglerAction = (step: Step) => step.uses?.startsWith('cloudflare/wrangler-action') ?? false
const unwrap = (expression: string) => expression.replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1').trim()

describe('workflows', () => {
  test('only deploy.yml runs wrangler deploy without --dry-run', () => {
    for (const {file, workflow} of workflows) {
      if (file === 'deploy.yml') continue
      const deploys = strings(workflow).filter((s) => /\bwrangler\s+deploy\b/.test(s) && !s.includes('--dry-run'))
      expect({file, deploys}).toEqual({file, deploys: []})
      expect({file, wranglerAction: steps(workflow).some(isWranglerAction)}).toEqual({file, wranglerAction: false})
    }
  })

  test('deploy.yml triggers only on push to main and workflow_dispatch', () => {
    expect(Object.keys(deploy!.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(deploy!.on.push).toEqual({branches: ['main']})
  })

  test('every deploy.yml job runs only on refs/heads/main', () => {
    for (const job of Object.values(deploy!.jobs)) {
      expect(unwrap(job.if ?? '')).toBe("github.ref == 'refs/heads/main'")
    }
  })

  test('deploy.yml has a deploy concurrency group without cancel-in-progress', () => {
    expect(deploy!.concurrency?.group).toBe('deploy')
    expect(deploy!.concurrency?.['cancel-in-progress']).not.toBe(true)
  })

  test('wrangler-action is pinned to a commit SHA with the package.json wrangler version', () => {
    const actions = steps(deploy!).filter(isWranglerAction)
    expect(actions.length).toBeGreaterThan(0)
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/)
    for (const step of actions) {
      expect(step.uses).toMatch(/^cloudflare\/wrangler-action@[0-9a-f]{40}$/)
      expect(String(step.with?.wranglerVersion)).toBe(pkg.devDependencies.wrangler!)
    }
  })

  test('deploy.yml checks the secrets before deploying and /health after', () => {
    const runs = steps(deploy!).map((step) => (isWranglerAction(step) ? 'deploy' : (step.run ?? '')))
    const at = (pattern: RegExp) => runs.findIndex((run) => pattern.test(run))
    expect(at(/check-secrets\.sh/)).toBeGreaterThanOrEqual(0)
    expect(at(/check-secrets\.sh/)).toBeLessThan(at(/^deploy$/))
    expect(at(/check-health\.sh/)).toBeGreaterThan(at(/^deploy$/))
  })
})
