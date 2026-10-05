-- Journal → Check-in: an evening 1–10 rating of the day across six fixed categories plus
-- an optional short note. One row per day (upserted, so re-saving edits the same night).
-- Scores are nullable individually — skipping one category shouldn't block saving.
create table daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  mood smallint check (mood between 1 and 10),
  energy smallint check (energy between 1 and 10),
  calm smallint check (calm between 1 and 10),
  focus smallint check (focus between 1 and 10),
  connection smallint check (connection between 1 and 10),
  body smallint check (body between 1 and 10),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table daily_checkins enable row level security;

create policy "own rows only" on daily_checkins for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
