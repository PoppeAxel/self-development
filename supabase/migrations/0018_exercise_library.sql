-- A catalog of strength exercises tagged by primary/secondary muscle group, shared
-- across all gym programs. A program's exercise row still stores its own `name` (for
-- display and history, same reasoning as gym_sessions.program_name being a snapshot),
-- but can optionally link to a catalog entry for its muscle-group metadata and to let
-- the UI offer same-muscle-group substitutes when swapping an exercise in a program.

create table exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  primary_muscle text,
  secondary_muscle text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table gym_program_exercises add column exercise_id uuid references exercises(id) on delete set null;

alter table exercises enable row level security;
create policy "own rows only" on exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
