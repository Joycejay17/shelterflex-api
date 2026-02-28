import type { ZodIssue } from 'zod'

/**
 * Converts Zod issues into a flat `{ field: firstMessage }` record.
 * Only the first error per field is kept — enough for the client to act on.
 *
 * @param issues    - `ZodError.issues` or `SafeParseError.error.issues`
 * @param fallback  - Key used when `issue.path` is empty (e.g. root-level errors)
 */
export function formatZodIssues(
  issues: ZodIssue[],
  fallback = '_',
): Record<string, string> {
  return issues.reduce<Record<string, string>>((acc, issue) => {
    const field = issue.path.join('.') || fallback
    if (!acc[field]) acc[field] = issue.message
    return acc
  }, {})
}
