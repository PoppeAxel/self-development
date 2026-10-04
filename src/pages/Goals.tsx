import { Fragment, useEffect, useState } from 'react'
import { addDays, addMonths, differenceInCalendarDays, format, getISOWeek } from 'date-fns'
import { supabase } from '../lib/supabase'
import { periodEndISO, periodStartISO } from '../lib/dates'
import { goalPace, goalSource, goalStyle, isGoalDone, loadMilestoneResults, resolveGoalProgress, rolloverRecurringGoals } from '../lib/goals'
import { coversMonth, formatGoalValue, historyDots, milestoneState, reviewPeriod, suggestRating } from '../lib/checkins'
import { useNav } from '../contexts/NavContext'
import { ChipRail, HeroSegments, Screen } from '../components/Screen'
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
      supabase.from('categories').select('*').order('name'),
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

  // ------------------------------------------------------------------ long-term cards (3a)
  function longCard(row: GoalRow) {
    const { goal, progress, pace, done } = row
    const style = goalStyle(goal, categoryById)
    const labelName = goal.category_id ? (categoryById.get(goal.category_id)?.name ?? 'General') : 'General'
    const edge = <span className="w-[5px] shrink-0 self-stretch" style={{ background: style.accent }} />

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

  // ------------------------------------------------------------------ week / month rows (3b)
  function periodRow(row: GoalRow, last: boolean) {
    const { goal, progress, done } = row
    const style = goalStyle(goal, categoryById)
    const series = all.filter((g) => g.series_id === goal.series_id && g.period_type === goal.period_type)
    const dots = historyDots(series, checkins, goal.period_start)
    let control: React.ReactNode
    if (goal.target_value == null) control = <Circle done={done} color={style.check} onClick={() => toggleDone(goal)} size={28} />
    else if (goal.auto_metric)
      control = (
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold" style={{ color: style.ink }}>
            {goal.kind === 'milestone'
              ? `${row.results.length ? formatGoalValue(goal, progress) : '—'} / ${formatGoalValue(goal, goal.target_value)}`
              : `${fmt(progress)} / ${fmt(goal.target_value)}`}
          </span>
          <span className="block text-[9px] font-medium text-ink-muted">{goalSource(goal)}</span>
        </span>
      )
    else
      control = (
        <span className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => bump(goal, -1)} aria-label="Less" className="flex h-7 w-7 items-center justify-center rounded-full bg-[#efe9dc] font-semibold text-ink-3">
            −
          </button>
          <span className="text-sm font-semibold" style={{ color: style.ink }}>
            {fmt(progress)}/{fmt(goal.target_value)}
          </span>
          <button onClick={() => bump(goal, 1)} aria-label="More" className="flex h-7 w-7 items-center justify-center rounded-full font-semibold text-white" style={{ background: style.check }}>
            +
          </button>
        </span>
      )
    return (
      <Fragment key={goal.id}>
        <div onClick={() => openGoalDetail(goal.id)} className={`flex cursor-pointer items-center gap-3 px-[15px] ${last ? 'pt-[9px] pb-3' : 'py-[9px]'}`}>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${done ? 'text-ink-disabled line-through' : 'text-ink'}`}>{goal.title}</p>
            {dots.length > 0 && (
              <div className="mt-1.5 flex gap-[3px]">
                {dots.map((d, i) => (
                  <span key={i} className="h-2 w-2 rounded-[3px]" style={d === 'missed' ? { background: MISSED } : { background: style.accent, opacity: DOT[d] }} />
                ))}
              </div>
            )}
          </div>
          {control}
        </div>
        {!last && <span className="mx-[15px] block h-px bg-line" />}
      </Fragment>
    )
  }

  function periodTab(periodType: 'week' | 'month') {
    const start = current[periodType]
    const left = daysLeft(periodType, start)
    const groups = [...categories.map((c) => c.id), 'none']
      .map((key) => ({ key, rows: visible.filter((r) => labelKey(r.goal) === key) }))
      .filter((g) => g.rows.length > 0)
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-3">
            {periodType === 'week'
              ? `${format(new Date(start + 'T00:00:00'), 'd MMM')} – ${format(new Date(periodEndISO('week', start) + 'T00:00:00'), 'd MMM')}`
              : format(new Date(start + 'T00:00:00'), 'MMMM')}{' '}
            · {left === 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`}
          </span>
          <span className="flex shrink-0 items-center gap-2.5 text-[10px] font-medium text-ink-muted">
            {(['done', 'partly', 'missed'] as const).map((d) => (
              <span key={d} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-[3px]" style={d === 'missed' ? { background: MISSED } : { background: '#58534a', opacity: DOT[d] }} />
                {d}
              </span>
            ))}
          </span>
        </div>
        {groups.length === 0 && <p className="text-sm text-ink-disabled">No goals for this {periodType} yet.</p>}
        {groups.map(({ key, rows }) => {
          const style = goalStyle({ category_id: key === 'none' ? null : key }, categoryById)
          const name = key === 'none' ? 'GENERAL' : (categoryById.get(key)?.name ?? '').toUpperCase()
          return (
            <div key={key} className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
              <div className="flex items-center gap-[7px] px-[15px] pt-[11px] pb-1">
                <span className="h-2 w-2 rounded-full" style={{ background: style.accent }} />
                <span className="text-[11px] font-semibold tracking-[0.06em]" style={{ color: style.ink }}>
                  {name}
                </span>
              </div>
              {rows.map((r, i) => periodRow(r, i === rows.length - 1))}
            </div>
          )
        })}
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
              {plural(rows.length)} · {daysLeft(p, start)} days left
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
