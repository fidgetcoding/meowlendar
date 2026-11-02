// Browser tests never make a sound: no audio output, no notification sounds, no speech.

export const SILENT_LAUNCH = {
  headless: true,
  args: ['--mute-audio', '--disable-speech-api', '--disable-notifications'],
}

// Runs before any page script, so nothing on the page can reach a real sound or voice.
export function stubSoundAndSpeech() {
  const target = globalThis as unknown as Record<string, unknown>
  HTMLMediaElement.prototype.play = () => Promise.resolve()
  class SilentAudioContext {
    state = 'closed'
    resume = () => Promise.resolve()
    suspend = () => Promise.resolve()
    close = () => Promise.resolve()
  }
  target.AudioContext = SilentAudioContext
  target.webkitAudioContext = SilentAudioContext
  Object.defineProperty(globalThis, 'speechSynthesis', {
    configurable: true,
    value: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [] },
  })
}
