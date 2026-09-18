/**
 * What this browser has asked to keep on disk.
 *
 * The resumable source next door is a hint with a five-hour life: it exists so
 * a preparo that died can be picked up again. This is the opposite — a record
 * meant to outlive everything, because the whole point of downloading a film
 * is that it is still there tomorrow.
 *
 * It holds only what is needed to find the file again and name it on screen.
 * The truth about whether the worker is still holding the bytes lives on the
 * worker, and the page asks; this list says what was asked for.
 */

const KEY = 'ss.library'
const LIMIT = 200

export interface LibraryEntry {
  roomId: string
  jobId: string
  fileName: string
  /** Where the room's catalogue entry came from, when it came from one. */
  title?: string
  poster?: string
  magnet?: string
  filePath?: string
  savedAt: number
}

function read(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is LibraryEntry => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as LibraryEntry).roomId === 'string'
      && typeof (entry as LibraryEntry).jobId === 'string'
      && typeof (entry as LibraryEntry).savedAt === 'number'
    ))
  } catch {
    return []
  }
}

function write(entries: LibraryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)))
  } catch {}
}

/** Newest first, which is the order anyone would expect to browse it in. */
export function library(): LibraryEntry[] {
  return read().sort((a, b) => b.savedAt - a.savedAt)
}

export function libraryEntry(roomId: string): LibraryEntry | null {
  return read().find((entry) => entry.roomId === roomId) ?? null
}

/** Records a download, replacing any earlier record for the same room. */
export function remember(entry: Omit<LibraryEntry, 'savedAt'>): void {
  write([{ ...entry, savedAt: Date.now() }, ...read().filter((held) => held.roomId !== entry.roomId)])
}

export function forget(roomId: string): void {
  write(read().filter((entry) => entry.roomId !== roomId))
}
