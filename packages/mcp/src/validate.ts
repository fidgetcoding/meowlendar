// Runtime check of tool arguments against each tool's declared inputSchema.
// Arguments can originate from untrusted text the model read (calendar entries,
// booking notes), so the declared schema has to be enforced, not just advertised.

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema
}

const ID_SHAPE = /^[A-Za-z0-9_-]+$/
const FREE_FORM_IDS = new Set(['telegram_chat_id'])

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'integer':
      return Number.isInteger(value)
    case 'null':
      return value === null
    default:
      return typeof value === type
  }
}

function check(value: unknown, schema: Schema, path: string, errors: string[]): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path} must be ${types.join(' or ')}`)
      return
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`)
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => check(item, schema.items!, `${path}[${i}]`, errors))
  }
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    checkObject(value as Record<string, unknown>, schema, path, errors)
  }
}

function checkObject(
  value: Record<string, unknown>,
  schema: Schema,
  path: string,
  errors: string[],
): void {
  for (const name of schema.required ?? []) {
    if (value[name] === undefined) errors.push(`${path}${name} is required`)
  }
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const field = value[name]
    if (field === undefined) continue
    check(field, prop, `${path}${name}`, errors)
    if (
      typeof field === 'string' &&
      (name === 'id' || name.endsWith('_id')) &&
      !FREE_FORM_IDS.has(name) &&
      !ID_SHAPE.test(field)
    ) {
      errors.push(`${path}${name} is not a valid id`)
    }
  }
}

/** Returns a list of problems with `args`, empty when they satisfy `schema`. */
export function validateArgs(
  args: Record<string, unknown>,
  schema: { properties?: Record<string, unknown>; required?: string[] },
): string[] {
  const errors: string[] = []
  checkObject(args, schema as Schema, '', errors)
  return errors
}
