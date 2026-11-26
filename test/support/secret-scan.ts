const PATTERNS = {
  'slack-token': /xox[abpr]-[0-9A-Za-z-]{10,}/g,
  'slack-webhook-url': /hooks\.slack\.com/g,
  'relay-webhook-url': /api\.factory\.ai\/api\/webhooks\//g,
  'slack-id': /\b[CUGTW](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g,
} as const
const FAKE_ID = /^[CUGTW]000TEST\w*$/

export type Finding = {pattern: keyof typeof PATTERNS; line: number}

/**
 * Where `text` holds a Slack token, a Slack or relay webhook URL or a Slack id, except the documented fakes.
 * Findings carry no matched text, so a failing scan never reprints the secret it found.
 */
export function findSecrets(text: string): Finding[] {
  return Object.entries(PATTERNS).flatMap(([pattern, regex]) =>
    [...text.matchAll(regex)]
      .filter((match) => !FAKE_ID.test(match[0]))
      .map((match) => ({
        pattern: pattern as Finding['pattern'],
        line: text.slice(0, match.index).split('\n').length,
      })),
  )
}

/** `<file>:<line> <pattern>` per finding, for test failure output. */
export function describeFindings(file: string, text: string): string[] {
  return findSecrets(text).map(({pattern, line}) => `${file}:${line} ${pattern}`)
}
