import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { RefreshButton } from '../components/RefreshButton'
import type { JournalEntry, JournalEntryType } from '../lib/types'

const MOODS = ['😞', '😕', '😐', '🙂', '😄']

export function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<JournalEntryType>('weight')
  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')
  const [sleepHours, setSleepHours] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('journal_entries').select('*').order('date', { ascending: true }).limit(200)
    setEntries(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addEntry(type: JournalEntryType, valueNumeric: number | null, valueText: string | null) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    // sleep_hours is a once-per-day value (like the auto-synced metrics), not a
    // free-running log like weight/mood/note — update today's entry if it exists.
    if (type === 'sleep_hours') {
      const { data: existing } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('type', 'sleep_hours')
        .eq('date', todayISO())
        .maybeSingle()
      if (existing) {
        await supabase.from('journal_entries').update({ value_numeric: valueNumeric }).eq('id', existing.id)
        load()
        return
      }
    }

    await supabase.from('journal_entries').insert({
      type,
      value_numeric: valueNumeric,
      value_text: valueText,
      date: todayISO(),
      user_id: user.id,
    })
    load()
  }

  async function remove(entry: JournalEntry) {
    setEntries((es) => es.filter((e) => e.id !== entry.id))
    await supabase.from('journal_entries').delete().eq('id', entry.id)
  }

  const weightSeries = entries
    .filter((e) => e.type === 'weight' && e.value_numeric !== null)
    .map((e) => ({ date: e.date.slice(5), value: e.value_numeric as number }))

  const recent = [...entries].reverse().slice(0, 20)

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Journal</h1>
        <RefreshButton onRefresh={load} />
      </div>

      <div className="flex gap-2 rounded-2xl bg-gray-100 p-1">
        {(['weight', 'sleep_hours', 'mood', 'note'] as JournalEntryType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium capitalize transition ${
              tab === t ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {t === 'sleep_hours' ? 'Sleep' : t}
          </button>
        ))}
      </div>

      {tab === 'weight' && (
        <div className="flex gap-2">
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Weight (kg)"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => {
              if (!weight) return
              addEntry('weight', Number(weight), null)
              setWeight('')
            }}
            className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'sleep_hours' && (
        <div className="flex gap-2">
          <input
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            type="number"
            step="0.1"
            placeholder="Hours slept"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => {
              if (!sleepHours) return
              addEntry('sleep_hours', Number(sleepHours), null)
              setSleepHours('')
            }}
            className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'mood' && (
        <div className="flex justify-between rounded-3xl border border-gray-100 bg-white p-3 shadow-sm">
          {MOODS.map((emoji, i) => (
            <button
              key={emoji}
              onClick={() => addEntry('mood', i + 1, emoji)}
              className="rounded-2xl px-3 py-2 text-2xl hover:bg-violet-50"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {tab === 'note' && (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write a note…"
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-gray-900 placeholder-gray-400 outline-none focus:border-violet-400"
          />
          <button
            onClick={() => {
              if (!note.trim()) return
              addEntry('note', null, note.trim())
              setNote('')
            }}
            className="rounded-2xl bg-violet-600 px-4 py-2.5 font-semibold text-white"
          >
            Save
          </button>
        </div>
      )}

      {weightSeries.length > 1 && (
        <div className="h-48 rounded-3xl border border-gray-100 bg-white p-2 shadow-sm">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weightSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f0f7" />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} />
              <YAxis stroke="#9ca3af" fontSize={11} domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip contentStyle={{ background: '#fff', border: '1px solid #f1f0f7', fontSize: 12, borderRadius: 12 }} />
              <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-2 pb-4">
          {recent.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm shadow-sm"
            >
              <span className="text-gray-400">{entry.date}</span>
              <span className="flex-1 px-3 font-medium text-gray-900">
                {entry.type === 'weight' && `${entry.value_numeric} kg`}
                {entry.type === 'sleep_hours' && `${entry.value_numeric} hours slept`}
                {entry.type === 'mood' && entry.value_text}
                {entry.type === 'note' && entry.value_text}
              </span>
              <button onClick={() => remove(entry)} className="text-gray-300">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
