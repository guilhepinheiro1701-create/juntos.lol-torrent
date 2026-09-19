import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Translator } from '../i18n/useT'
import { StoragePicker } from './StoragePicker'
import { storagePlaces } from '../remoteTorrent'

vi.mock('../remoteTorrent', () => ({ storagePlaces: vi.fn() }))

const t = ((key: string) => key) as Translator

const offer = (...labels: string[]) => vi.mocked(storagePlaces)
  .mockResolvedValue(labels.map((label, n) => ({ label, freeBytes: (n + 1) * 1_073_741_824 })))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => vi.restoreAllMocks())

describe('StoragePicker', () => {
  it('shows nothing when the fleet offers no place at all', async () => {
    offer()
    const { container } = render(<StoragePicker t={t} />)

    await waitFor(() => expect(storagePlaces).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  // An ordinary install offers exactly one place. Hiding the picker there left
  // the person with no way to see where their films go, and nowhere to read
  // that a second disk can be added — which read as the feature not existing.
  it('shows the single place an ordinary install offers, and how to add more', async () => {
    offer('SSD')
    render(<StoragePicker t={t} />)

    expect(await screen.findByRole('radio', { name: /SSD/ })).toBeInTheDocument()
    expect(screen.getByText('storage.addMore')).toBeInTheDocument()
  })

  it('does not nag about adding disks once there are two', async () => {
    offer('SSD', 'HDD')
    render(<StoragePicker t={t} />)

    await screen.findByRole('radio', { name: /HDD/ })
    expect(screen.queryByText('storage.addMore')).not.toBeInTheDocument()
  })

  it('offers each place and remembers the one picked', async () => {
    offer('SSD', 'HDD')
    render(<StoragePicker t={t} />)

    const hdd = await screen.findByRole('radio', { name: /HDD/ })
    fireEvent.click(hdd)

    expect(localStorage.getItem('ss.storage')).toBe('HDD')
    expect(hdd).toHaveAttribute('aria-checked', 'true')
  })

  it('starts on the worker default, and goes back to it', async () => {
    offer('SSD', 'HDD')
    render(<StoragePicker t={t} />)

    const automatic = await screen.findByRole('radio', { name: 'storage.automatic' })
    expect(automatic).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('radio', { name: /SSD/ }))
    expect(localStorage.getItem('ss.storage')).toBe('SSD')

    fireEvent.click(automatic)
    // Removed rather than stored as an empty string: absent is the default.
    expect(localStorage.getItem('ss.storage')).toBeNull()
  })

  it('reads back a place chosen earlier', async () => {
    localStorage.setItem('ss.storage', 'hdd')
    offer('SSD', 'HDD')
    render(<StoragePicker t={t} />)

    // Written in one case, offered in another: the same disk either way.
    await waitFor(() => expect(screen.getByRole('radio', { name: /HDD/ })).toHaveAttribute('aria-checked', 'true'))
  })

  // A preference the fleet no longer offers is refused at the next play, so
  // the place to find out is here, not there.
  it('warns when the chosen place is not on offer any more', async () => {
    localStorage.setItem('ss.storage', 'NAS')
    offer('SSD', 'HDD')
    render(<StoragePicker t={t} />)

    expect(await screen.findByText('storage.stale')).toBeInTheDocument()
  })

  it('shows itself for a stale choice even when only one place is offered', async () => {
    localStorage.setItem('ss.storage', 'NAS')
    offer('SSD')
    render(<StoragePicker t={t} />)

    expect(await screen.findByText('storage.stale')).toBeInTheDocument()
  })

  it('stays out of the way when the fleet cannot be reached', async () => {
    vi.mocked(storagePlaces).mockRejectedValue(new Error('offline'))
    const { container } = render(<StoragePicker t={t} />)

    await waitFor(() => expect(storagePlaces).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
