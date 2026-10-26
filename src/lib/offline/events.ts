// Tiny change-notification channel so every component (and every open tab) refreshes when local data changes.
const EVENT = 'vyra-offline-changed'
const CHANNEL = 'vyra-offline'

export function notifyChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
  if (typeof BroadcastChannel !== 'undefined') {
    const c = new BroadcastChannel(CHANNEL)
    c.postMessage('changed')
    c.close()
  }
}

export function subscribe(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(EVENT, cb)
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  if (channel) channel.onmessage = cb
  return () => {
    window.removeEventListener(EVENT, cb)
    channel?.close()
  }
}
