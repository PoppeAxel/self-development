import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { enableNotifications, notificationsEnabled } from '../lib/push'
import { connectStrava, stravaConnected, handleStravaOAuthRedirect } from '../lib/strava'
import { DAY_LABELS } from '../lib/dates'
import { Screen } from '../components/Screen'
import type { DailyTask, Reminder } from '../lib/types'

export function Settings() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('20:00')
  const [pushOn, setPushOn] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [goalWeight, setGoalWeight] = useState('')
  const [stepGoal, setStepGoal] = useState('')
  const [bodyGoalsStatus, setBodyGoalsStatus] = useState<string | null>(null)
  const [tasks, setTasks] = useState<DailyTask[]>([])
  const [newReminderTaskId, setNewReminderTaskId] = useState('')
  const [stravaOn, setStravaOn] = useState(false)
  const [stravaStatus, setStravaStatus] = useState<string | null>(null)

  // Labels used to be managed here; they're edited in place now, wherever one is picked
  // (src/components/LabelPicker.tsx).
  async function load() {
    const [{ data: reminderRows }, { data: settingsRow }, { data: taskRows }] = await Promise.all([
      supabase.from('reminders').select('*').order('time_of_day'),
      supabase.from('user_settings').select('*').maybeSingle(),
      supabase.from('daily_tasks').select('*').eq('active', true).order('title'),
    ])
    setReminders(reminderRows ?? [])
    setGoalWeight(settingsRow?.goal_weight != null ? String(settingsRow.goal_weight) : '')
    setStepGoal(settingsRow?.step_goal != null ? String(settingsRow.step_goal) : '')
    setTasks(taskRows ?? [])
    setPushOn(await notificationsEnabled())
    setStravaOn(await stravaConnected())
  }

  useEffect(() => {
    handleStravaOAuthRedirect().then((result) => {
      if (result.handled) {
        setStravaStatus(result.ok ? 'Strava connected.' : (result.reason ?? 'Failed to connect Strava.'))
        if (result.ok) setStravaOn(true)
      }
    })
    load()
  }, [])

  async function addReminder(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('reminders').insert({
      label: label.trim(),
      time_of_day: time,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      user_id: user.id,
      task_id: newReminderTaskId || null,
    })
    setLabel('')
    setNewReminderTaskId('')
    load()
  }

  async function toggleReminder(reminder: Reminder) {
    setReminders((rs) => rs.map((r) => (r.id === reminder.id ? { ...r, enabled: !r.enabled } : r)))
    await supabase.from('reminders').update({ enabled: !reminder.enabled }).eq('id', reminder.id)
  }

  async function toggleDay(reminder: Reminder, day: number) {
    const days = reminder.days_of_week.includes(day)
      ? reminder.days_of_week.filter((d) => d !== day)
      : [...reminder.days_of_week, day].sort()
    setReminders((rs) => rs.map((r) => (r.id === reminder.id ? { ...r, days_of_week: days } : r)))
    await supabase.from('reminders').update({ days_of_week: days }).eq('id', reminder.id)
  }

  async function removeReminder(reminder: Reminder) {
    setReminders((rs) => rs.filter((r) => r.id !== reminder.id))
    await supabase.from('reminders').delete().eq('id', reminder.id)
  }

  async function saveBodyGoals(e: React.FormEvent) {
    e.preventDefault()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_settings').upsert({
      user_id: user.id,
      goal_weight: goalWeight ? Number(goalWeight) : null,
      step_goal: stepGoal ? Number(stepGoal) : null,
    })
    setBodyGoalsStatus('Saved.')
    setTimeout(() => setBodyGoalsStatus(null), 1500)
  }

  async function handleEnablePush() {
    setStatus('Requesting permission…')
    const result = await enableNotifications()
    if (result.ok) {
      setPushOn(true)
      setStatus('Notifications enabled.')
    } else {
      setStatus(result.reason ?? 'Failed to enable notifications.')
    }
  }

  return (
    <Screen title="Settings" onRefresh={load}>

      <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
        <p className="font-semibold text-ink">Push notifications</p>
        <p className="mt-1 text-sm text-ink-3">
          {pushOn ? 'Enabled on this device.' : 'Enable to get reminders sent to your lock screen.'}
        </p>
        {!pushOn && (
          <button onClick={handleEnablePush} className="mt-3 rounded-[20px] bg-pine px-4 py-2 font-semibold text-white">
            Enable notifications
          </button>
        )}
        {pushOn && (
          <button onClick={handleEnablePush} className="mt-3 text-sm font-medium text-pine">
            Resync this device's subscription
          </button>
        )}
        {status && <p className="mt-2 text-sm text-ink-disabled">{status}</p>}
      </div>

      <div className="rounded-3xl border border-line bg-surface p-4 shadow-card">
        <p className="font-semibold text-ink">Strava</p>
        <p className="mt-1 text-sm text-ink-3">
          {stravaOn ? 'Connected — workouts sync automatically every few hours.' : 'Connect to sync your workouts into the Journal.'}
        </p>
        {!stravaOn && (
          <button onClick={connectStrava} className="mt-3 rounded-[20px] bg-cat-amber-ink px-4 py-2 font-semibold text-white">
            Connect Strava
          </button>
        )}
        {stravaStatus && <p className="mt-2 text-sm text-ink-disabled">{stravaStatus}</p>}
      </div>

      <h2 className="text-sm font-semibold text-ink-3">Reminders</h2>
      <ul className="flex flex-col gap-2">
        {reminders.map((reminder) => {
          const linkedTask = reminder.task_id ? tasks.find((t) => t.id === reminder.task_id) : undefined
          return (
          <li key={reminder.id} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{reminder.label}</p>
                <p className="text-sm text-ink-disabled">
                  {reminder.time_of_day.slice(0, 5)}
                  {linkedTask && ` — only if "${linkedTask.title}" isn't done`}
                  {reminder.task_id && !linkedTask && ' — linked task no longer active'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleReminder(reminder)}
                  className={`h-6 w-11 rounded-full transition ${reminder.enabled ? 'bg-pine' : 'bg-line'}`}
                >
                  <span
                    className={`block h-5 w-5 translate-y-0.5 rounded-full bg-surface transition ${
                      reminder.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <button onClick={() => removeReminder(reminder)} className="text-ink-faint">
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-1">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDay(reminder, i)}
                  className={`flex-1 rounded-xl py-1 text-xs font-medium ${
                    reminder.days_of_week.includes(i) ? 'bg-cat-emerald-tint text-pine' : 'bg-track text-ink-disabled'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </li>
          )
        })}
      </ul>

      <form onSubmit={addReminder} className="flex flex-col gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Reminder label, e.g. Log your weight"
          className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
        />
        <div className="flex gap-2">
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            type="time"
            className="flex-1 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-pine"
          />
          <button type="submit" className="rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
            Add reminder
          </button>
        </div>
        <select
          value={newReminderTaskId}
          onChange={(e) => setNewReminderTaskId(e.target.value)}
          className="rounded-[20px] border border-line-strong bg-surface px-3 py-2.5 text-ink outline-none focus:border-pine"
        >
          <option value="">Always remind (not tied to a task)</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              Only if "{t.title}" isn't done
            </option>
          ))}
        </select>
      </form>

      <h2 className="text-sm font-semibold text-ink-3">Body goals</h2>
      <form onSubmit={saveBodyGoals} className="rounded-3xl border border-line bg-surface p-4 shadow-card">
        <p className="mb-2 text-sm text-ink-3">Shown as reference lines on your trends in Stats.</p>
        <div className="flex flex-col gap-2">
          <input
            value={goalWeight}
            onChange={(e) => setGoalWeight(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Goal weight (kg)"
            className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <input
            value={stepGoal}
            onChange={(e) => setStepGoal(e.target.value)}
            type="number"
            step="1"
            placeholder="Daily step goal, e.g. 10000"
            className="rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 text-ink placeholder-ink-disabled outline-none focus:border-pine"
          />
          <button type="submit" className="rounded-[20px] bg-pine px-4 py-2.5 font-semibold text-white">
            Save
          </button>
        </div>
        {bodyGoalsStatus && <p className="mt-2 text-sm text-cat-emerald-ink">{bodyGoalsStatus}</p>}
      </form>

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-4 rounded-[20px] border border-line-strong bg-surface px-4 py-2.5 font-medium text-ink-3"
      >
        Sign out
      </button>
    </Screen>
  )
}
