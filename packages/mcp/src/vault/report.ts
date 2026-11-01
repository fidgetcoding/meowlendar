// Plain text for people. The JSON form of a plan carries the same facts.
import { CONFLICT_RULE, type ApplyResult, type Plan } from './types.js'

function section(title: string, rows: string[]): string[] {
  return rows.length === 0 ? [] : ['', `${title} (${rows.length}):`, ...rows]
}

function show(value: string | null): string {
  return value === null ? 'none' : value
}

export function formatPlan(plan: Plan): string {
  const vaultRows = plan.vaultChanges.flatMap((c) => {
    const where = c.line === null ? `${c.file} (new line)` : `${c.file}:${c.line}`
    const fields = c.fields.length ? ` [${c.fields.join(', ')}]` : ''
    return [
      `  ${c.action} ${where}${fields}`,
      ...(c.before === null ? [] : [`    - ${c.before.trim()}`]),
      `    + ${c.after.trim()}`,
    ]
  })
  const appRows = plan.appChanges.map((c) => {
    const fields = Object.entries(c.fields)
      .filter(([key]) => key !== 'vault_ref' && key !== 'title')
      .map(([key, value]) => `${key}=${value === null ? 'none' : String(value)}`)
      .join(', ')
    return `  ${c.action} "${c.title}" (${c.id})${fields ? `: ${fields}` : ''}`
  })
  const conflictRows = plan.conflicts.map(
    (c) => `  ${c.id} ${c.field}: vault keeps ${show(c.vaultValue)}, app loses ${show(c.appValue)} (${c.file})`,
  )
  const removedRows = plan.removedFromVault.map((r) => {
    const why = r.reason === 'line-cancelled' ? 'line was cancelled' : 'line was removed'
    return `  "${r.title}" (${r.id}): ${why}. The task stays in the app and loses its link.`
  })
  const deletedRows = plan.deletedInApp.map(
    (d) => `  ${d.file}:${d.line} (${d.id}): task was deleted. The line stays and is marked cancelled.`,
  )
  const skippedRows = plan.skipped.map(
    (s) => `  ${s.file}${s.line === null ? '' : `:${s.line}`}: ${s.reason}`,
  )

  const out = [
    `Plan for "${plan.vault}", folder ${plan.folder === '' ? '(whole vault)' : plan.folder}`,
    `Plan ID: ${plan.planId}`,
    ...section('Vault changes', vaultRows),
    ...section('App changes', appRows),
    ...section('Conflicts, the vault wins', conflictRows),
    ...section('Removed from the vault', removedRows),
    ...section('Deleted in the app', deletedRows),
    ...section('Skipped', skippedRows),
    '',
  ]
  if (plan.empty) {
    out.push('Nothing to do. The vault and the app are in sync.')
  } else {
    if (plan.stateChanges > 0) out.push(`Sync records to refresh: ${plan.stateChanges}`)
    out.push('Nothing has been written. To apply exactly this plan, run:')
    out.push(`  meowlendar-vault apply --name ${plan.vault} --plan ${plan.planId}`)
  }
  out.push('', `Conflict rule: ${CONFLICT_RULE}`)
  return out.join('\n')
}

export function formatApplyResult(result: ApplyResult): string {
  if (result.status === 'nothing-to-do') return 'Nothing to do. The vault and the app are in sync.'
  const out = [
    result.status === 'applied' ? 'Applied.' : 'Applied in part. Run plan again to pick up the rest.',
    `Backup: ${result.backupDir}`,
    `Files written: ${result.filesWritten.length}`,
    `App changes made: ${result.appChangesApplied}`,
  ]
  if (result.appChangesNotRun > 0) out.push(`App changes not made: ${result.appChangesNotRun}`)
  for (const a of result.filesAborted) out.push(`Left alone: ${a.file}. ${a.reason}`)
  if (result.apiError) {
    out.push(`The app refused ${result.apiError.action} on ${result.apiError.id}: ${result.apiError.message}`)
    out.push('I stopped calling the app there. A plan run now will pick up from this point.')
  }
  if (result.stateError) out.push(`Could not save the sync state: ${result.stateError}`)
  for (const c of result.conflicts) {
    out.push(`Conflict on ${c.id} ${c.field}: vault kept ${show(c.vaultValue)}, app lost ${show(c.appValue)}`)
  }
  out.push('', `Conflict rule: ${CONFLICT_RULE}`)
  return out.join('\n')
}
