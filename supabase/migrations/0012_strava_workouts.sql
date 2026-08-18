-- Strava integration: OAuth token storage + synced workouts. A workout has more shape
-- than a single journal_entries row (sport type, duration, distance, ...), so this gets
-- its own table rather than folding into journal_entries like steps/sleep did.

create table strava_tokens (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  strava_id bigint not null,
  sport_type text not null,
  name text not null,
  date date not null,
  duration_seconds int not null,
  distance_meters numeric,
  calories int,
  created_at timestamptz not null default now(),
  unique (user_id, strava_id)
);

alter table strava_tokens enable row level security;
alter table workouts enable row level security;

create policy "own rows only" on strava_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on workouts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
