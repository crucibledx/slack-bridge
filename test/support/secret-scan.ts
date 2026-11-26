const PATTERNS = [
  /xox[abpr]-[0-9A-Za-z-]{10,}/g,
  /hooks\.slack\.com/g,
  /api\.factory\.ai\/api\/webhooks\//g,
  /\b[CUGTW](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g,
]
const FAKE_ID = /^[CUGTW]000TEST\w*$/

/** Slack tokens, Slack or relay webhook URLs and Slack ids in `text`, except the documented fakes. */
export function findSecrets(text: string): string[] {
  return PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])).filter(
    (found) => !FAKE_ID.test(found),
  )
}
