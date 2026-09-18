import { useEffect, useState } from 'react'

/**
 * Whether this machine has the internet.
 *
 * Not whether the site works: in a local install the server is on this same
 * machine and keeps answering either way. What goes when the internet does is
 * the catalogue, which reads a metadata service, and the addons behind it. The
 * films already on disk need neither.
 *
 * navigator.onLine is a floor, not a promise — it says the machine has a
 * network, not that anything is reachable through it. That is the right
 * trade here: false is reliable and is the case worth reacting to, while a
 * false positive lands on the ordinary "the catalogue would not load" path.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => {
    try {
      return navigator.onLine !== false
    } catch {
      return true
    }
  })

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
