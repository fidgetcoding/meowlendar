'use client'

import { GOOGLE_CALENDAR_SCOPES } from '@/lib/google/scopes'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Moon, Sun } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useTheme } from '@/lib/theme'

// Floating paw prints drifting up the screen (deterministic layout).
const PAW_FLOATERS = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  size: 16 + ((i * 7 + 3) % 20),
  left: ((i * 17 + 5) % 86) + 7,
  delay: (i * 1.7) % 12,
  duration: 14 + ((i * 3 + 2) % 10),
}))

// The cat parade. One emoji, many breeds: CSS filters turn the tabby into
// grey, white, and cream cats. Negative delays start everyone mid-stroll.
// `reverse` walks right-to-left; 🐈 faces left natively, so left-to-right
// walkers get flipped.
const CAT_WALKERS = [
  { id: 'tabby', emoji: '🐈', size: 42, bottom: '2%', duration: 26, delay: -2, reverse: false, filter: undefined },
  { id: 'black', emoji: '🐈‍⬛', size: 36, bottom: '7%', duration: 34, delay: -12, reverse: true, filter: undefined },
  { id: 'grey', emoji: '🐈', size: 28, bottom: '11%', duration: 22, delay: -5, reverse: false, filter: 'grayscale(1) brightness(1.15)' },
  { id: 'white', emoji: '🐈', size: 50, bottom: '0%', duration: 42, delay: -20, reverse: true, filter: 'grayscale(1) brightness(1.7)' },
  { id: 'cream', emoji: '🐈', size: 24, bottom: '15%', duration: 18, delay: -9, reverse: false, filter: 'sepia(0.9) saturate(0.5)' },
]

function CatParade() {
  return (
    <div
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
      aria-hidden="true"
    >
      {PAW_FLOATERS.map((f) => (
        <div
          key={f.id}
          className="absolute animate-float"
          style={{
            fontSize: f.size,
            left: `${f.left}%`,
            bottom: '-8%',
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
          }}
        >
          🐾
        </div>
      ))}

      {CAT_WALKERS.map((cat) => (
        <div
          key={cat.id}
          className="cat-walker"
          style={{
            bottom: cat.bottom,
            fontSize: cat.size,
            animationDuration: `${cat.duration}s`,
            animationDelay: `${cat.delay}s`,
            animationDirection: cat.reverse ? 'reverse' : 'normal',
          }}
        >
          <span
            className="inline-block"
            style={{
              transform: cat.reverse ? undefined : 'scaleX(-1)',
              filter: cat.filter,
            }}
          >
            <span className="cat-gait">{cat.emoji}</span>
          </span>
        </div>
      ))}

      {/* Yarn chase: ball rolls ahead, kitten pounces after it. */}
      <div
        className="cat-walker"
        style={{
          bottom: '4%',
          animationDuration: '15s',
          animationDelay: '-4s',
        }}
      >
        <span className="flex items-end gap-4">
          <span className="inline-block" style={{ transform: 'scaleX(-1)' }}>
            <span className="cat-pounce text-[32px]">🐈</span>
          </span>
          <span className="yarn-roll mb-1 text-[22px]">🧶</span>
        </span>
      </div>

      {/* Grooming cat in the corner, licking its fresh catch. */}
      <div className="absolute bottom-8 right-10 hidden sm:block">
        <div className="relative">
          <span className="cat-head-bob text-[42px]">🐱</span>
          <span className="cat-tongue" style={{ left: 16, top: 36 }} />
          <span
            className="absolute text-[20px]"
            style={{ left: -4, top: 44, transform: 'rotate(-18deg)' }}
          >
            🐟
          </span>
        </div>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="absolute right-4 top-4 z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors duration-150 hover:bg-[var(--surface-hover)]"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-translucent)',
        color: 'var(--muted)',
      }}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleLogin() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/callback`,
        scopes: GOOGLE_CALENDAR_SCOPES,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
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

    router.push('/')
    router.refresh()
  }

  return (
    <div className="login-scene relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <CatParade />
      <ThemeToggle />

      <div
        className="pointer-events-none absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(249,168,37,0.10) 0%, rgba(139,105,20,0.05) 40%, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-sm animate-fade-in-up">
        <div className="mb-10 text-center">
          <div className="cat-logo relative mx-auto mb-5 inline-block overflow-hidden rounded-full">
            <div
              className="animate-pulse-glow absolute inset-0 rounded-full"
              aria-hidden="true"
            />
            <span className="relative inline-block text-[64px] leading-none sm:text-[80px] drop-shadow-[0_4px_24px_rgba(249,168,37,0.25)]">
              🐱
            </span>
          </div>
          <h1
            className="text-4xl font-extrabold tracking-tight"
            style={{ color: 'var(--fg)' }}
          >
            Meow<span style={{ color: 'var(--accent)' }}>lendar</span>
          </h1>
          <p
            className="mt-2 text-sm tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            The purrrfect calendar
          </p>
        </div>

        <div
          className="rounded-2xl p-6"
          style={{
            background: 'var(--surface-translucent)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(249, 168, 37, 0.25)',
            boxShadow:
              '0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 1px 0 rgba(255,255,255,0.05) inset',
          }}
        >
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="group relative flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl px-6 py-3.5 text-base font-semibold transition-all duration-200 hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            style={{
              background: 'linear-gradient(180deg, #f9a825 0%, #ef8a1a 100%)',
              color: '#1a0e08',
              boxShadow:
                '0 2px 12px rgba(249,168,37,0.3), 0 1px 0 rgba(255,255,255,0.2) inset',
            }}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
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
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3">
            <div
              className="h-px flex-1"
              style={{ background: 'rgba(249,168,37,0.25)' }}
            />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              or
            </span>
            <div
              className="h-px flex-1"
              style={{ background: 'rgba(249,168,37,0.25)' }}
            />
          </div>

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
              className="w-full"
              disabled={loading}
            >
              {loading
                ? 'Loading...'
                : mode === 'login'
                  ? 'Sign in with email'
                  : 'Create account'}
            </Button>
          </form>

          <p
            className="mt-4 text-center text-sm"
            style={{ color: 'var(--muted)' }}
          >
            {mode === 'login' ? (
              <>
                No account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup')
                    setError(null)
                  }}
                  className="cursor-pointer hover:underline"
                  style={{ color: 'var(--accent)' }}
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
                  className="cursor-pointer hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <div
          className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs"
          style={{ color: 'var(--muted)' }}
        >
          <span>🗓️ Calendar</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>📋 Tasks</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>📱 Push alerts</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>🧶 Nine lives</span>
        </div>
      </div>
    </div>
  )
}
