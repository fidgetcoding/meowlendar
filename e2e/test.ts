import { test as base } from '@playwright/test'
import { stubSoundAndSpeech } from './silent-browser'

export { expect } from '@playwright/test'
export type { Page, Locator } from '@playwright/test'

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(stubSoundAndSpeech)
    await use(context)
  },
})
