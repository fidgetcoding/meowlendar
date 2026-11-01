// MEOWLENDAR_* are the documented names. The POOLENDAR_* names still work for
// configs written before the rename.
export interface ApiConfig {
  apiUrl: string
  apiKey: string | undefined
}

export function resolveApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    apiUrl: env.MEOWLENDAR_API_URL ?? env.POOLENDAR_API_URL ?? env.POOLENDAR_URL ?? 'http://localhost:3000',
    apiKey: env.MEOWLENDAR_API_KEY ?? env.POOLENDAR_API_KEY,
  }
}
