-- Predetermined gym programs: a saved template (flat list of exercises with target
-- sets/reps) that gets "logged" against on a given gym visit — actual reps/weight per set.

create table gym_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table gym_program_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  program_id uuid not null references gym_programs(id) on delete cascade,
  name text not null,
  target_sets int not null default 3,
  target_reps int not null default 10,
  position int not null default 0
);

-- program_id is nullable + set null on delete, and program_name is a snapshot, so a
-- session's history still reads correctly even if its program is later renamed/deleted
-- (same reasoning as reminders.label being stored directly rather than joined).
create table gym_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  program_id uuid references gym_programs(id) on delete set null,
  program_name text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create table gym_session_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references gym_sessions(id) on delete cascade,
  exercise_name text not null,
  set_number int not null,
  reps int,
  weight numeric,
  created_at timestamptz not null default now()
);

alter table gym_programs enable row level security;
alter table gym_program_exercises enable row level security;
alter table gym_sessions enable row level security;
alter table gym_session_sets enable row level security;

create policy "own rows only" on gym_programs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on gym_program_exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on gym_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on gym_session_sets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
