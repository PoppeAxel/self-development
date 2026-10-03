-- Goals round 8 (design_handoff_goals): labels, goal kinds, check-ups.

-- A goal's colour now comes from one of the user's labels (the same categories table
-- daily_tasks uses) instead of being guessed from what drives it. Null = General style.
alter table goals add column category_id uuid references categories(id) on delete set null;

-- How a year/quarter goal measures itself. 'number' = value vs target against the calendar
-- (the old behaviour, so it's the default for every existing row); 'milestone' = best
-- result so far vs target; 'done' = done or not.
alter table goals add column kind text not null default 'number'
  check (kind in ('number', 'milestone', 'done'));
-- Milestones: where the goal started, whether a smaller result is better (race times,
-- stored as seconds), and optionally the gym exercise whose best weight is the result.
alter table goals add column start_value numeric;
alter table goals add column lower_is_better boolean not null default false;
alter table goals add column source_exercise text;

-- Results entered by hand for milestone goals the app can't read (race times etc).
create table goal_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  date date not null,
  value numeric not null,
  note text,
  created_at timestamptz not null default now()
);
alter table goal_results enable row level security;
create policy "own rows only" on goal_results for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One row per goal per reviewed period, for every horizon. A skipped goal in the monthly
-- check-in is saved with a null rating so the check-in stops being due.
create table goal_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  period_start date not null,
  rating text check (rating in ('done', 'partly', 'missed', 'on_track', 'slipping', 'stuck')),
  note text,
  focus text,
  created_at timestamptz not null default now(),
  unique (goal_id, period_start)
);
alter table goal_checkins enable row level security;
create policy "own rows only" on goal_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The free-text note for a whole week/month check-up (not tied to one goal).
create table goal_checkin_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_type text not null,
  period_start date not null,
  note text not null,
  created_at timestamptz not null default now(),
  unique (user_id, period_type, period_start)
);
alter table goal_checkin_notes enable row level security;
create policy "own rows only" on goal_checkin_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
