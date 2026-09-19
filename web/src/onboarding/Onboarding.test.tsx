import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Onboarding } from './Onboarding'
import { hasSeenOnboarding } from './seen'

vi.mock('./sounds', () => ({
  playAdvance: vi.fn(),
  playBack: vi.fn(),
  playFinish: vi.fn(),
}))

const { playAdvance, playFinish } = await import('./sounds')

const next = () => screen.getByRole('button', { name: /avançar|next/i })

describe('hasSeenOnboarding', () => {
  beforeEach(() => localStorage.clear())

  it('is false before it has ever run', () => {
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('is true once the last step was reached', async () => {
    render(<Onboarding />)
    await userEvent.click(next())
    await userEvent.click(next())
    await userEvent.click(screen.getByRole('button', { name: /começar|start/i }))
    expect(hasSeenOnboarding()).toBe(true)
  })

  it('is true when skipped, because skipping is an answer', async () => {
    render(<Onboarding />)
    await userEvent.click(screen.getByRole('button', { name: /pular|skip/i }))
    expect(hasSeenOnboarding()).toBe(true)
  })
})

describe('Onboarding', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('opens on what the app is, before either tab is explained', async () => {
    render(<Onboarding />)
    expect(await screen.findByRole('heading', { name: /na sua máquina|your machine/i })).toBeInTheDocument()
  })

  // It used to promise synchronised playback with friends over a shared link.
  // That is gone from the app, so it has to be gone from the first screen a
  // person ever reads.
  it('promises nothing about watching together', async () => {
    render(<Onboarding />)
    await screen.findByRole('heading', { name: /na sua máquina|your machine/i })
    expect(screen.queryByText(/amigos|friends|ao mesmo tempo|at the same time/i)).not.toBeInTheDocument()
  })

  it('explains the open tab, and says nothing needs installing', async () => {
    render(<Onboarding />)
    await userEvent.click(next())
    expect(await screen.findByRole('heading', { name: /abrir|open/i })).toBeInTheDocument()
    expect(screen.getByText(/sem instalar mais nada|nothing else to install/i)).toBeInTheDocument()
  })

  it('explains that the catalogue finds nothing without a plugin', async () => {
    render(<Onboarding />)
    await userEvent.click(next())
    await userEvent.click(next())
    expect(await screen.findByRole('heading', { name: /catálogo|catalogue/i })).toBeInTheDocument()
    expect(screen.getByText(/lista tudo e não abre nada|lists everything and opens nothing/i)).toBeInTheDocument()
  })

  it('goes back to the step before', async () => {
    render(<Onboarding />)
    await userEvent.click(next())
    await userEvent.click(screen.getByRole('button', { name: /voltar|back/i }))
    expect(await screen.findByRole('heading', { name: /na sua máquina|your machine/i })).toBeInTheDocument()
  })

  it('makes a sound on the click, never on its own', async () => {
    render(<Onboarding />)
    expect(playAdvance).not.toHaveBeenCalled()
    await userEvent.click(next())
    expect(playAdvance).toHaveBeenCalledOnce()
  })

  it('sounds the end differently from a step', async () => {
    render(<Onboarding />)
    await userEvent.click(next())
    await userEvent.click(next())
    await userEvent.click(screen.getByRole('button', { name: /começar|start/i }))
    expect(playFinish).toHaveBeenCalledOnce()
  })

  it('leaves on Escape, for somebody who already knows the app', async () => {
    const onDone = vi.fn()
    render(<Onboarding onDone={onDone} />)
    await userEvent.keyboard('{Escape}')
    expect(onDone).toHaveBeenCalledOnce()
    expect(hasSeenOnboarding()).toBe(true)
  })
})
