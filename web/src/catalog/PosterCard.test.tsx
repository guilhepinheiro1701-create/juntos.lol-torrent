import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PosterCard } from './PosterCard'
import type { CatalogMeta } from './tmdb'

const meta: CatalogMeta = {
  id: 'tt1', type: 'movie', name: 'Duna', poster: 'https://img.test/duna.jpg', releaseInfo: '2021',
}

describe('PosterCard', () => {
  // O nome saiu de baixo da capa e foi para dentro dela, aparecendo no hover.
  // Ele continua no DOM e no nome acessivel: quem usa leitor de tela ou
  // teclado nao pode depender de passar o mouse por cima.
  it('is still named, though the caption only shows on hover', () => {
    render(<PosterCard meta={meta} onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Duna' })).toBeInTheDocument()
    expect(screen.getByText('Duna')).toBeInTheDocument()
    expect(screen.getByText('2021')).toBeInTheDocument()
  })

  it('says nothing about a year it does not have', () => {
    render(<PosterCard meta={{ ...meta, releaseInfo: '' }} onOpen={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Duna' })).toBeInTheDocument()
    expect(document.querySelector('.poster-year')).toBeNull()
  })

  // O retangulo da capa e o ponto de partida da animacao de abertura, entao
  // ele so e medido quando o clique veio de um ponteiro: no teclado nao ha de
  // onde partir, e uma medida errada faria o painel saltar da posicao errada.
  it('measures the poster for a pointer click, and not for a keyboard one', () => {
    const onOpen = vi.fn()
    render(<PosterCard meta={meta} onOpen={onOpen} />)
    const card = screen.getByRole('button', { name: 'Duna' })

    fireEvent.click(card, { detail: 1 })
    expect(onOpen.mock.calls[0][0].rect).toBeDefined()

    fireEvent.click(card, { detail: 0 })
    expect(onOpen.mock.calls[1][0].rect).toBeUndefined()
  })

  it('falls back to an icon when there is no poster', () => {
    render(<PosterCard meta={{ ...meta, poster: '' }} onOpen={vi.fn()} />)

    expect(document.querySelector('.poster-art img')).toBeNull()
    expect(document.querySelector('.poster-art svg')).not.toBeNull()
  })
})
