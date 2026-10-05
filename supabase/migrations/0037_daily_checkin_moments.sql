-- Daily check-in diary: a short line Pontus can attach to any moment of the day's timeline
-- (a finished task, a workout, a meal, last night's sleep…). One row per noted moment;
-- clearing the note deletes the row. The diary text itself lives in daily_checkins.note.
-- source_id is '' (not null) for the once-a-day sources (sleep/weight/steps) so the unique
-- key — and with it the client's upsert onConflict — works without NULLS NOT DISTINCT.
-- For food it's the meal type (one moment per meal), otherwise the source row's uuid.
create table daily_checkin_moments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  source text not null check (source in ('task', 'workout', 'gym', 'food', 'sleep', 'weight', 'steps')),
  source_id text not null default '',
  note text not null,
  created_at timestamptz not null default now(),
  unique (user_id, date, source, source_id)
);

alter table daily_checkin_moments enable row level security;

create policy "own rows only" on daily_checkin_moments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
