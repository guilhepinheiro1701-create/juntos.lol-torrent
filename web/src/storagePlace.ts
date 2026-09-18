/**
 * Which disk this browser asks for.
 *
 * A label, never a path. The worker publishes the places its installation
 * allows and resolves the label on its own side, so the worst a tampered
 * preference can do is name a place that does not exist, which is refused.
 *
 * Kept as a preference rather than asked per film: nobody wants to answer
 * "which disk" every time they press play, and the answer almost never
 * changes. It applies from the next thing opened onward, so a film already
 * playing stays where it was put.
 */

const KEY = 'ss.storage'

/** The label this browser prefers, or '' for whatever the worker uses. */
export function storagePreference(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** Passing '' goes back to the worker's default. */
export function setStoragePreference(label: string): void {
  try {
    if (label) localStorage.setItem(KEY, label)
    else localStorage.removeItem(KEY)
  } catch {}
}
