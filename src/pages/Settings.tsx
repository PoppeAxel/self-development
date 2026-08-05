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
    <div className="flex flex-col gap-4 px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="font-semibold text-gray-900">Push notifications</p>
        <p className="mt-1 text-sm text-gray-500">
          {pushOn ? 'Enabled on this device.' : 'Enable to get reminders sent to your lock screen.'}
        </p>
        {!pushOn && (
          <button onClick={handleEnablePush} className="mt-3 rounded-2xl bg-violet-600 px-4 py-2 font-semibold text-white">
            Enable notifications
          </button>
        )}
        {pushOn && (
          <button onClick={handleEnablePush} className="mt-3 text-sm font-medium text-violet-600">
            Resync this device's subscription
          </button>
        )}
        {status && <p className="mt-2 text-sm text-gray-400">{status}</p>}
      </div>

      <h2 className="text-sm font-semibold text-gray-500">Reminders</h2>
      <ul className="flex flex-col gap-2">
        {reminders.map((reminder) => (
          <li key={reminder.id} className="rounded-3xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{reminder.label}</p>
                <p className="text-sm text-gray-400">{utcTimeToLocal(reminder.time_of_day)}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleReminder(reminder)}
                  className={`h-6 w-11 rounded-full transition ${reminder.enabled ? 'bg-violet-600' : 'bg-gray-200'}`}
                >
                  <span
                    className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition ${
                      reminder.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <button onClick={() => removeReminder(reminder)} className="text-gray-300">
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
                    reminder.days_of_week.includes(i) ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
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
          className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
        />
        <div className="flex gap-2">
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            type="time"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 outline-none focus:border-violet-400"
          />
          <button type="submit" className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white">
            Add reminder
          </button>
        </div>
      </form>

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-4 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 font-medium text-gray-500"
      >
        Sign out
      </button>
    </div>
  )
}
