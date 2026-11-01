/**
 * Returns `value` when it is a path on this origin, otherwise null. Rejects
 * `//host` and `/\host`, which browsers treat as another host, and control
 * characters, which browsers strip before parsing.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}
