import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { addDays, differenceInCalendarDays, format, getISOWeek, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { todayISO, weekStartISO } from '../lib/dates'
import { goalPace, sessionMetricValue } from '../lib/goals'
import { TRACKED_LIFTS, liftTrendPerWeek, recentAverage } from '../lib/exercises'
import { formatWorkoutDistance, formatWorkoutDuration, getSportStyle, isStrengthWorkout } from '../lib/workouts'
import {
  autoLinks,
  formatPace,
  formatSets,
  liftPoints,
  nextProgram,
  paceTrend,
  paceTrendLabel,
  planCaption,
  regionBalance,
  weekStrip,
  SET_TARGET,
} from '../lib/training'
import { THEME } from '../lib/theme'
import { Screen, HeroChip } from './Screen'
import { GymPrograms, type GymProgramsHandle } from './GymPrograms'
import { LiveSession, newLiveState, savedLiveState, SectionLabel, type LiveState } from './LiveSession'
import { ConfirmDialog } from './ConfirmDialog'
import type { Exercise, Goal, GymProgram, GymProgramExercise, GymSession, GymSessionSet, Workout } from '../lib/types'

// Journal's Training tab: Cardio + Strength merged (design 1b). Renders its own Screen so
// it can own its data; Journal hands over its segment pills for the hero.

const STRENGTH = { ink: '#8a6321', light: '#c9a55a', tint: '#f3ead6', bar: '#e0cf9a' }
const CARDIO = { run: '#a8563f', light: '#e6b39f', tint: '#f6ebe4', ink: '#8a4630' }
const GOOD_INK = '#1f6b5c'
const FALLING = '#9c4a36'

type SessionRow = GymSession & { gym_session_sets: GymSessionSet[] }

const liftLabel = (name: string) => (name.startsWith('Military press') ? 'Overhead press' : name)
const sportColor = (sport: string) => (sport === 'Run' ? CARDIO.run : sport.includes('Ride') ? CARDIO.light : getSportStyle(sport).color)
// Run sits at the bottom of a stacked bar, rides above it, everything else on top.
const sportRank = (sport: string) => (sport === 'Run' ? 0 : sport.includes('Ride') ? 1 : 2)

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values)
  const range = Math.max(...values) - min || 1
  const points = values
    .map((v, i) => `${values.length === 1 ? 50 : (i / (values.length - 1)) * 100},${28 - ((v - min) / range) * 24}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-[26px] w-[84px] shrink-0">
      <polyline points={points} fill="none" stroke={STRENGTH.ink} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function PlanRow({ title, actual, target, unit, fill, caption, dayFraction }: {
  title: string
  actual: number
  target: number | null
  unit: string
  fill: string
  caption: string | null
  dayFraction: number
}) {
  const shown = unit === 'km' ? actual.toFixed(1) : String(actual)
  if (target == null) {
    return (
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[13px]">
          <strong className="text-lg font-semibold">{shown}</strong> <span className="text-white/75">{unit} this week</span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[13px]">
          <strong className="text-lg font-semibold">{shown}</strong>{' '}
          <span className="text-white/75">
            of {target} {unit}
          </span>
        </span>
      </div>
      <span className="relative h-2 rounded-full bg-white/18">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (actual / target) * 100)}%`, background: fill }} />
        <span className="absolute -top-[3px] -bottom-[3px] w-0.5 rounded-sm bg-white" style={{ left: `${dayFraction * 100}%` }} />
      </span>
      {caption && <span className="text-[10px] text-white/72">{caption}</span>}
    </div>
  )
}

export function Training({ segments }: { segments: React.ReactNode }) {
  const [programs, setPrograms] = useState<GymProgram[]>([])
  const [exercisesByProgram, setExercisesByProgram] = useState<Map<string, GymProgramExercise[]>>(new Map())
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [sessions, setSessions] = useState<GymSession[]>([])
  const [sets, setSets] = useState<GymSessionSet[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState<LiveState | null>(() => savedLiveState())
  const [otherOpen, setOtherOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [liftOpen, setLiftOpen] = useState<string | null>(null)
  const [linkingSessionId, setLinkingSessionId] = useState<string | null>(null)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<GymSession | null>(null)
  const [confirmDeleteWorkout, setConfirmDeleteWorkout] = useState<Workout | null>(null)
  const gymRef = useRef<GymProgramsHandle>(null)

  const today = todayISO()
  const weekStart = weekStartISO()

  async function load() {
    const [{ data: programRows }, { data: programExerciseRows }, { data: exerciseRows }, { data: sessionRows }, { data: workoutRows }, { data: goalRows }] =
      await Promise.all([
        supabase.from('gym_programs').select('*').order('created_at'),
        supabase.from('gym_program_exercises').select('*').order('position'),
        supabase.from('exercises').select('*').order('name'),
        supabase
          .from('gym_sessions')
          .select('*, gym_session_sets(*)')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('workouts').select('*').order('date', { ascending: false }).limit(400),
        supabase.from('goals').select('*').eq('period_type', 'week').eq('period_start', weekStart).in('auto_metric', ['strength_sessions', 'cardio_km']),
      ])
    const byProgram = new Map<string, GymProgramExercise[]>()
    for (const e of (programExerciseRows ?? []) as GymProgramExercise[]) byProgram.set(e.program_id, [...(byProgram.get(e.program_id) ?? []), e])
    const rows = (sessionRows ?? []) as SessionRow[]
    let plain: GymSession[] = rows.map(({ gym_session_sets: _, ...s }) => s)
    const ws = (workoutRows ?? []) as Workout[]

    // Link the obvious ones on every load, so a Strava sync that landed since is picked up.
    const links = autoLinks(plain, ws)
    if (links.length) {
      await Promise.all(links.map((l) => supabase.from('gym_sessions').update({ strava_workout_id: l.workoutId }).eq('id', l.sessionId)))
      const byId = new Map(links.map((l) => [l.sessionId, l.workoutId]))
      plain = plain.map((s) => (byId.has(s.id) ? { ...s, strava_workout_id: byId.get(s.id)! } : s))
    }

    setPrograms(programRows ?? [])
    setExercisesByProgram(byProgram)
    setExercises(exerciseRows ?? [])
    setSessions(plain)
    setSets(rows.flatMap((s) => s.gym_session_sets))
    setWorkouts(ws)
    setGoals((goalRows ?? []) as Goal[])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const setsBySession = new Map<string, GymSessionSet[]>()
  for (const s of sets) setsBySession.set(s.session_id, [...(setsBySession.get(s.session_id) ?? []), s])
  const exerciseByName = new Map(exercises.map((ex) => [ex.name.toLowerCase(), ex]))
  const workoutById = new Map(workouts.map((w) => [w.id, w]))
  const linkedWorkoutIds = new Set(sessions.map((s) => s.strava_workout_id).filter((id): id is string => id != null))

  // --- hero: plan vs actual
  const dayN = differenceInCalendarDays(parseISO(today), parseISO(weekStart)) + 1
  const weekWorkouts = workouts.filter((w) => w.date >= weekStart)
  const strip = weekStrip(weekStart, sessions, sets, workouts, today)
  const weekSets = strip.reduce((sum, d) => sum + (d.strengthSets ?? 0), 0)
  const eightWeeksAgo = format(addDays(parseISO(weekStart), -49), 'yyyy-MM-dd')
  const longestKm = Math.max(
    0,
    ...workouts.filter((w) => w.date >= eightWeeksAgo && !isStrengthWorkout(w.sport_type)).map((w) => (w.distance_meters ?? 0) / 1000),
  )
  const plan = (['strength_sessions', 'cardio_km'] as const).map((metric) => {
    const goal = goals.find((g) => g.auto_metric === metric) ?? null
    const actual = weekWorkouts.reduce((sum, w) => sum + sessionMetricValue(metric, w), 0)
    const target = goal?.target_value ?? null
    const unit = metric === 'cardio_km' ? 'km' : 'sessions'
    const caption = goal && target != null ? planCaption(goalPace(goal, actual), target, actual, unit, longestKm || null) : null
    return { metric, actual, target, unit, caption }
  })

  const next = nextProgram(programs, sessions)

  function start(program: GymProgram) {
    setOtherOpen(false)
    const list = (exercisesByProgram.get(program.id) ?? []).slice().sort((a, b) => a.position - b.position)
    setLive(newLiveState(program, list, sessions, setsBySession))
  }

  // --- lifts, balance, cardio
  const lifts = TRACKED_LIFTS.map((name) => ({ name, points: liftPoints(name, sessions, sets) })).filter((l) => l.points.length > 0)
  const balance = regionBalance(sessions, sets, exerciseByName, today)
  const hasBalance = balance.some((r) => r.perWeek > 0)

  const cardioWindow = workouts.filter((w) => w.date >= eightWeeksAgo && !isStrengthWorkout(w.sport_type))
  const cardioWeeks = Array.from({ length: 8 }, (_, i) => {
    const start = format(addDays(parseISO(weekStart), (i - 7) * 7), 'yyyy-MM-dd')
    const end = format(addDays(parseISO(start), 6), 'yyyy-MM-dd')
    const bySport = new Map<string, number>()
    for (const w of cardioWindow) if (w.date >= start && w.date <= end) bySport.set(w.sport_type, (bySport.get(w.sport_type) ?? 0) + (w.distance_meters ?? 0) / 1000)
    return { start, bySport, total: [...bySport.values()].reduce((a, b) => a + b, 0) }
  })
  const cardioMax = Math.max(...cardioWeeks.map((w) => w.total), 1)
  const sportCounts = new Map<string, number>()
  for (const w of cardioWindow) sportCounts.set(w.sport_type, (sportCounts.get(w.sport_type) ?? 0) + 1)
  const sportRows = [...sportCounts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([sport]) => ({ sport, trend: paceTrend(workouts, sport, today) }))
    .filter((r): r is { sport: string; trend: NonNullable<typeof r.trend> } => r.trend != null)
    .sort((a, b) => sportRank(a.sport) - sportRank(b.sport))

  // --- history
  const history = [
    ...sessions.map((s) => ({ kind: 'session' as const, date: s.date, session: s })),
    ...workouts.filter((w) => !linkedWorkoutIds.has(w.id)).map((w) => ({ kind: 'workout' as const, date: w.date, workout: w })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  async function deleteSession(session: GymSession) {
    setSessions((ss) => ss.filter((s) => s.id !== session.id))
    await supabase.from('gym_sessions').delete().eq('id', session.id)
  }

  async function removeWorkout(workout: Workout) {
    setWorkouts((ws) => ws.filter((w) => w.id !== workout.id))
    await supabase.from('workouts').delete().eq('id', workout.id)
  }

  async function setLink(session: GymSession, workoutId: string | null) {
    setSessions((ss) => ss.map((s) => (s.id === session.id ? { ...s, strava_workout_id: workoutId } : s)))
    setLinkingSessionId(null)
    await supabase.from('gym_sessions').update({ strava_workout_id: workoutId }).eq('id', session.id)
  }

  const hero = (
    <>
      {segments}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.07em] text-white/72">
          WEEK {getISOWeek(parseISO(today))} · DAY {dayN} OF 7
        </span>
        <HeroChip>
          {weekSets} set{weekSets === 1 ? '' : 's'}
        </HeroChip>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {plan.map((p) => (
          <PlanRow
            key={p.metric}
            title={p.metric === 'cardio_km' ? 'Cardio' : 'Strength'}
            actual={p.actual}
            target={p.target}
            unit={p.unit}
            fill={p.metric === 'cardio_km' ? CARDIO.light : STRENGTH.bar}
            caption={p.caption}
            dayFraction={dayN / 7}
          />
        ))}
      </div>
    </>
  )

  const liftForSheet = lifts.find((l) => l.name === liftOpen)

  return (
    <Screen title="Journal" onRefresh={load} hero={hero}>
      {/* 1 · week strip */}
      <div className="grid grid-cols-7 gap-[5px]">
        {strip.map((d) => (
          <div
            key={d.date}
            className={`flex flex-col items-center gap-1 rounded-[14px] pt-[7px] pb-2 ${d.isFuture ? '' : 'bg-surface'} ${
              d.isToday ? 'border-[1.5px] border-pine' : d.isFuture ? '' : 'border border-line'
            }`}
          >
            <span className={`text-[10px] ${d.isToday ? 'font-semibold text-pine' : d.isFuture ? 'font-medium text-[#b3ac9d]' : 'font-medium text-ink-muted'}`}>
              {format(parseISO(d.date), 'EEEEE')}
            </span>
            {d.strengthSets != null && (
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] text-[10px] font-semibold text-white" style={{ background: STRENGTH.ink }}>
                {d.strengthSets}
              </span>
            )}
            {d.cardioKm != null && (
              <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[10px] font-semibold" style={{ background: CARDIO.tint, color: CARDIO.ink }}>
                {d.cardioKm.toFixed(1)}
              </span>
            )}
            {d.strengthSets == null && d.cardioKm == null && (
              <span className={`h-[22px] w-[22px] rounded-[7px] ${d.isToday ? 'border-[1.5px] border-dashed border-ink-faint' : ''}`} />
            )}
          </div>
        ))}
      </div>
      <div className="-mt-1.5 flex gap-3.5 text-[10px] text-ink-muted">
        <span className="flex items-center gap-[5px]">
          <span className="h-2 w-2 rounded-[3px]" style={{ background: STRENGTH.ink }} />
          strength · sets
        </span>
        <span className="flex items-center gap-[5px]">
          <span className="h-2 w-2 rounded-full" style={{ background: CARDIO.light }} />
          cardio · km
        </span>
      </div>

      {/* 2 · start row */}
      <div className="relative flex gap-2">
        {next ? (
          <button
            onClick={() => start(next)}
            className="flex flex-1 items-center justify-center gap-2 rounded-[18px] bg-pine py-3 text-[13px] font-semibold text-white shadow-[0_6px_16px_rgba(47,107,90,.28)]"
          >
            ▶ Start {next.name}
          </button>
        ) : (
          <button
            onClick={() => gymRef.current?.newProgram()}
            className="flex-1 rounded-[18px] bg-pine py-3 text-[13px] font-semibold text-white"
            disabled={loading}
          >
            + New program
          </button>
        )}
        <button
          onClick={() => setOtherOpen((o) => !o)}
          className="rounded-[18px] border border-line bg-surface px-3.5 py-3 text-xs font-medium text-ink-2"
        >
          Other ⌄
        </button>
        {otherOpen && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOtherOpen(false)} />
            <div className="absolute top-full right-0 z-20 mt-1.5 flex w-56 flex-col rounded-[18px] border border-line bg-surface py-1.5 shadow-card">
              {programs.map((p) => (
                <button key={p.id} onClick={() => start(p)} className="px-4 py-2.5 text-left text-sm text-ink">
                  ▶ {p.name}
                </button>
              ))}
              {programs.length > 0 && <span className="my-1 h-px bg-line" />}
              <button
                onClick={() => {
                  setOtherOpen(false)
                  gymRef.current?.newProgram()
                }}
                className="px-4 py-2.5 text-left text-sm font-medium text-pine"
              >
                + New program
              </button>
              <button
                onClick={() => {
                  setOtherOpen(false)
                  gymRef.current?.editPrograms()
                }}
                className="px-4 py-2.5 text-left text-sm text-ink-2"
              >
                Edit programs
              </button>
            </div>
          </>
        )}
      </div>

      {/* 3 · lifts */}
      <SectionLabel>LIFTS · e1RM, AVG LAST 3</SectionLabel>
      {lifts.length === 0 ? (
        <p className="-mt-1 text-sm text-ink-disabled">Log squat, bench, deadlift or overhead press with weight and reps to see them here.</p>
      ) : (
        <div className="-mt-1 flex flex-col rounded-[20px] border border-line bg-surface shadow-card">
          {lifts.map(({ name, points }, i) => {
            const trend = liftTrendPerWeek(points)
            const trendText =
              trend == null
                ? { text: `${points.length} session${points.length === 1 ? '' : 's'}`, color: THEME.inkMuted }
                : Math.abs(trend) < 0.05
                  ? { text: '→ holding', color: THEME.inkMuted }
                  : trend > 0
                    ? { text: `↗ ${trend.toFixed(1)} kg/wk`, color: GOOD_INK }
                    : { text: `↘ ${Math.abs(trend).toFixed(1)} kg/wk`, color: FALLING }
            return (
              <button
                key={name}
                onClick={() => setLiftOpen(name)}
                className={`flex items-center gap-3 px-3.5 py-3 text-left ${i > 0 ? 'border-t border-[#efe9dd]' : ''}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-semibold text-ink">{liftLabel(name)}</span>
                  <span className="text-[10px] font-semibold" style={{ color: trendText.color }}>
                    {trendText.text}
                  </span>
                </span>
                <Sparkline values={points.map((p) => p.e1rm)} />
                <span className="w-[62px] shrink-0 text-right text-[15px] font-semibold text-ink">{recentAverage(points, 3).toFixed(1)}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 4 · muscle balance */}
      <SectionLabel>
        MUSCLE BALANCE · TARGET {SET_TARGET.min}–{SET_TARGET.max}
      </SectionLabel>
      {!hasBalance ? (
        <p className="-mt-1 text-sm text-ink-disabled">Tag exercises with muscles in the program editor to see your balance.</p>
      ) : (
        <>
          <div className="-mt-1 grid grid-cols-3 gap-2">
            {balance.map((r) => {
              const inRange = r.status === 'in'
              return (
                <div key={r.region} className="flex flex-col gap-0.5 rounded-2xl px-[11px] py-2.5" style={{ background: inRange ? '#e3efe9' : STRENGTH.tint }}>
                  <span className="text-[11px] font-medium" style={{ color: inRange ? '#26584a' : '#6d4e1a' }}>
                    {r.region}
                  </span>
                  <span className="text-lg font-semibold" style={{ color: inRange ? '#1f4f43' : '#5c4216' }}>
                    {formatSets(r.perWeek)}
                  </span>
                  <span className="text-[9px] font-semibold" style={{ color: inRange ? THEME.pine : STRENGTH.ink }}>
                    {inRange
                      ? 'IN RANGE'
                      : r.status === 'under'
                        ? `${formatSets(SET_TARGET.min - r.perWeek)} UNDER`
                        : `${formatSets(r.perWeek - SET_TARGET.max)} OVER`}
                  </span>
                </div>
              )
            })}
          </div>
          <span className="-mt-1.5 text-[10px] text-ink-muted">Sets per week, 4-week average. Secondary muscles count as half a set.</span>
        </>
      )}

      {/* 5 · cardio */}
      {cardioWindow.length > 0 && (
        <>
          <SectionLabel>CARDIO</SectionLabel>
          <div className="-mt-1 flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-3.5">
            <div className="flex h-16 items-end gap-1.5">
              {cardioWeeks.map((w, i) => (
                <span
                  key={w.start}
                  className="flex h-full flex-1 flex-col-reverse gap-0.5"
                  style={{ opacity: i === cardioWeeks.length - 1 ? 0.55 : 1 }}
                  title={`${format(parseISO(w.start), 'd MMM')}: ${w.total.toFixed(1)} km`}
                >
                  {[...w.bySport.entries()]
                    .sort(([a], [b]) => sportRank(a) - sportRank(b))
                    .map(([sport, km]) => (
                      <span key={sport} className="rounded-[4px]" style={{ height: `${(km / cardioMax) * 100}%`, background: sportColor(sport) }} />
                    ))}
                </span>
              ))}
            </div>
            <div className="-mt-1.5 flex justify-between text-[10px] text-ink-muted">
              <span>8 wks ago</span>
              <span>this wk</span>
            </div>
            {sportRows.length > 0 && (
              <>
                <div className="h-px bg-[#efe9dd]" />
                {sportRows.map(({ sport, trend }) => {
                  const label = paceTrendLabel(trend)
                  return (
                    <div key={sport} className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: sportColor(sport) }} />
                      <span className="flex-1 text-[13px] font-medium text-ink">{getSportStyle(sport).label}</span>
                      <span className="text-[13px] font-semibold text-ink">{formatPace(trend)}</span>
                      <span
                        className="w-[84px] text-right text-[10px] font-semibold"
                        style={{ color: label?.tone === 'good' ? GOOD_INK : label?.tone === 'bad' ? FALLING : THEME.inkMuted }}
                      >
                        {label?.text ?? ''}
                      </span>
                    </div>
                  )
                })}
                <span className="-mt-1 text-[10px] text-ink-muted">Pace trend over 8 weeks · per sport</span>
              </>
            )}
          </div>
        </>
      )}

      {/* 6 · history */}
      <button onClick={() => setHistoryOpen(true)} className="self-center pb-4 text-xs font-medium text-pine">
        History · all sessions ›
      </button>

      {liftForSheet && (
        <div className="fixed inset-0 z-50 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">{liftLabel(liftForSheet.name)} · e1RM</h2>
            <button onClick={() => setLiftOpen(null)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <div className="flex-1 px-2 pt-4 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={liftForSheet.points} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={THEME.chartGrid} />
                <XAxis dataKey="date" stroke={THEME.inkMuted} fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis stroke={THEME.inkMuted} fontSize={10} domain={['dataMin - 5', 'dataMax + 5']} width={36} />
                <Tooltip
                  contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.line}`, fontSize: 12, borderRadius: 12, color: THEME.ink }}
                  formatter={(value) => [`${value} kg`, 'e1RM']}
                />
                <Line type="monotone" dataKey="e1rm" stroke={STRENGTH.ink} strokeWidth={2.5} dot={{ r: 3, fill: STRENGTH.ink }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-page safe-top safe-bottom">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 className="text-lg font-bold text-ink">History</h2>
            <button onClick={() => setHistoryOpen(false)} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
              Close ✕
            </button>
          </div>
          <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {history.length === 0 && <p className="text-sm text-ink-disabled">Nothing logged or synced yet.</p>}
            {history.map((item) => {
              if (item.kind === 'workout') {
                const w = item.workout
                const distance = formatWorkoutDistance(w.distance_meters)
                const strength = isStrengthWorkout(w.sport_type)
                return (
                  <li key={w.id} className="flex items-center justify-between rounded-[20px] border border-line bg-surface px-4 py-3 text-sm shadow-card">
                    <span className="text-ink-disabled">{w.date}</span>
                    <span className="flex-1 px-3">
                      <span className="font-medium text-ink">{w.name}</span>
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          strength ? 'bg-cat-amber-tint text-cat-amber-ink' : 'bg-cat-pink-tint text-cat-pink-ink'
                        }`}
                      >
                        {w.sport_type}
                      </span>
                      <span className="block text-[11px] text-ink-disabled">
                        {formatWorkoutDuration(w.duration_seconds)}
                        {distance && ` · ${distance}`}
                        {w.calories != null && ` · ${w.calories} cal`}
                      </span>
                    </span>
                    <button onClick={() => setConfirmDeleteWorkout(w)} className="text-ink-faint" aria-label="Remove workout">
                      ✕
                    </button>
                  </li>
                )
              }
              const session = item.session
              const byExercise = new Map<string, GymSessionSet[]>()
              for (const s of setsBySession.get(session.id) ?? []) byExercise.set(s.exercise_name, [...(byExercise.get(s.exercise_name) ?? []), s])
              const linked = session.strava_workout_id ? workoutById.get(session.strava_workout_id) : null
              return (
                <li key={session.id} className="rounded-[20px] border border-line bg-surface px-4 py-3 shadow-card">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">{session.program_name ?? 'Session'}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-disabled">{session.date}</span>
                      <button onClick={() => gymRef.current?.editSession(session)} className="text-ink-faint" aria-label="Edit session">
                        ✎
                      </button>
                      <button onClick={() => setConfirmDeleteSession(session)} className="text-ink-faint" aria-label="Remove session">
                        ✕
                      </button>
                    </div>
                  </div>
                  {[...byExercise.entries()].map(([name, exSets]) => (
                    <p key={name} className="mt-1 text-[11px] text-ink-3">
                      <span className="font-medium text-ink-2">{name}:</span>{' '}
                      {exSets
                        .sort((a, b) => a.set_number - b.set_number)
                        .map((s) => (s.reps != null && s.weight != null ? `${s.reps}@${s.weight}kg` : s.reps != null ? `${s.reps} reps` : s.weight != null ? `${s.weight}kg` : '—'))
                        .join(', ')}
                    </p>
                  ))}
                  {session.strava_workout_id ? (
                    <div className="mt-2 flex items-center justify-between rounded-xl bg-cat-amber-tint px-2.5 py-1.5">
                      <span className="text-[11px] text-cat-amber-ink">
                        🔗 {linked ? `${linked.name} · ${formatWorkoutDuration(linked.duration_seconds)}` : 'Linked'}
                      </span>
                      <button onClick={() => setLink(session, null)} className="text-[11px] font-medium text-ink-disabled">
                        Unlink
                      </button>
                    </div>
                  ) : linkingSessionId === session.id ? (
                    (() => {
                      const candidates = workouts
                        .filter((w) => isStrengthWorkout(w.sport_type) && !linkedWorkoutIds.has(w.id))
                        .sort(
                          (a, b) =>
                            Math.abs(parseISO(a.date).getTime() - parseISO(session.date).getTime()) -
                            Math.abs(parseISO(b.date).getTime() - parseISO(session.date).getTime()),
                        )
                        .slice(0, 5)
                      return (
                        <div className="mt-2 flex flex-col gap-1 rounded-xl bg-track p-2">
                          {candidates.length === 0 ? (
                            <p className="text-[11px] text-ink-disabled">No unlinked Strava workouts found yet.</p>
                          ) : (
                            candidates.map((w) => (
                              <button
                                key={w.id}
                                onClick={() => setLink(session, w.id)}
                                className="rounded-lg bg-surface px-2 py-1.5 text-left text-[11px] text-ink-2 shadow-card"
                              >
                                {w.date} · {w.name} · {formatWorkoutDuration(w.duration_seconds)}
                              </button>
                            ))
                          )}
                          <button onClick={() => setLinkingSessionId(null)} className="text-left text-[11px] font-medium text-ink-disabled">
                            Cancel
                          </button>
                        </div>
                      )
                    })()
                  ) : (
                    <button onClick={() => setLinkingSessionId(session.id)} className="mt-2 text-[11px] font-medium text-cat-rose-ink">
                      Link to Strava workout
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <GymPrograms
        ref={gymRef}
        programs={programs}
        exercisesByProgram={exercisesByProgram}
        exercises={exercises}
        sessions={sessions}
        setsBySession={setsBySession}
        onChanged={load}
      />

      {live && (
        <LiveSession
          initial={live}
          catalog={exercises}
          sessions={sessions}
          setsBySession={setsBySession}
          allSets={sets}
          sessionsThisWeek={sessions.filter((s) => s.date >= weekStart && s.id !== live.sessionId).length}
          onClose={() => {
            setLive(null)
            load()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteSession !== null}
        title="Remove this session?"
        message="This deletes the logged sets for this session. It can't be undone."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteSession) deleteSession(confirmDeleteSession)
          setConfirmDeleteSession(null)
        }}
        onCancel={() => setConfirmDeleteSession(null)}
      />
      <ConfirmDialog
        open={confirmDeleteWorkout !== null}
        title={`Remove "${confirmDeleteWorkout?.name ?? ''}"?`}
        message="This removes the synced Strava workout from your log."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmDeleteWorkout) removeWorkout(confirmDeleteWorkout)
          setConfirmDeleteWorkout(null)
        }}
        onCancel={() => setConfirmDeleteWorkout(null)}
      />
    </Screen>
  )
}
