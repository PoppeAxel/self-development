-- Journal → Finance: what Pontus moves into savings, logged by hand (there's no bank/Avanza
-- API — that's why the old portfolio-value Finance tab was dropped). One row per amount per
-- account; a withdrawal is a negative amount. A goal with auto_metric 'savings' sums these
-- over its period.
create table savings_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  account text not null check (account in ('buffer', 'mortgage', 'investments')),
  amount numeric not null check (amount <> 0),
  note text,
  created_at timestamptz not null default now()
);

alter table savings_entries enable row level security;

create policy "own rows only" on savings_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
