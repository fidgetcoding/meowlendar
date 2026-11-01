import { PoolendarClient } from '@poolendar/api-client'
import { resolveApiConfig } from './env.js'
import { createTasksApi, runCli, VaultError } from './vault/index.js'

const code = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  createApi: () => {
    const { apiUrl, apiKey } = resolveApiConfig()
    if (!apiKey) {
      throw new VaultError(
        'MEOWLENDAR_API_KEY is required. Create a key in the app under Settings > API Keys, then: export MEOWLENDAR_API_KEY=pk_...',
      )
    }
    return createTasksApi(new PoolendarClient({ baseUrl: apiUrl, apiKey }))
  },
})
process.exitCode = code
