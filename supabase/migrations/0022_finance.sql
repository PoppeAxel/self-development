-- Manual weekly finance tracking: total value + deposits/withdrawals per portfolio,
-- updated by hand (no brokerage API integration — Avanza has no official public API).
-- Purely a rough trend tool, same philosophy as food tracking (see CONTEXT.md).

create table portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per portfolio per logged date. `contribution` is the net deposit(+)/
-- withdrawal(-) since the previous entry for that portfolio — used to separate actual
-- market growth from money added or removed when computing week-over-week change.
create table portfolio_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  portfolio_id uuid not null references portfolios(id) on delete cascade,
  date date not null,
  total_value numeric not null,
  contribution numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (portfolio_id, date)
);

alter table portfolios enable row level security;
alter table portfolio_entries enable row level security;

create policy "own rows only" on portfolios for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on portfolio_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
