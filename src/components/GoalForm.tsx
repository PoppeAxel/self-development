import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodStartISO } from '../lib/dates'
import { FINANCE_METRIC_INFO, SESSION_METRIC_INFO, SESSION_METRICS } from '../lib/goals'
import { AUTO_METRICS, METRIC_INFO } from '../lib/metrics'
import { CATEGORY_COLOR_LABELS, CATEGORY_STYLES } from '../lib/categories'
import { formatGoalValue, milestoneState, parseGoalValue } from '../lib/checkins'
import { CATEGORY_COLORS, type Category, type CategoryColor, type GoalKind, type PeriodType } from '../lib/types'

// New goal (design 2c). Long-term goals pick their kind first and only see that kind's
// fields; week/month goals are always 'number' (a target, or none = done-or-not) plus a
// repeat switch. Replaces the old stack of five selects on the Goals screen.

export type GoalTab = 'long' | 'month' | 'week'

const KINDS: { id: GoalKind; title: string; hint: string }[] = [
  { id: 'number', title: 'Reach a number', hint: 'Save 300 000 kr · Run 1 000 km. Measured against the calendar.' },
  { id: 'milestone', title: 'Hit a milestone', hint: 'Bench 100 kg · Marathon under 3:00. Your best so far against the target.' },
  { id: 'done', title: 'Just do it', hint: 'Learn to surf · Visit Japan. Done or not. Check-ins carry the story.' },
]

// Sentinel in the milestone source select for the body-weight log (not a gym exercise name).
const WEIGHT = '__weight'
const ROW = 'flex items-center justify-between gap-3 px-[15px] py-3'
const FIELD = 'min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-faint'

export function GoalForm({ tab, categories, onClose, onCreated }: {
  tab: GoalTab
  categories: Category[]
  onClose: () => void
  onCreated: () => void
}) {
  const long = tab === 'long'
  const [title, setTitle] = useState('')
  const [period, setPeriod] = useState<PeriodType>(long ? 'year' : tab)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [kind, setKind] = useState<GoalKind>('number')
  const [target, setTarget] = useState('')
  const [metric, setMetric] = useState('')
  const [exercise, setExercise] = useState('')
  const [lowerIsBetter, setLowerIsBetter] = useState(false)
  const [start, setStart] = useState('')
  const [repeat, setRepeat] = useState(true)
  const [exercises, setExercises] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [labels, setLabels] = useState(categories)
  const [newLabel, setNewLabel] = useState<string | null>(null)
  const [newColor, setNewColor] = useState<CategoryColor>('amber')

  async function addLabel() {
    const name = newLabel?.trim()
    if (!name) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('categories').insert({ user_id: user.id, name, color: newColor }).select().single()
    if (data) {
      setLabels((ls) => [...ls, data as Category])
      setCategoryId((data as Category).id)
    }
    setNewLabel(null)
  }

  useEffect(() => {
    if (!long) return
    supabase
      .from('exercises')
      .select('name')
      .order('name')
      .then(({ data }) => setExercises((data ?? []).map((e) => e.name as string)))
  }, [long])

  // Picking a source pre-fills the starting point: the latest weigh-in, or a lift's best.
  useEffect(() => {
    if (!exercise) return
    if (exercise === WEIGHT) {
      supabase
        .from('journal_entries')
        .select('value_numeric')
        .eq('type', 'weight')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]?.value_numeric != null) setStart(String(data[0].value_numeric))
        })
      return
    }
    supabase
      .from('gym_session_sets')
      .select('weight, gym_sessions!inner(date)')
      .ilike('exercise_name', exercise)
      .not('weight', 'is', null)
      .then(({ data }) => {
        const results = (data ?? []).map((r) => ({ date: (r.gym_sessions as unknown as { date: string }).date, value: Number(r.weight) }))
        const best = milestoneState({ lower_is_better: false, start_value: null, target_value: null }, results, '9999').best
        if (best) setStart(String(best.value))
      })
  }, [exercise])

  const milestone = long && kind === 'milestone'
  // Week/month goals have no kind picker: "Track from → Weight" alone makes it a weight milestone.
  const periodWeight = !long && metric === 'weight'
  const weight = (milestone && exercise === WEIGHT) || periodWeight
  const gym = milestone && !!exercise && exercise !== WEIGHT
  // Direction is a choice for hand-logged results and weight; a lift is always "higher is better".
  const lower = (milestone ? !gym : periodWeight) && lowerIsBetter
  // Only hand-logged lower-is-better results are times (h:mm:ss); a weight is plain kg.
  const timeInput = lower && !weight
  const targetValue = parseGoalValue(target, timeInput)
  const valid = title.trim() !== '' && (kind === 'done' || !(milestone || periodWeight) || targetValue != null)

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const savedKind = long ? kind : periodWeight ? 'milestone' : 'number'
    await supabase.from('goals').insert({
      user_id: user.id,
      title: title.trim(),
      period_type: period,
      period_start: periodStartISO(period),
      category_id: categoryId,
      kind: savedKind,
      target_value: savedKind === 'done' ? null : targetValue,
      auto_metric: weight ? 'weight' : savedKind === 'number' ? metric || null : null,
      source_exercise: gym ? exercise : null,
      lower_is_better: lower,
      start_value: milestone ? parseGoalValue(start, timeInput) : null,
      // Long-term goals don't repeat; week/month goals follow the switch (the check-up can change it later).
      recurring: !long && repeat,
    })
    onCreated()
  }

  const heading = long ? `New goal for ${period === 'year' ? format(new Date(), 'yyyy') : `Q${Math.floor(new Date().getMonth() / 3) + 1}`}` : tab === 'month' ? `New goal for ${format(new Date(), 'MMMM')}` : 'New weekly goal'
  const sub = long ? 'Checked in on monthly' : tab === 'month' ? 'Checked up at the end of the month' : 'Checked up at the end of the week'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <header className="hero shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} aria-label="Back" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-white/16 text-base text-white">
            ‹
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold">{heading}</h1>
            <p className="mt-0.5 text-xs font-medium text-white">{sub}</p>
          </div>
        </div>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={long ? 'Bench press 100 kg' : 'Call mom'}
          className="mt-4 w-full rounded-2xl bg-white/16 px-3.5 py-3 text-[15px] font-semibold text-white outline-none placeholder:text-white/55"
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-5 pb-4">
        {long && (
          <div className="grid grid-cols-2 gap-2">
            {(['year', 'quarter'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-2xl py-2.5 text-sm ${period === p ? 'bg-pine font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
              >
                {p === 'year' ? 'This year' : 'This quarter'}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">LABEL</p>
          <div className="flex flex-wrap gap-[7px]">
            {[{ id: null, name: 'None', color: 'violet' as const }, ...labels].map((c) => {
              const active = categoryId === c.id
              return (
                <button
                  key={c.id ?? 'none'}
                  onClick={() => setCategoryId(c.id)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs ${active ? 'bg-pine font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
                >
                  {c.id && <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_STYLES[c.color].accent }} />}
                  {c.name}
                </button>
              )
            })}
            {newLabel == null && (
              <button onClick={() => setNewLabel('')} className="rounded-full border border-dashed border-line-strong px-3.5 py-2 text-xs font-medium text-pine">
                + New label
              </button>
            )}
          </div>
          {/* Same categories table as Settings → Labels, so a label made here shows up there too. */}
          {newLabel != null && (
            <div className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-3">
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Money"
                className="bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-faint"
              />
              <div className="flex items-center gap-2">
                {CATEGORY_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    aria-label={CATEGORY_COLOR_LABELS[color]}
                    className={`h-6 w-6 rounded-full ${newColor === color ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                    style={{ background: CATEGORY_STYLES[color].accent }}
                  />
                ))}
                <span className="flex-1" />
                <button onClick={() => setNewLabel(null)} className="text-xs font-medium text-ink-3">
                  Cancel
                </button>
                <button onClick={addLabel} disabled={!newLabel.trim()} className="rounded-full bg-pine px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {long && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">WHAT KIND OF GOAL?</p>
            {KINDS.map((k) => {
              const active = kind === k.id
              return (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`flex flex-col gap-[3px] rounded-[18px] bg-surface text-left ${active ? 'border-2 border-pine px-3.5 py-[11px]' : 'border border-line px-[15px] py-3'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{k.title}</span>
                    {active && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pine text-[11px] text-white">✓</span>}
                  </span>
                  <span className="text-[11px] font-medium text-ink-muted">{k.hint}</span>
                </button>
              )
            })}
          </div>
        )}

        {!(long && kind === 'done') && (
          <div className="flex shrink-0 flex-col overflow-hidden rounded-[18px] border border-line bg-surface">
            <label className={ROW}>
              <span className="shrink-0 text-[13px] font-medium text-ink-3">{milestone || periodWeight || long ? 'Target' : 'Target (optional)'}</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                inputMode={timeInput ? 'text' : 'decimal'}
                placeholder={timeInput ? '3:00:00' : weight ? '90 kg' : milestone ? (gym ? '100 kg' : '100') : long ? '300 000' : 'none = done or not'}
                className={FIELD}
              />
            </label>
            <span className="block h-px bg-line" />
            <label className={ROW}>
              <span className="shrink-0 text-[13px] font-medium text-ink-3">Track from</span>
              {milestone ? (
                <select
                  value={exercise}
                  onChange={(e) => {
                    setExercise(e.target.value)
                    // Losing weight is the usual weight goal; flip the switch for a bulk.
                    if (e.target.value === WEIGHT) setLowerIsBetter(true)
                  }}
                  className={`${FIELD} appearance-none`}
                >
                  <option value="">✍️ By hand</option>
                  <option value={WEIGHT}>⚖️ Weight log</option>
                  {exercises.map((name) => (
                    <option key={name} value={name}>
                      🏋️ Gym log · {name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={metric}
                  onChange={(e) => {
                    setMetric(e.target.value)
                    if (e.target.value === 'weight') setLowerIsBetter(true)
                  }}
                  className={`${FIELD} appearance-none`}
                >
                  <option value="">Manual</option>
                  {!long && <option value="weight">⚖️ Weight (latest weigh-in)</option>}
                  {AUTO_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {METRIC_INFO[m].icon} {METRIC_INFO[m].label}
                    </option>
                  ))}
                  {SESSION_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {SESSION_METRIC_INFO[m].icon} {SESSION_METRIC_INFO[m].label}
                    </option>
                  ))}
                  <option value="savings">
                    {FINANCE_METRIC_INFO.savings.icon} {FINANCE_METRIC_INFO.savings.label}
                  </option>
                </select>
              )}
            </label>
            {milestone && !gym && (
              <>
                <span className="block h-px bg-line" />
                <label className={ROW}>
                  <span className="text-[13px] font-medium text-ink-3">{weight ? 'Lower is better' : 'Lower is better (times)'}</span>
                  <input type="checkbox" checked={lowerIsBetter} onChange={(e) => setLowerIsBetter(e.target.checked)} className="h-4 w-4 accent-pine" />
                </label>
              </>
            )}
            {milestone && (
              <>
                <span className="block h-px bg-line" />
                <label className={ROW}>
                  <span className="shrink-0 text-[13px] font-medium text-ink-3">Starting point</span>
                  <input value={start} onChange={(e) => setStart(e.target.value)} inputMode={timeInput ? 'text' : 'decimal'} placeholder={timeInput ? '3:30:00' : '80'} className={FIELD} />
                </label>
              </>
            )}
            {periodWeight && (
              <>
                <span className="block h-px bg-line" />
                <label className={ROW}>
                  <span className="text-[13px] font-medium text-ink-3">Lower is better</span>
                  <input type="checkbox" checked={lowerIsBetter} onChange={(e) => setLowerIsBetter(e.target.checked)} className="h-4 w-4 accent-pine" />
                </label>
              </>
            )}
            {!long && (
              <>
                <span className="block h-px bg-line" />
                <label className={ROW}>
                  <span className="text-[13px] font-medium text-ink-3">Repeat every {tab}</span>
                  <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4 accent-pine" />
                </label>
              </>
            )}
          </div>
        )}
        {milestone && !exercise && (
          <p className="text-[11px] font-medium leading-relaxed text-ink-muted">
            Log results by hand on the goal, e.g. race times
            {timeInput && targetValue != null ? ` — target reads ${formatGoalValue({ lower_is_better: true, source_exercise: null, auto_metric: null }, targetValue)}` : ''}.
          </p>
        )}
        {weight && <p className="text-[11px] font-medium leading-relaxed text-ink-muted">Uses your latest weigh-in from Journal → Weight, not your lightest ever.</p>}
      </div>

      <div className="shrink-0 px-5 pt-2 pb-7 safe-bottom">
        <button
          onClick={save}
          disabled={!valid || saving}
          className="w-full rounded-[20px] bg-pine py-[15px] text-sm font-semibold text-white disabled:opacity-50"
        >
          Create goal
        </button>
      </div>
    </div>
  )
}
