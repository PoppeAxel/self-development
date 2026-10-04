-- Journal → Media: books, games, movies and series Pontus has finished, with a 1–5 rating
-- and an optional short review. One row per thing finished. Goals can count them
-- (auto_metric 'books_finished' etc. — see MEDIA_METRICS in src/lib/goals.ts).
create table media_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('book', 'game', 'movie', 'series')),
  rating smallint check (rating between 1 and 5),
  review text,
  finished_on date not null,
  created_at timestamptz not null default now()
);

alter table media_entries enable row level security;

create policy "own rows only" on media_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
