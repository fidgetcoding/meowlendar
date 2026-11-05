import type { TaskOrigin } from '@poolendar/types'
import type { AuthResult } from './helpers'

/** Where a write came from: 'api' for an API key (an agent or a script), 'app' for a browser session. */
export function originOf(auth: Pick<AuthResult, 'apiKeyId'>): TaskOrigin {
  return auth.apiKeyId ? 'api' : 'app'
}
