import { Fragment, useEffect, useState } from 'react'
import { addDays, addMonths, differenceInCalendarDays, format, getISOWeek } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO, periodStartISO } from '../lib/dates'
import {
  goalMetricInfo,
  goalPace,
  goalSource,
  goalStyle,
  isGoalDone,
  isGoalMetric,
  isOffPace,
  loadMilestoneResults,
  resolveGoalProgress,
  rolloverRecurringGoals,
} from '../lib/goals'
import { CATEGORY_STYLES } from '../lib/categories'
import { coversMonth, formatGoalValue, historyDots, milestoneState, reviewPeriod, suggestRating } from '../lib/checkins'
import { useNav } from '../contexts/NavContext'
import { ChipRail, HeroSegments, Screen } from '../components/Screen'
import { ProgressRing } from '../components/ProgressRing'
import { GoalForm, type GoalTab } from '../components/GoalForm'
import { LongTermCheckin, PeriodCheckup, type GoalRow } from '../components/GoalCheckins'
import type { Category, CheckinRating, Goal, GoalCheckin, PeriodType } from '../lib/types'

// Goals round 8 (design_handoff_goals, frames 3a/3b/3c): three tabs instead of four stacked
// horizons. Long-term = year + quarter goals of three kinds (number / milestone / do it)
// with a monthly check-in; the month and week tabs hold lighter goals grouped by label,
// each with an 8-period history and an end-of-period check-up. Colour comes from the
// goal's label (goals.category_id), never guessed.

const fmt = (n: number) => Math.round(n).toLocaleString('sv-SE')
const KIND_LABEL = { number: 'number', milestone: 'milestone', done: 'do it' } as const
const DOT = { done: 1, partly: 0.35 } as const
const MISSED = '#ece5d7'

/**
 * The check-up's pre-selected answer. Sums use suggestRating (≥ target = done); a weight
 * goal is done when the latest weigh-in hits the target, partly when it moved the right way
 * during the period — "progress ≥ target" would call being heavier a success.
 */
function suggestCheckup(row: GoalRow, periodStart: string): CheckinRating | null {
  if (row.goal.kind !== 'milestone') return suggestRating(row.goal, row.progress)
  if (!row.results.length) return null
  if (row.done) return 'done'
  return (milestoneState(row.goal, row.results, periodStart).gain ?? 0) > 0 ? 'partly' : 'missed'
}

const unitOf = (goal: Goal) => (isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric).unit : '')
/** "1 session", not "1 sessions" — the metric units are all plurals. */
const unitFor = (goal: Goal, n: number) => {
  const unit = unitOf(goal)
  return Math.round(n) === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit
}
// Distance reads better with a decimal (14.3 of 35 km); every other unit is whole.
const fmtValue = (goal: Goal, n: number) => (goal.auto_metric === 'cardio_km' && n < 100 ? (Math.round(n * 10) / 10).toLocaleString('sv-SE') : fmt(n))
const goalIcon = (goal: Goal) =>
  isGoalMetric(goal.auto_metric) ? goalMetricInfo(goal.auto_metric).icon : goal.kind === 'milestone' ? '📈' : goal.target_value == null ? '☑️' : '🎯'
/** Where the number comes from, e.g. "Gym sessions (Strava)" — the icon tile shows the emoji. */
const sourceText = (goal: Goal) =>
  goal.kind === 'number' && isGoalMetric(goal.auto_metric)
    ? goalMetricInfo(goal.auto_metric).label
    : goal.kind === 'number' && goal.target_value != null
      ? 'Counted by hand'
      : goalSource(goal).replace(/^\P{ASCII}+\s/u, '')
/** Only number goals have a pace to fall behind; a milestone or a plain to-do is judged at check-up. */
const offPace = (row: GoalRow) => row.goal.kind === 'number' && row.goal.target_value != null && isOffPace(row.pace, row.done)

function daysLeft(periodType: PeriodType, start: string): number {
  const end = new Date(periodEndISO(periodType, start) + 'T00:00:00')
  return Math.max(0, differenceInCalendarDays(end, new Date()))
}

const Circle = ({ done, color, onClick, size = 26 }: { done: boolean; color: string; onClick: () => void; size?: number }) => (
  <span
    role="button"
    aria-label={done ? 'Mark as not done' : 'Mark as done'}
    onClick={(e) => {
      e.stopPropagation()
      onClick()
    }}
    className="flex shrink-0 items-center justify-center rounded-full text-[13px] text-white"
    style={{ height: size, width: size, ...(done ? { background: color } : { border: '2px solid #c8c1b1' }) }}
  >
    {done ? '✓' : ''}
  </span>
)

export function Goals() {
  const { openGoalDetail } = useNav()
  const [tab, setTab] = useState<GoalTab>('long')
  const [label, setLabel] = useState('all')
  const [all, setAll] = useState<Goal[]>([])
  const [rowsById, setRowsById] = useState<Map<string, GoalRow>>(new Map())
  const [categories, setCategories] = useState<Category[]>([])
  const [checkins, setCheckins] = useState<Map<string, GoalCheckin>>(new Map())
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [checkingIn, setCheckingIn] = useState<GoalTab | null>(null)

  const today = new Date()
  const current = { week: periodStartISO('week'), month: periodStartISO('month'), quarter: periodStartISO('quarter'), year: periodStartISO('year') }
  const weekReview = reviewPeriod('week', today)
  const monthReview = reviewPeriod('month', today)
  const monthReviewEnd = periodEndISO('month', monthReview.start)

  async function load() {
    setLoading(true)
    await rolloverRecurringGoals()
    const [{ data: goalRows }, { data: catRows }, { data: checkinRows }] = await Promise.all([
      supabase.from('goals').select('*').order('created_at'),
      supabase.from('categories').select('*').order('position').order('name'),
      supabase.from('goal_checkins').select('*'),
    ])
    const goals = (goalRows ?? []) as Goal[]
    setAll(goals)
    setCategories((catRows ?? []) as Category[])
    setCheckins(new Map(((checkinRows ?? []) as GoalCheckin[]).map((c) => [c.goal_id, c])))

    // Resolve only what's on screen or due for a check-up: current periods, the reviewed
    // week/month, and the long-term goals that covered the reviewed month.
    const needed = goals.filter(
      (g) =>
        g.period_start === current[g.period_type] ||
        (g.period_type === 'week' && g.period_start === weekReview.start) ||
        (g.period_type === 'month' && g.period_start === monthReview.start) ||
        ((g.period_type === 'year' || g.period_type === 'quarter') && coversMonth(g, monthReview.start)),
    )
    const resolved = await Promise.all(
      needed.map(async (goal): Promise<GoalRow> => {
        // Milestones (incl. weight goals, which can be weekly/monthly too) read their results.
        if (goal.kind === 'milestone') {
          // A weight goal's "now" can predate the period (last weigh-in was last month), but a
          // past week is judged as of its own end, not by today's weight.
          const results = (await loadMilestoneResults(goal)).filter((r) =>
            goal.auto_metric === 'weight' ? r.date <= periodEndISO(goal.period_type, goal.period_start) : r.date >= goal.period_start,
          )
          const state = milestoneState(goal, results, goal.period_start)
          return { goal, progress: state.best?.value ?? 0, pace: goalPace(goal, 0), done: state.toGo === 0, results }
        }
        const { progress, isRollup } = await resolveGoalProgress(goal)
        const done = goal.kind === 'done' ? goal.status === 'done' : isGoalDone(goal, progress, isRollup)
        return { goal, progress, pace: goalPace(goal, progress), done, results: [] }
      }),
    )
    setRowsById(new Map(resolved.map((r) => [r.goal.id, r])))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const rowsFor = (pred: (g: Goal) => boolean) => [...rowsById.values()].filter((r) => pred(r.goal))
  const isLong = (g: Goal) => g.period_type === 'year' || g.period_type === 'quarter'
  const tabRows =
    tab === 'long'
      ? rowsFor((g) => isLong(g) && g.period_start === current[g.period_type])
      : rowsFor((g) => g.period_type === tab && g.period_start === current[tab])
  const labelKey = (g: Goal) => g.category_id ?? 'none'
  const visible = label === 'all' ? tabRows : tabRows.filter((r) => labelKey(r.goal) === label)

  // --- label chips: All, then one per label present in this tab
  const labelCounts = new Map<string, number>()
  for (const r of tabRows) labelCounts.set(labelKey(r.goal), (labelCounts.get(labelKey(r.goal)) ?? 0) + 1)
  const chipOptions = [
    { id: 'all', label: `All ${tabRows.length}` },
    ...categories
      .filter((c) => labelCounts.has(c.id))
      .map((c) => ({ id: c.id, label: `${c.name} ${labelCounts.get(c.id)}`, dot: goalStyle({ category_id: c.id }, categoryById).accent })),
    ...(labelCounts.has('none') ? [{ id: 'none', label: `No label ${labelCounts.get('none')}`, dot: goalStyle({ category_id: null }, categoryById).accent }] : []),
  ]

  // --- check-ups due (the glass row under the tabs)
  const answered = (g: Goal) => checkins.has(g.id)
  const weekRows = rowsFor((g) => g.period_type === 'week' && g.period_start === weekReview.start)
  const monthRows = rowsFor((g) => g.period_type === 'month' && g.period_start === monthReview.start)
  // Long-term goals that existed during the reviewed month and haven't been checked in on.
  const longDue = rowsFor((g) => isLong(g) && coversMonth(g, monthReview.start) && g.created_at.slice(0, 10) <= monthReviewEnd && !answered(g))
  const plural = (n: number) => `${n} goal${n === 1 ? '' : 's'}`
  const due =
    tab === 'long'
      ? longDue.length > 0 && { title: `${format(today, 'MMMM')} check-in`, detail: plural(longDue.length), ended: true }
      : tab === 'week'
        ? weekRows.some((r) => !answered(r.goal)) && {
            title: `Week ${getISOWeek(new Date(weekReview.start + 'T00:00:00'))} check-up`,
            detail: weekReview.isCurrent ? 'today' : plural(weekRows.length),
            ended: !weekReview.isCurrent,
          }
        : monthRows.some((r) => !answered(r.goal)) && {
            title: `${format(new Date(monthReview.start + 'T00:00:00'), 'MMMM')} check-up`,
            detail: monthReview.isCurrent ? 'today' : plural(monthRows.length),
            ended: !monthReview.isCurrent,
          }

  function patchRow(id: string, goalPatch: Partial<Goal>, rowPatch: (r: GoalRow) => Partial<GoalRow>) {
    setRowsById((m) => {
      const r = m.get(id)
      if (!r) return m
      return new Map(m).set(id, { ...r, goal: { ...r.goal, ...goalPatch }, ...rowPatch(r) })
    })
  }

  async function toggleDone(goal: Goal) {
    const status = goal.status === 'done' ? 'active' : 'done'
    patchRow(goal.id, { status }, () => ({ done: status === 'done' }))
    await supabase.from('goals').update({ status }).eq('id', goal.id)
  }

  async function bump(goal: Goal, delta: number) {
    const progress = Math.max(0, goal.progress + delta)
    const status = goal.target_value != null && progress >= goal.target_value ? 'done' : 'active'
    patchRow(goal.id, { progress, status }, () => ({ progress, done: status === 'done', pace: goalPace({ ...goal, progress }, progress) }))
    await supabase.from('goals').update({ progress, status }).eq('id', goal.id)
  }

  // --- the hero's summary: how far the tab's goals have come, and how many are on pace
  const scored = tabRows.filter((r) => (r.goal.kind === 'number' && r.goal.target_value != null) || r.goal.target_value == null)
  const avgPct = scored.length
    ? (scored.reduce((sum, r) => sum + (r.done ? 1 : r.goal.target_value ? Math.min(1, r.progress / r.goal.target_value) : 0), 0) / scored.length) * 100
    : 0
  const behind = tabRows.filter(offPace).length
  const periodLine =
    tab === 'long'
      ? (['year', 'quarter'] as const)
          .filter((p) => tabRows.some((r) => r.goal.period_type === p))
          .map((p) => `${p === 'year' ? format(new Date(current.year + 'T00:00:00'), 'yyyy') : `Q${Math.floor(new Date(current.quarter + 'T00:00:00').getMonth() / 3) + 1}`} · ${daysLeft(p, current[p])} days left`)
          .join(' · ')
      : `${
          tab === 'week'
            ? `Week ${getISOWeek(new Date(current.week + 'T00:00:00'))} · ${format(new Date(current.week + 'T00:00:00'), 'd')}–${format(new Date(periodEndISO('week', current.week) + 'T00:00:00'), 'd MMM')}`
            : format(today, 'MMMM')
        } · ${daysLeft(tab, current[tab]) === 0 ? 'last day' : `${daysLeft(tab, current[tab])} days left`}`
  const summary = (
    <div className="mt-3.5 flex items-center gap-3.5">
      <ProgressRing percent={avgPct} size={58} strokeWidth={6} color="#fff" trackColor="rgba(255,255,255,.2)">
        <span className="text-[13px] font-semibold text-white">{Math.round(avgPct)}%</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold text-white">
          {behind === 0 ? `All ${tabRows.length} on track` : `${tabRows.length - behind} of ${tabRows.length} on track`}
        </p>
        <p className="mt-0.5 truncate text-xs font-medium text-white/75">{periodLine}</p>
      </div>
    </div>
  )

  const hero = (
    <>
      <HeroSegments
        options={[
          { id: 'long', label: 'Long-term' },
          { id: 'month', label: format(today, 'MMMM') },
          { id: 'week', label: 'This week' },
        ]}
        value={tab}
        onChange={(t) => {
          setTab(t)
          setLabel('all')
        }}
      />
      {!loading && tabRows.length > 0 && summary}
      {!loading && due && (
        <div className="mt-3 flex items-center gap-2.5 rounded-2xl bg-white/14 py-2.5 pr-2.5 pl-3.5">
          <span className="min-w-0 flex-1 text-[13px] font-medium text-white">
            <strong className="font-semibold">{due.title}</strong> · {due.detail}
          </span>
          <button
            onClick={() => setCheckingIn(tab)}
            className={`shrink-0 rounded-xl px-3 py-[7px] text-xs font-semibold ${due.ended ? 'bg-surface text-pine-dark' : 'bg-white/18 text-white'}`}
          >
            {due.ended ? 'Start' : 'Do it now'}
          </button>
        </div>
      )}
    </>
  )

  // ------------------------------------------------------------------ goal card
  // One card for every number goal (quarter, month, week) and every week/month goal: an
  // icon tile in the label's colour, a pace verdict, the number big with its unit, a bar
  // with today's pace tick, and — on week/month goals — the last few periods as dots.
  function goalCard(row: GoalRow, history: boolean) {
    const { goal, progress, pace, done } = row
    const style = goalStyle(goal, categoryById)
    const target = goal.target_value
    const hasBar = goal.kind === 'number' && target != null
    const manual = hasBar && !goal.auto_metric
    const dots = history ? historyDots(all.filter((g) => g.series_id === goal.series_id && g.period_type === goal.period_type), checkins, goal.period_start) : []

    let pill: { label: string; bg: string; fg: string } | null = null
    if (done && target != null) pill = { label: 'Done ✓', bg: CATEGORY_STYLES.emerald.tint, fg: CATEGORY_STYLES.emerald.ink }
    else if (hasBar && pace.started && pace.delta != null) {
      const amount = Math.abs(pace.delta)
      const unit = unitFor(goal, amount)
      // Outside the 5% band but rounding to nothing ("0 sessions ahead") reads as on pace.
      pill = pace.onPace || fmtValue(goal, amount) === '0'
        ? { label: 'On pace', bg: CATEGORY_STYLES.emerald.tint, fg: CATEGORY_STYLES.emerald.ink }
        : pace.delta > 0
          ? { label: `${fmtValue(goal, amount)}${unit ? ` ${unit}` : ''} ahead`, bg: CATEGORY_STYLES.emerald.tint, fg: CATEGORY_STYLES.emerald.ink }
          : { label: `${fmtValue(goal, amount)}${unit ? ` ${unit}` : ''} behind`, bg: CATEGORY_STYLES.amber.tint, fg: CATEGORY_STYLES.amber.ink }
    }

    let side: React.ReactNode = null
    if (target == null) side = <Circle done={done} color={style.check} onClick={() => toggleDone(goal)} size={28} />
    else if (goal.kind === 'milestone')
      side = (
        <span className="shrink-0 text-sm font-semibold" style={{ color: style.ink }}>
          {row.results.length ? formatGoalValue(goal, progress) : '—'} / {formatGoalValue(goal, target)}
        </span>
      )

    let line: string | null = null
    if (hasBar && !done) {
      const remaining = Math.max(0, target - progress)
      line = `${fmtValue(goal, remaining)}${unitOf(goal) ? ` ${unitFor(goal, remaining)}` : ''} to go`
      if ((goal.period_type === 'quarter' || goal.period_type === 'year') && pace.started && pace.projected != null && progress > 0)
        line += ` · heading for ${fmtValue(goal, pace.projected)}`
    }

    return (
      <div
        key={goal.id}
        role="button"
        onClick={() => openGoalDetail(goal.id)}
        className="flex cursor-pointer flex-col gap-2.5 rounded-[20px] border border-line bg-surface px-[15px] py-[13px] shadow-card"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-lg" style={{ background: style.tint }}>
            {goalIcon(goal)}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`line-clamp-2 text-[15px] font-semibold leading-snug ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
            <p className="truncate text-[11px] font-medium text-ink-muted">{sourceText(goal)}</p>
          </div>
          {pill && (
            <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: pill.bg, color: pill.fg }}>
              {pill.label}
            </span>
          )}
          {side}
        </div>
        {hasBar && (
          <>
            <div className="flex items-end justify-between gap-2">
              <span className="text-[22px] font-semibold leading-none" style={{ color: style.ink }}>
                {fmtValue(goal, progress)}
                <span className="text-[13px] font-medium text-ink-muted">
                  {' '}
                  / {fmtValue(goal, target)}
                  {unitOf(goal) ? ` ${unitOf(goal)}` : ''}
                </span>
              </span>
              {manual ? (
                <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => bump(goal, -1)} aria-label="Less" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#efe9dc] font-semibold text-ink-3">
                    −
                  </button>
                  <button onClick={() => bump(goal, 1)} aria-label="More" className="flex h-8 w-8 items-center justify-center rounded-full font-semibold text-white" style={{ background: style.check }}>
                    +
                  </button>
                </span>
              ) : null}
            </div>
            <div className="relative h-2 rounded-full bg-[#ece5d7]">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (progress / target) * 100)}%`, background: style.accent }} />
              {!done && pace.started && (
                <span className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-sm bg-ink/70" style={{ left: `${pace.elapsedFraction * 100}%` }} />
              )}
            </div>
          </>
        )}
        {(line || dots.length > 0) && (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[11px] font-medium text-ink-2">{line}</span>
            {dots.length > 0 && (
              <span className="flex shrink-0 gap-[3px]" title={`Last ${dots.length} ${goal.period_type}s`}>
                {dots.map((d, i) => (
                  <span key={i} className="h-2 w-2 rounded-[3px]" style={d === 'missed' ? { background: MISSED } : { background: style.accent, opacity: DOT[d] }} />
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------------ long-term cards (3a)
  function longCard(row: GoalRow) {
    const { goal, progress, pace, done } = row
    const style = goalStyle(goal, categoryById)
    const labelName = goal.category_id ? (categoryById.get(goal.category_id)?.name ?? 'General') : 'General'
    const edge = <span className="w-[5px] shrink-0 self-stretch" style={{ background: style.accent }} />
    if (goal.kind === 'number' && goal.target_value != null) return goalCard(row, false)

    if (goal.kind === 'done') {
      return (
        <button onClick={() => openGoalDetail(goal.id)} className="flex items-center gap-3 overflow-hidden rounded-[20px] border border-line bg-surface py-3 pr-[15px] text-left">
          {edge}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="self-start rounded-full px-[9px] py-[3px] text-[10px] font-semibold" style={{ background: style.tint, color: style.ink }}>
              {labelName} · do it
            </span>
            <p className={`text-[15px] font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
          </div>
          <Circle done={done} color={style.check} onClick={() => toggleDone(goal)} />
        </button>
      )
    }

    let value = fmt(progress)
    let bar: React.ReactNode = null
    let line: string | null = null
    if (goal.kind === 'milestone') {
      // "Latest gain" = since the start of last month, matching the check-in's "+x in <month>".
      const m = milestoneState(goal, row.results, format(addMonths(new Date(current.month + 'T00:00:00'), -1), 'yyyy-MM-dd'))
      const v = (n: number) => formatGoalValue(goal, n)
      value = m.best ? v(m.best.value) : '—'
      if (m.basePct + m.gainPct > 0) {
        bar = (
          <div className="relative h-[7px] overflow-hidden rounded-full bg-[#ece5d7]">
            <span className="absolute inset-y-0 left-0 rounded-full opacity-35" style={{ width: `${m.basePct + m.gainPct}%`, background: style.accent }} />
            <span className="absolute inset-y-0 rounded-r-full" style={{ left: `${m.basePct}%`, width: `${m.gainPct}%`, background: style.accent }} />
          </div>
        )
      }
      line = !m.best
        ? `No result yet${goal.source_exercise || goal.auto_metric === 'weight' ? '' : ' · log one on the goal'}`
        : [goal.start_value != null ? `From ${v(goal.start_value)}` : null, m.toGo ? `${v(m.toGo)} to go` : 'Target hit'].filter(Boolean).join(' · ')
    } else if (goal.target_value != null) {
      const pct = Math.min(100, (progress / goal.target_value) * 100)
      bar = (
        <div className="relative h-[7px] rounded-full bg-[#ece5d7]">
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: style.accent }} />
          <span className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-sm bg-ink" style={{ left: `${pace.elapsedFraction * 100}%` }} />
        </div>
      )
      if (done) line = `Done · ${fmt(progress)} of ${fmt(goal.target_value)}`
      else if (pace.projected != null && pace.started) {
        const gap = goal.target_value - pace.projected
        line = `Lands on ${fmt(pace.projected)} at this pace · ${gap > 0 ? `${fmt(gap)} short` : 'on target'}`
      }
    }

    // Quarter number goals are a one-line row (frame 3a's Q4 section); everything else a card.
    if (goal.period_type === 'quarter' && goal.kind === 'number') {
      return (
        <button onClick={() => openGoalDetail(goal.id)} className="flex overflow-hidden rounded-[20px] border border-line bg-surface text-left">
          {edge}
          <div className="flex min-w-0 flex-1 items-center gap-2.5 px-[15px] py-3">
            <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
            <span className="text-xs font-semibold" style={{ color: style.ink }}>
              {fmt(progress)}
              {goal.target_value != null ? ` / ${fmt(goal.target_value)}` : ''}
            </span>
          </div>
        </button>
      )
    }

    return (
      <button onClick={() => openGoalDetail(goal.id)} className="flex overflow-hidden rounded-[20px] border border-line bg-surface text-left shadow-card">
        {edge}
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-[15px] py-3">
          <div className="flex items-center justify-between gap-2.5">
            <span className="rounded-full px-[9px] py-[3px] text-[10px] font-semibold" style={{ background: style.tint, color: style.ink }}>
              {labelName} · {KIND_LABEL[goal.kind]}
            </span>
            <span className="text-[10px] font-medium text-ink-muted">{goalSource(goal)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2.5">
            <p className={`min-w-0 text-[15px] font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
            <span className="shrink-0 text-[15px] font-semibold" style={{ color: style.ink }}>
              {value}
            </span>
          </div>
          {bar}
          {line && <p className="text-[11px] font-medium text-ink-2">{line}</p>}
        </div>
      </button>
    )
  }

  // ------------------------------------------------------------------ week / month (3b)
  function periodTab(periodType: 'week' | 'month') {
    const groups = [...categories.map((c) => c.id), 'none']
      .map((key) => ({ key, rows: visible.filter((r) => labelKey(r.goal) === key) }))
      .filter((g) => g.rows.length > 0)
    const anyHistory = visible.some((r) => all.some((g) => g.series_id === r.goal.series_id && g.period_start < r.goal.period_start))
    return (
      <>
        {groups.length === 0 && <p className="text-sm text-ink-disabled">No goals for this {periodType} yet.</p>}
        {groups.map(({ key, rows }) => {
          const style = goalStyle({ category_id: key === 'none' ? null : key }, categoryById)
          const name = key === 'none' ? 'GENERAL' : (categoryById.get(key)?.name ?? '').toUpperCase()
          return (
            <div key={key} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: style.accent }} />
                <span className="text-[11px] font-semibold tracking-[0.07em]" style={{ color: style.ink }}>
                  {name}
                </span>
                <span className="h-px flex-1 bg-line-strong" />
              </div>
              {rows.map((r) => goalCard(r, true))}
            </div>
          )
        })}
        {anyHistory && (
          <span className="flex items-center justify-center gap-3 text-[10px] font-medium text-ink-muted">
            <span>Past {periodType}s:</span>
            {(['done', 'partly', 'missed'] as const).map((d) => (
              <span key={d} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-[3px]" style={d === 'missed' ? { background: MISSED } : { background: '#58534a', opacity: DOT[d] }} />
                {d}
              </span>
            ))}
          </span>
        )}
      </>
    )
  }

  function longTab() {
    const sections = (['year', 'quarter'] as const)
      .map((p) => ({ p, rows: visible.filter((r) => r.goal.period_type === p) }))
      .filter((s) => s.rows.length > 0)
    if (sections.length === 0) {
      return <p className="text-sm text-ink-disabled">No long-term goals yet. A year or quarter goal can be a number, a milestone or just something to do.</p>
    }
    return sections.map(({ p, rows }) => {
      const start = current[p]
      return (
        <div key={p} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">
              {p === 'year' ? format(new Date(start + 'T00:00:00'), 'yyyy') : `Q${Math.floor(new Date(start + 'T00:00:00').getMonth() / 3) + 1}`}
            </span>
            <span className="text-[11px] font-medium text-ink-disabled">
              {plural(rows.length)}
            </span>
            <span className="h-px flex-1 bg-line-strong" />
          </div>
          {rows.map((r) => (
            <Fragment key={r.goal.id}>{longCard(r)}</Fragment>
          ))}
        </div>
      )
    })
  }

  // --- check-up flows
  const closeAndReload = () => {
    setCheckingIn(null)
    load()
  }
  let flow: React.ReactNode = null
  if (checkingIn === 'long' && longDue.length > 0) {
    flow = <LongTermCheckin rows={longDue} reviewStart={monthReview.start} categories={categoryById} onClose={() => setCheckingIn(null)} onSaved={closeAndReload} />
  } else if (checkingIn === 'week' || checkingIn === 'month') {
    const rows = checkingIn === 'week' ? weekRows : monthRows
    const review = checkingIn === 'week' ? weekReview : monthReview
    const startDate = new Date(review.start + 'T00:00:00')
    flow = (
      <PeriodCheckup
        periodType={checkingIn}
        title={checkingIn === 'week' ? `Week ${getISOWeek(startDate)} check-up` : `${format(startDate, 'MMMM')} check-up`}
        rows={rows}
        // An earlier answer wins over the guess, so re-opening shows what was saved.
        suggested={new Map(rows.map((r) => [r.goal.id, checkins.get(r.goal.id)?.rating ?? suggestCheckup(r, review.start)]))}
        reviewStart={review.start}
        nextLabel={checkingIn === 'week' ? `week ${getISOWeek(addDays(startDate, 7))}` : format(addMonths(startDate, 1), 'MMMM')}
        categories={categoryById}
        onClose={() => setCheckingIn(null)}
        onSaved={closeAndReload}
      />
    )
  }

  return (
    <Screen title="Goals" onRefresh={load} hero={hero}>
      {tabRows.length > 0 && <ChipRail options={chipOptions} value={label} onChange={setLabel} />}
      {loading ? <p className="text-sm text-ink-disabled">Loading…</p> : tab === 'long' ? longTab() : periodTab(tab)}
      <button onClick={() => setCreating(true)} className="rounded-[20px] border border-line-strong bg-surface py-[13px] text-sm font-semibold text-pine">
        + {tab === 'long' ? 'New long-term goal' : tab === 'month' ? `New goal for ${format(today, 'MMMM')}` : 'New weekly goal'}
      </button>
      {creating && (
        <GoalForm
          tab={tab}
          categories={categories}
          setCategories={setCategories}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
      {flow}
    </Screen>
  )
}
