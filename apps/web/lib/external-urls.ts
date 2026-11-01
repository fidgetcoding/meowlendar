// Base URLs of outside services. The overrides exist so the integration tests can
// aim the app at local fakes. Only the operator's environment can set them.
const trim = (value: string | undefined, fallback: string) =>
  (value?.trim() || fallback).replace(/\/$/, '')

export const googleApiBase = () =>
  trim(process.env.GOOGLE_API_BASE_URL, 'https://www.googleapis.com')

export const googleTokenUrl = () =>
  process.env.GOOGLE_API_BASE_URL?.trim()
    ? `${googleApiBase()}/token`
    : 'https://oauth2.googleapis.com/token'

export const googleRevokeUrl = () =>
  process.env.GOOGLE_API_BASE_URL?.trim()
    ? `${googleApiBase()}/revoke`
    : 'https://oauth2.googleapis.com/revoke'

export const googleAuthUrl = () =>
  process.env.GOOGLE_API_BASE_URL?.trim()
    ? `${googleApiBase()}/o/oauth2/v2/auth`
    : 'https://accounts.google.com/o/oauth2/v2/auth'

export const telegramApiBase = () =>
  trim(process.env.TELEGRAM_API_BASE_URL, 'https://api.telegram.org')
