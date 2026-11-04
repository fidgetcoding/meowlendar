import { expect, it } from 'vitest'
import { createUser, serviceClient } from './helpers'

it('rolls back task fields and existing tags if a replacement tag violates ownership', async () => {
  const owner = await createUser('atomic-owner')
  const other = await createUser('atomic-other')
  const db = serviceClient()
  try {
    const { data: tag } = await owner.client.from('tags').insert({ user_id: owner.id, name: 'Keep', color: '#123456' }).select().single().throwOnError()
    const { data: foreign } = await other.client.from('tags').insert({ user_id: other.id, name: 'Other', color: '#654321' }).select().single().throwOnError()
    const { data: task, error: creation } = await owner.client.rpc('create_task_with_children', { p_task: { title: 'Original' }, p_tag_ids: [tag!.id] })
    expect(creation).toBeNull()
    const changed = await owner.client.rpc('update_task_with_tags', { p_id: task.id, p_patch: { title: 'Must roll back' }, p_tag_ids: [foreign!.id] })
    expect(changed.error?.code).toBe('42501')
    const { data: stored } = await owner.client.from('tasks').select('title, task_tags(tag_id)').eq('id', task.id).single()
    expect(stored).toEqual({ title: 'Original', task_tags: [{ tag_id: tag!.id }] })
    const valid = await owner.client.rpc('update_task_with_tags', { p_id: task.id, p_patch: { title: 'Committed' }, p_tag_ids: [] })
    expect(valid.error).toBeNull()
    expect(valid.data).toMatchObject({ title: 'Committed', tags: [] })
  } finally { await db.auth.admin.deleteUser(owner.id); await db.auth.admin.deleteUser(other.id) }
})

it('preserves browser create fields while keeping tag writes atomic', async () => {
  const owner = await createUser('create-fields')
  const db = serviceClient()
  try {
    const { data: parent } = await owner.client.from('tasks').insert({ user_id: owner.id, title: 'Parent' }).select().single().throwOnError()
    const result = await owner.client.rpc('create_task_with_children', { p_task: { title: 'Child', parent_id: parent!.id, position: 12.5, is_split: true } })
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ parent_id: parent!.id, position: 12.5, is_split: true })
  } finally { await db.auth.admin.deleteUser(owner.id) }
})
