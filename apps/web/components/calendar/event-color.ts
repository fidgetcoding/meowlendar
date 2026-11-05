/** Choose the higher-contrast black or white text for a solid hex event color. */
export function getReadableTextColor(color: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!match) return '#ffffff'
  const raw = match[1]!
  const hex = raw.length === 3 ? [...raw].map((char) => char + char).join('') : raw
  const rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
