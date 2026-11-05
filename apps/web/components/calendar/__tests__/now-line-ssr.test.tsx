import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarGrid } from '../CalendarGrid'

vi.stubGlobal('React', React)
vi.mock('@/lib/hooks/use-routines', () => ({ useCalendarRoutineInstances: () => ({ data: [] }) }))

// The server's clock (and time zone) never match the browser's, so anything drawn from "now"
// must wait for the browser, or hydration fails on the now line's position. The clock is pinned
// (Date only, so React's own timers still run) to times that used to trip it, midnight included.
describe.each([[0, 0], [0, 30], [10, 30], [23, 30]])('the now line with the clock at %s:%s', (hour, minute) => {
  let props: React.ComponentProps<typeof CalendarGrid>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, hour, minute))
    props = { view: 'day', currentDate: new Date(), events: [], tasks: [], routines: [], calendars: [] }
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('stays out of the server render', () => {
    const html = renderToString(<CalendarGrid {...props} />)
    expect(html).not.toContain('meow-now')
    expect(html).not.toContain('meow-nowcat')
  })

  it('is drawn, with the loaf and its time tag, once mounted in the browser', () => {
    const { container } = render(<CalendarGrid {...props} />)
    expect(container.querySelector('.meow-now')).not.toBeNull()
    expect(container.querySelector('[data-now-loaf]')).not.toBeNull()
    expect(container.querySelector('.meow-nowtag')).not.toBeNull()
  })
})
