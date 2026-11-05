import type { Metadata } from 'next'
import { Figtree, Fraunces } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'
import './meow-app.css'
import './meow-board.css'
import './meow-edit.css'

export const metadata: Metadata = {
  title: 'Meowlendar',
  description: 'The purrfect calendar',
}

// The design's two faces: Fraunces for display (dates, headings, numbers), Figtree for UI text.
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
})
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' })

// Stamp the theme before first paint so a stored dark preference never
// flashes light (and vice versa). Must stay in sync with THEME_STORAGE_KEY
// in lib/theme.tsx.
const themeInitScript = `(function(){try{var t=localStorage.getItem('meowlendar-theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#6f7ae0" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}`,
          }}
        />
      </body>
    </html>
  )
}
