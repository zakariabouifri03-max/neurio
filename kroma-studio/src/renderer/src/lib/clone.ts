/** structuredClone with a JSON fallback for exotic environments. */
export function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}
