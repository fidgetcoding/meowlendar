// @vitest-environment jsdom
import * as React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ApiKeyManager } from '../ApiKeyManager'

vi.stubGlobal('React', React)

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const existing = {
  id: 'key-1',
  user_id: 'user-1',
  name: 'Old key',
  key_prefix: 'pk_aaaaa',
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

describe('ApiKeyManager', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })
  afterEach(cleanup)

  it('creates a key through POST /api/api-keys and shows the raw key once', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'key-2', name: 'Claude', key_prefix: 'pk_bbbbb', key: 'pk_secretvalue' }),
        { status: 201 }
      )
    )
    const onKeysChange = vi.fn()
    render(<ApiKeyManager apiKeys={[]} onKeysChange={onKeysChange} />)

    fireEvent.change(screen.getByPlaceholderText(/Claude Code/), { target: { value: 'Claude' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))

    await screen.findByText('pk_secretvalue')
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/api-keys')
    expect(onKeysChange).toHaveBeenCalledWith([{ id: 'key-2', name: 'Claude', key_prefix: 'pk_bbbbb' }])
  })

  it('deletes a key through DELETE /api/api-keys/:id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const onKeysChange = vi.fn()
    render(<ApiKeyManager apiKeys={[existing]} onKeysChange={onKeysChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Old key' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onKeysChange).toHaveBeenCalledWith([]))
    expect(vi.mocked(globalThis.fetch).mock.calls[0]![0]).toBe('/api/api-keys/key-1')
  })
})
