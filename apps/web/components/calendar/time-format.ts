import { format } from 'date-fns'

// Times the way the design writes them: "2 PM", "2:30 PM", "10 - 11 AM", "11:30 AM - 12:15 PM".

/** "2 PM" on the hour (when `short`), otherwise "2:30 PM". */
export function formatTime(date: Date, short = true): string {
  return short && date.getMinutes() === 0 ? format(date, 'h a') : format(date, 'h:mm a')
}

/** A start and end that share AM/PM name it once: "10 - 11 AM". */
export function formatRange(start: Date, end: Date, short = true): string {
  const a = formatTime(start, short)
  const b = formatTime(end, short)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} - ${b}` : `${a} - ${b}`
}

/** "in 1h 50m", "in 25m". */
export function formatIn(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return 'in ' + (h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`)
}

/** Minutes since local midnight. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}
