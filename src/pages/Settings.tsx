import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { enableNotifications, notificationsEnabled } from '../lib/push'
import { localTimeToUTC, utcTimeToLocal } from '../lib/dates'
import type { Reminder } from '../lib/types'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function Settings() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('20:00')
  const [pushOn, setPushOn] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('reminders').select('*').order('time_of_day')
    setReminders(data ?? [])
    setPushOn(await notificationsEnabled())
  }

  useEffect(() => {
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
      time_of_day: localTimeToUTC(time),
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      user_id: user.id,
    })
    setLabel('')
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
    <div className="flex flex-col gap-4 px-4 pt-4 pb-4">
      <h1 className="text-xl font-semibold text-slate-100">Settings</h1>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="font-medium text-slate-100">Push notifications</p>
        <p className="mt-1 text-sm text-slate-400">
          {pushOn ? 'Enabled on this device.' : 'Enable to get reminders sent to your lock screen.'}
        </p>
        {!pushOn && (
          <button onClick={handleEnablePush} className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 font-medium text-white">
            Enable notifications
          </button>
        )}
        {pushOn && (
          <button onClick={handleEnablePush} className="mt-3 text-sm text-indigo-400">
            Resync this device's subscription
          </button>
        )}
        {status && <p className="mt-2 text-sm text-slate-400">{status}</p>}
      </div>

      <h2 className="text-sm font-medium text-slate-400">Reminders</h2>
      <ul className="flex flex-col gap-2">
        {reminders.map((reminder) => (
          <li key={reminder.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-100">{reminder.label}</p>
                <p className="text-sm text-slate-500">{utcTimeToLocal(reminder.time_of_day)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleReminder(reminder)}
                  className={`h-6 w-11 rounded-full transition ${reminder.enabled ? 'bg-indigo-600' : 'bg-slate-700'}`}
                >
                  <span
                    className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition ${
                      reminder.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <button onClick={() => removeReminder(reminder)} className="text-slate-600">
                  ✕
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-1">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => toggleDay(reminder, i)}
                  className={`flex-1 rounded-lg py-1 text-xs ${
                    reminder.days_of_week.includes(i) ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={addReminder} className="flex flex-col gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Reminder label, e.g. Log your weight"
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            type="time"
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 outline-none focus:border-indigo-500"
          />
          <button type="submit" className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white">
            Add reminder
          </button>
        </div>
      </form>

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-4 rounded-xl border border-slate-800 px-4 py-2.5 text-slate-400"
      >
        Sign out
      </button>
    </div>
  )
}
