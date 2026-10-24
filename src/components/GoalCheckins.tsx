import { useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO } from '../lib/dates'
import { goalSource, goalStyle, rolloverRecurringGoals, type GoalPace } from '../lib/goals'
import { formatGoalValue, isWeightGoal, milestoneState, monthRatings, periodRatings, type MilestoneResult } from '../lib/checkins'
import type { Category, CheckinRating, Goal } from '../lib/types'
import { findOption } from '../lib/optionStore'
import type { OptionRow } from '../lib/editable'
import { useEdit } from '../contexts/EditContext'
import { EditDots, Pressable } from './ItemMenu'
import { OptionSheet } from './OptionSheet'

// The two check-up flows from the Goals round-8 handoff. Both write goal_checkins, one row
// per goal per reviewed period (upsert on goal_id + period_start, so re-doing one edits it).

/** A goal with everything the Goals screen resolved for it. */
export interface GoalRow {
  goal: Goal
  progress: number
  pace: GoalPace
  done: boolean
  /** Milestone goals only. */
  results: MilestoneResult[]
}

const fmt = (n: number) => Math.round(n).toLocaleString('sv-SE')

function Shell({ title, subtitle, onClose, hero, children, footer }: {
  title: string
  subtitle: string
  onClose: () => void
  hero: React.ReactNode
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page">
      <header className="hero shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} aria-label="Close" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] bg-white/16 text-base text-white">
            ✕
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] font-semibold">{title}</h1>
            <p className="mt-0.5 text-xs font-medium text-white">{subtitle}</p>
          </div>
        </div>
        {hero}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-4">{children}</div>
      <div className="flex shrink-0 gap-2.5 px-5 pt-2 pb-7 safe-bottom">{footer}</div>
    </div>
  )
}

const Label = ({ children, aside }: { children: React.ReactNode; aside?: string }) => (
  <div className="flex items-baseline justify-between">
    <p className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">{children}</p>
    {aside && <span className="text-[11px] font-medium text-ink-disabled">{aside}</span>}
  </div>
)

// ------------------------------------------------------------------ monthly, long-term (2b)

/**
 * The rating buttons' names/colours are edited in place (✎ or a long-press on a button). It's a
 * closed set — the ids are fixed — so the sheet offers rename, colour and order only.
 */
function useRatingEdit() {
  const { editing } = useEdit()
  const [row, setRow] = useState<OptionRow | null>(null)
  return {
    editing,
    open: (kind: 'month_rating' | 'period_rating', key: CheckinRating) => setRow(findOption(kind, key) ?? null),
    sheet: row && (
      <OptionSheet kind={row.kind} row={row} noun="rating" noIcon noDuplicate color={row.kind === 'month_rating' ? 'hex' : undefined} onClose={() => setRow(null)} />
    ),
  }
}

/** The glass chips under the goal title: numbers from wherever the goal gets them. */
function checkinChips(row: GoalRow, reviewStart: string, reviewEnd: string): string[] {
  const { goal, progress, pace, done } = row
  const month = format(new Date(reviewStart + 'T00:00:00'), 'MMM')
  if (goal.kind === 'done') return [done ? 'Done ✓' : 'Not done yet']
  if (goal.kind === 'milestone') {
    const now = milestoneState(goal, row.results, reviewStart)
    // The gain made inside the reviewed month only, not anything since.
    const gain = milestoneState(goal, row.results.filter((r) => r.date <= reviewEnd), reviewStart).gain
    if (!now.best) return ['No result yet']
    const v = (n: number) => formatGoalValue(goal, n)
    return [
      `${isWeightGoal(goal) ? 'Now' : 'Best'} ${v(now.best.value)}${now.best.reps ? ` × ${now.best.reps}` : ''}`,
      gain ? `${gain > 0 ? '+' : '−'}${v(Math.abs(gain))} in ${month}` : `No change in ${month}`,
      now.toGo ? `${v(now.toGo)} to go` : 'Target hit',
    ]
  }
  if (goal.target_value == null) return [fmt(progress)]
  const chips = [`${fmt(progress)} of ${fmt(goal.target_value)}`]
  if (pace.projected != null) chips.push(`Lands on ${fmt(pace.projected)}`)
  const gap = goal.target_value - (pace.projected ?? progress)
  chips.push(gap > 0 ? `${fmt(gap)} short` : 'On target')
  return chips
}

export function LongTermCheckin({ rows, reviewStart, categories, onClose, onSaved }: {
  rows: GoalRow[]
  /** First day of the month being reviewed. */
  reviewStart: string
  categories: Map<string, Category>
  onClose: () => void
  onSaved: () => void
}) {
  const [step, setStep] = useState(0)
  const [rating, setRating] = useState<CheckinRating | null>(null)
  const ratingEdit = useRatingEdit()
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState('')
  const [taskAdded, setTaskAdded] = useState(false)
  const [saving, setSaving] = useState(false)

  const row = rows[step]
  const reviewDate = new Date(reviewStart + 'T00:00:00')
  const reviewEnd = periodEndISO('month', reviewStart)
  const nextMonth = new Date(reviewDate.getFullYear(), reviewDate.getMonth() + 1, 1)
  const style = goalStyle(row.goal, categories)

  async function advance(save: boolean) {
    if (saving) return
    setSaving(true)
    // Skipping still writes a row (rating null) so the check-in stops being due.
    await supabase.from('goal_checkins').upsert(
      {
        goal_id: row.goal.id,
        period_start: reviewStart,
        rating: save ? rating : null,
        note: save ? note.trim() || null : null,
        focus: save ? focus.trim() || null : null,
      },
      { onConflict: 'goal_id,period_start' },
    )
    setSaving(false)
    if (step + 1 >= rows.length) {
      onSaved()
      return
    }
    setStep(step + 1)
    setRating(null)
    setNote('')
    setFocus('')
    setTaskAdded(false)
  }

  async function makeTask() {
    if (!focus.trim() || taskAdded) return
    setTaskAdded(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('daily_tasks').insert({
      user_id: user.id,
      title: focus.trim(),
      active: true,
      recurring: true,
      goal_series_id: row.goal.series_id,
      category_id: row.goal.category_id,
    })
  }

  const hero = (
    <>
      <div className="mt-4 grid gap-[5px]" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r, i) => (
          <span key={r.goal.id} className="h-[5px] rounded-full" style={{ background: i <= step ? '#fff' : 'rgba(255,255,255,.25)' }} />
        ))}
      </div>
      <p className="mt-4 text-xl font-semibold text-white">{row.goal.title}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {checkinChips(row, reviewStart, reviewEnd).map((chip) => (
          <span key={chip} className="rounded-full bg-white/16 px-[11px] py-[5px] text-xs font-medium text-white">
            {chip}
          </span>
        ))}
      </div>
    </>
  )

  return (
    <Shell
      title={`${format(new Date(), 'MMMM')} check-in`}
      subtitle={`Goal ${step + 1} of ${rows.length}`}
      onClose={onClose}
      hero={hero}
      footer={
        <>
          <button onClick={() => advance(false)} className="rounded-[20px] border border-line-strong bg-surface px-[18px] py-[15px] text-sm font-semibold text-pine">
            Skip
          </button>
          <button onClick={() => advance(true)} disabled={!rating || saving} className="flex-1 rounded-[20px] bg-pine py-[15px] text-sm font-semibold text-white disabled:opacity-50">
            {step + 1 >= rows.length ? 'Save & finish' : 'Save & next goal ›'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-[9px]">
        <Label>HOW DID {format(reviewDate, 'MMMM').toUpperCase()} GO?</Label>
        <div className="grid grid-cols-3 gap-2">
          {monthRatings().map((r) => (
            <span key={r.key} className="relative flex">
              <Pressable
                onLongPress={() => ratingEdit.open('month_rating', r.key)}
                onClick={() => setRating(r.key)}
                className={`w-full rounded-2xl py-3 text-[13px] ${rating === r.key ? 'font-semibold text-white' : 'border border-line bg-surface font-medium text-ink-2'}`}
                style={rating === r.key ? { background: r.color ?? undefined } : undefined}
              >
                {r.label}
              </Pressable>
              {ratingEdit.editing && (
                <span className="absolute -right-1 -top-1.5">
                  <EditDots onClick={() => ratingEdit.open('month_rating', r.key)} label={r.label} />
                </span>
              )}
            </span>
          ))}
        </div>
        {ratingEdit.sheet}
      </div>

      <div className="flex flex-col gap-[9px]">
        <Label>A LINE FOR FUTURE YOU</Label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="What worked, what didn't"
          className="min-h-[76px] rounded-[20px] border border-line bg-surface px-4 py-[13px] text-sm leading-normal text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
        />
      </div>

      <div className="flex flex-col gap-[9px]">
        <Label aside="optional">{format(nextMonth, 'MMMM').toUpperCase()} FOCUS</Label>
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface px-4 py-3.5 shadow-card">
          <input
            value={focus}
            onChange={(e) => {
              setFocus(e.target.value)
              setTaskAdded(false)
            }}
            placeholder="One thing to lean on next month"
            className="bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-disabled"
          />
          {focus.trim() && (
            <button
              onClick={makeTask}
              className="self-start rounded-full px-[11px] py-1.5 text-[11px] font-semibold"
              style={{ background: style.tint, color: style.ink }}
            >
              {taskAdded ? '✓ Added to Today' : '+ Make it a daily task'}
            </button>
          )}
        </div>
      </div>
    </Shell>
  )
}

// ------------------------------------------------------------------ week / month (3c)


export function PeriodCheckup({ periodType, title, rows, suggested, reviewStart, nextLabel, categories, onClose, onSaved }: {
  periodType: 'week' | 'month'
  title: string
  rows: GoalRow[]
  /** Pre-selected answers the data already knows (suggestRating). */
  suggested: Map<string, CheckinRating | null>
  reviewStart: string
  /** "week 41" / "November" — for the repeat switch. */
  nextLabel: string
  categories: Map<string, Category>
  onClose: () => void
  onSaved: () => void
}) {
  const [ratings, setRatings] = useState(() => new Map(suggested))
  const ratingEdit = useRatingEdit()
  const [note, setNote] = useState('')
  const [repeat, setRepeat] = useState(true)
  const [saving, setSaving] = useState(false)

  const known = rows.filter((r) => suggested.get(r.goal.id) != null).length
  const left = rows.length - known
  const start = new Date(reviewStart + 'T00:00:00')
  const end = new Date(periodEndISO(periodType, reviewStart) + 'T00:00:00')

  async function save() {
    if (saving) return
    setSaving(true)
    await supabase.from('goal_checkins').upsert(
      rows.map((r) => ({ goal_id: r.goal.id, period_start: reviewStart, rating: ratings.get(r.goal.id) ?? null })),
      { onConflict: 'goal_id,period_start' },
    )
    if (note.trim()) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('goal_checkin_notes')
          .upsert({ user_id: user.id, period_type: periodType, period_start: reviewStart, note: note.trim() }, { onConflict: 'user_id,period_type,period_start' })
      }
    }
    // The switch decides whether these goals carry on. ponytail: rows for the next period that
    // already exist (rollover runs on every load) are left alone — off only stops further repeats.
    await supabase
      .from('goals')
      .update({ recurring: repeat })
      .in(
        'series_id',
        rows.map((r) => r.goal.series_id),
      )
    if (repeat) await rolloverRecurringGoals()
    onSaved()
  }

  return (
    <Shell
      title={title}
      subtitle={`${format(start, 'd MMM')} – ${format(end, 'd MMM')} · ${rows.length} goal${rows.length === 1 ? '' : 's'}`}
      onClose={onClose}
      hero={
        <p className="mt-4 text-sm font-medium leading-snug text-white">
          {known === 0
            ? `${rows.length} to answer.`
            : left === 0
              ? `All ${known} answered from your data. Just save.`
              : `${known} already answered from your data. ${left} to go.`}
        </p>
      }
      footer={
        <button onClick={save} disabled={saving} className="flex-1 rounded-[20px] bg-pine py-[15px] text-sm font-semibold text-white disabled:opacity-50">
          Save {periodType}
        </button>
      }
    >
      {ratingEdit.sheet}
      <div className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const style = goalStyle(r.goal, categories)
          const source = r.goal.auto_metric ? ` · ${goalSource(r.goal).split(' ').slice(1).join(' ')}` : ''
          const caption =
            r.goal.target_value == null
              ? null
              : r.goal.kind === 'milestone'
                ? `${r.results.length ? `Now ${formatGoalValue(r.goal, r.progress)}` : 'No weigh-in'} · target ${formatGoalValue(r.goal, r.goal.target_value)}`
                : `${fmt(r.progress)} of ${fmt(r.goal.target_value)}${source}`
          const header = (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: style.accent }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{r.goal.title}</span>
            </>
          )
          if (r.goal.status === 'done') {
            return (
              <div key={r.goal.id} className="flex items-center gap-2 rounded-[18px] border border-line bg-surface px-3.5 py-3">
                {header}
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: style.tint, color: style.ink }}>
                  Done ✓
                </span>
              </div>
            )
          }
          const value = ratings.get(r.goal.id) ?? null
          return (
            <div key={r.goal.id} className="flex flex-col gap-[9px] rounded-[18px] border border-line bg-surface px-3.5 py-3">
              <div className="flex items-center gap-2">
                {header}
                {caption && <span className="shrink-0 text-[10px] font-medium text-ink-muted">{caption}</span>}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {periodRatings().map((opt) => (
                  <span key={opt.key} className="relative flex">
                    <Pressable
                      onLongPress={() => ratingEdit.open('period_rating', opt.key)}
                      onClick={() => setRatings((m) => new Map(m).set(r.goal.id, opt.key))}
                      className={`w-full rounded-xl py-2 text-xs ${value === opt.key ? 'font-semibold text-white' : 'bg-[#efe9dc] font-medium text-ink-2'}`}
                      style={value === opt.key ? { background: opt.color ?? style.ink } : undefined}
                    >
                      {opt.label}
                    </Pressable>
                    {ratingEdit.editing && (
                      <span className="absolute -right-1 -top-1.5">
                        <EditDots onClick={() => ratingEdit.open('period_rating', opt.key)} label={opt.label} />
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={`Anything about this ${periodType}? (optional)`}
        className="rounded-[18px] border border-line bg-surface px-3.5 py-3 text-[13px] text-ink outline-none placeholder:text-ink-disabled focus:border-pine"
      />

      <label className="flex items-center gap-2.5 px-1">
        <span className="flex-1 text-xs font-medium text-ink-2">
          Repeat all {rows.length} in {nextLabel}
        </span>
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="h-4 w-4 accent-pine" />
      </label>
    </Shell>
  )
}
