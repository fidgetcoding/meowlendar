/**
 * Shallow-copies `source` without the listed keys. Same result as dropping the
 * fields with a rest destructure, without naming a variable for each one.
 */
export function omit<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[]
): Omit<T, K> {
  const copy: Partial<T> = { ...source }
  for (const key of keys) {
    delete copy[key]
  }
  return copy as Omit<T, K>
}
