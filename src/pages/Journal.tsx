import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import type { JournalEntry, JournalEntryType } from '../lib/types'

const MOODS = ['😞', '😕', '😐', '🙂', '😄']

export function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<JournalEntryType>('weight')
  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')

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
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-xl font-semibold text-slate-100">Journal</h1>

      <div className="flex gap-2">
        {(['weight', 'mood', 'note'] as JournalEntryType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium capitalize ${
              tab === t ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {t}
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
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => {
              if (!weight) return
              addEntry('weight', Number(weight), null)
              setWeight('')
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white"
          >
            Log
          </button>
        </div>
      )}

      {tab === 'mood' && (
        <div className="flex justify-between">
          {MOODS.map((emoji, i) => (
            <button
              key={emoji}
              onClick={() => addEntry('mood', i + 1, emoji)}
              className="rounded-xl bg-slate-800 px-3 py-2 text-2xl"
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
            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => {
              if (!note.trim()) return
              addEntry('note', null, note.trim())
              setNote('')
            }}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 font-medium text-white"
          >
            Save
          </button>
        </div>
      )}

      {weightSeries.length > 1 && (
        <div className="h-48 rounded-xl border border-slate-800 bg-slate-900 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weightSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} domain={['dataMin - 1', 'dataMax + 1']} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 12 }} />
              <Line type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-2 pb-4">
          {recent.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm"
            >
              <span className="text-slate-400">{entry.date}</span>
              <span className="flex-1 px-3 text-slate-100">
                {entry.type === 'weight' && `${entry.value_numeric} kg`}
                {entry.type === 'mood' && entry.value_text}
                {entry.type === 'note' && entry.value_text}
              </span>
              <button onClick={() => remove(entry)} className="text-slate-600">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
