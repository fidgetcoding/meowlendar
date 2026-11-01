'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Profile, UserSettings } from '@poolendar/types'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Query-key factory
// ---------------------------------------------------------------------------

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

type UpdateProfileInput = {
  display_name?: string | null
  company?: string | null
  avatar_url?: string | null
  settings?: Partial<UserSettings>
}

// ---------------------------------------------------------------------------
// useProfile — current user's profile
// ---------------------------------------------------------------------------

export function useProfile() {
  const supabase = createClient()

  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: async (): Promise<Profile> => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError) throw authError
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (error) throw error
      return data as Profile
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateProfile — merge settings, don't replace
// ---------------------------------------------------------------------------

export function useUpdateProfile() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateProfileInput): Promise<Profile> => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError) throw authError
      if (!user) throw new Error('Not authenticated')

      // If settings are provided, merge with existing settings
      const updatePayload: Record<string, unknown> = {}

      if (input.display_name !== undefined) {
        updatePayload.display_name = input.display_name
      }
      if (input.company !== undefined) {
        updatePayload.company = input.company
      }
      if (input.avatar_url !== undefined) {
        updatePayload.avatar_url = input.avatar_url
      }

      if (input.settings) {
        // Fetch current profile to merge settings
        const { data: current, error: fetchError } = await supabase
          .from('profiles')
          .select('settings')
          .eq('id', user.id)
          .single()

        if (fetchError) throw fetchError

        const currentSettings = (current as { settings: UserSettings }).settings
        updatePayload.settings = { ...currentSettings, ...input.settings }
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id)
        .select('*')
        .single()

      if (error) throw error
      return data as Profile
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.me() })

      const previous = queryClient.getQueryData<Profile>(profileKeys.me())

      if (previous) {
        const optimistic: Profile = {
          ...previous,
          ...(input.display_name !== undefined && {
            display_name: input.display_name,
          }),
          ...(input.company !== undefined && { company: input.company }),
          ...(input.avatar_url !== undefined && {
            avatar_url: input.avatar_url,
          }),
          ...(input.settings && {
            settings: { ...previous.settings, ...input.settings },
          }),
          updated_at: new Date().toISOString(),
        }

        queryClient.setQueryData<Profile>(profileKeys.me(), optimistic)
      }

      return { previous }
    },

    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<Profile>(profileKeys.me(), context.previous)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.me() })
    },
  })
}
