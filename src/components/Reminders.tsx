import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { enableNotifications, notificationsEnabled } from '../lib/push'
import { DAY_LABELS } from '../lib/dates'
import type { DailyTask, Reminder } from '../lib/types'

// Today → Reminders (collapsed at the bottom of the page): the push opt-in for this device and
// every reminder — on/off, weekdays, delete, add (optionally only when a task isn't done yet).
// Moved here from the Settings page when that page was removed; a task's own reminder is still set
// in its edit sheet. A new reminder starts at the current time, every day.
export function Reminders() {
  const [open, setOpen] = useState(false)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [label, setLabel] = useState('')
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const [taskId, setTaskId] = useState('')
  const [pushOn, setPushOn] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function load() {
    const [{ data: reminderRows }, { data: taskRows }] = await Promise.all([
      supabase.from('reminders').select('*').order('time_of_day'),
      supabase.from('daily_tasks').select('*').eq('active', true).order('title'),
    ])
    setReminders(reminderRows ?? [])
    setTasks(taskRows ?? [])
    setPushOn(await notificationsEnabled())
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('reminders').insert({ label: label.trim(), time_of_day: time, days_of_week: [0, 1, 2, 3, 4, 5, 6], user_id: user.id, task_id: taskId || null })
    setLabel('')
    setTaskId('')
    load()
  }

  async function toggle(reminder: Reminder) {
    setReminders((rs) => rs.map((r) => (r.id === reminder.id ? { ...r, enabled: !r.enabled } : r)))
    await supabase.from('reminders').update({ enabled: !reminder.enabled }).eq('id', reminder.id)
  }

  async function toggleDay(reminder: Reminder, day: number) {
    const days = reminder.days_of_week.includes(day) ? reminder.days_of_week.filter((d) => d !== day) : [...reminder.days_of_week, day].sort()
    setReminders((rs) => rs.map((r) => (r.id === reminder.id ? { ...r, days_of_week: days } : r)))
    await supabase.from('reminders').update({ days_of_week: days }).eq('id', reminder.id)
  }

  async function remove(reminder: Reminder) {
    setReminders((rs) => rs.filter((r) => r.id !== reminder.id))
    await supabase.from('reminders').delete().eq('id', reminder.id)
  }

  async function enablePush() {
    setStatus('Requesting permission…')
    const result = await enableNotifications()
    if (result.ok) {
      setPushOn(true)
      setStatus('Notifications enabled.')
    } else setStatus(result.reason ?? 'Failed to enable notifications.')
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-3.5">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between text-left" aria-expanded={open}>
        <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">🔔 REMINDERS</span>
        <span className="text-[10px] text-ink-faint">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-ink-3">{pushOn ? 'Notifications are on for this device.' : 'Turn on notifications to get these on your lock screen.'}</span>
            <button onClick={enablePush} className={`shrink-0 ${pushOn ? 'text-xs font-medium text-pine' : 'rounded-[16px] bg-pine px-3 py-1.5 text-xs font-semibold text-white'}`}>
              {pushOn ? 'Resync' : 'Turn on'}
            </button>
          </div>
          {status && <p className="-mt-1 text-xs text-ink-disabled">{status}</p>}
          {reminders.map((r) => {
            const linked = r.task_id ? tasks.find((t) => t.id === r.task_id) : undefined
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-page p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{r.label}</p>
                    <p className="text-xs text-ink-disabled">
                      {r.time_of_day.slice(0, 5)}
                      {linked && ` — only if "${linked.title}" isn't done`}
                      {r.task_id && !linked && ' — linked task no longer active'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => toggle(r)} aria-label={r.enabled ? 'Turn off' : 'Turn on'} className={`h-6 w-11 rounded-full transition ${r.enabled ? 'bg-pine' : 'bg-line'}`}>
                      <span className={`block h-5 w-5 translate-y-0.5 rounded-full bg-surface transition ${r.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <button onClick={() => remove(r)} aria-label="Delete reminder" className="text-ink-faint">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      onClick={() => toggleDay(r, i)}
                      className={`flex-1 rounded-xl py-1 text-xs font-medium ${r.days_of_week.includes(i) ? 'bg-cat-emerald-tint text-pine' : 'bg-track text-ink-disabled'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <form onSubmit={add} className="flex flex-col gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="New reminder, e.g. Log your weight"
              className="rounded-2xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
            />
            <div className="flex gap-2">
              <input value={time} onChange={(e) => setTime(e.target.value)} type="time" aria-label="Time" className="min-w-0 flex-1 rounded-2xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none focus:border-pine" />
              <button type="submit" disabled={!label.trim()} className="shrink-0 rounded-2xl bg-pine px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                Add
              </button>
            </div>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="rounded-2xl border border-line bg-page px-3 py-2.5 text-sm text-ink outline-none focus:border-pine">
              <option value="">Always remind (not tied to a task)</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  Only if "{t.title}" isn't done
                </option>
              ))}
            </select>
          </form>
        </>
      )}
    </div>
  )
}
