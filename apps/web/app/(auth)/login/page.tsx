'use client'

import { GOOGLE_CALENDAR_SCOPES } from '@/lib/google/scopes'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { waitForSession } from '@/lib/auth/session-ready'
import { Moon, Sun } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useTheme } from '@/lib/theme'
import { Wordmark } from '@/components/brand/Wordmark'
import { checkGoogleSignIn, useGoogleSignIn } from '@/lib/auth/google-provider'
import { DEMO_EMAIL, DEMO_PASSWORD, useDemoAvailable } from '@/lib/auth/demo-account'
import { Loaf, PawIcon } from '@/components/brand/cats'

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="meow-theme-btn"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

const FOOTER = ['Calendar', 'Tasks', 'Push alerts', 'Nine lives']

export default function LoginPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const supabase = createClient()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const googleSignIn = useGoogleSignIn()
  const googleOff = googleSignIn === 'disabled'
  // Set when Google is clicked on an install without it: the hint becomes a notice on the card.
  const [googleNotice, setGoogleNotice] = useState(false)
  const demoAvailable = useDemoAvailable()

  function fillDemo() {
    setMode('login')
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setError(null)
  }

  async function handleGoogleLogin() {
    setLoading(true)
    setError(null)
    // A click before the check lands still waits for it: never send anyone to Supabase's raw
    // "provider is not enabled" page. If the check can't tell, sign-in goes ahead as before.
    if ((await checkGoogleSignIn()) === 'disabled') {
      setGoogleNotice(true)
      setLoading(false)
      return
    }
    const result = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/callback`,
        scopes: GOOGLE_CALENDAR_SCOPES,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    const error = result?.error
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/callback`,
        },
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      // Hosted Supabase confirms emails by default, so there is no session yet.
      if (!data.session) {
        setError('Check your email and open the confirmation link to finish signing up.')
        setLoading(false)
        return
      }
    }

    // Go in only once the client holds the session, with nothing cached from before sign-in:
    // a query fired a moment too early gets no rows, and the week stayed empty until a reload.
    await waitForSession(supabase)
    queryClient.clear()
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="meow-login">
      <ThemeToggle />

      <div className="meow-login-col animate-fade-in-up">
        <div className="meow-login-brand">
          <h1>
            <span className="sr-only">Meowlendar</span>
            <Wordmark oColor="var(--cat)" aria-hidden />
          </h1>
          <p className="meow-login-tag">The purrfect calendar</p>
        </div>

        <div className="meow-login-card">
          <div className="meow-login-loaf" aria-hidden="true">
            <Loaf />
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            aria-describedby={googleOff || googleNotice ? 'google-off' : undefined}
            className="meow-google"
          >
            <span className="meow-google-g">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            </span>
            Continue with Google
          </button>

          {(googleOff || googleNotice) && (
            // Google stays clickable: it works once Setup step 7 is done. Clicking it before then
            // shows this as a notice instead of Supabase's raw error page.
            <p id="google-off" role={googleNotice ? 'alert' : undefined} className={googleNotice ? 'meow-google-notice' : 'meow-google-off'}>
              Google sign-in works once you finish{' '}
              <a href="https://meowlendar.com/setup/" target="_blank" rel="noreferrer">
                Setup step 7
              </a>
              .
            </p>
          )}

          <div className="meow-or">or</div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={6}
            />

            {error && (
              <p
                className="text-sm"
                style={{ color: 'var(--destructive)' }}
                role="alert"
              >
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="outline"
              className="w-full h-11 rounded-full font-semibold"
              disabled={loading}
            >
              {loading
                ? 'Loading...'
                : mode === 'login'
                  ? 'Sign in with email'
                  : 'Create account'}
            </Button>
          </form>

          {demoAvailable && (
            <p className="meow-demo-hint">
              Just looking? Sign in with {DEMO_EMAIL} / {DEMO_PASSWORD}.{' '}
              <button type="button" onClick={fillDemo}>Use demo</button>
            </p>
          )}

          <p className="meow-swap">
            {mode === 'login' ? (
              <>
                No account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup')
                    setError(null)
                  }}
                  className="cursor-pointer"
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login')
                    setError(null)
                  }}
                  className="cursor-pointer"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <div className="meow-login-foot">
          {FOOTER.map((label, i) => (
            <span key={label} className="inline-flex items-center gap-2.5">
              {i > 0 && <PawIcon />}
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
