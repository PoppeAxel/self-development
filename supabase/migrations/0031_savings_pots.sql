-- Journal → Finance → Pots: short-term saving for a specific thing (engagement ring, watch,
-- wardrobe, a trip). Deliberately separate from savings_entries: pot money never counts
-- toward the long-term totals or a 'savings' goal, so buying the ring doesn't dent them.
create table savings_pots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  target_amount numeric not null check (target_amount > 0),
  target_date date,
  -- 'done' = bought/finished; kept for history instead of deleted.
  status text not null default 'active' check (status in ('active', 'done')),
  created_at timestamptz not null default now()
);
alter table savings_pots enable row level security;
create policy "own rows only" on savings_pots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Money in (positive) or taken out (negative) of a pot.
create table pot_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pot_id uuid not null references savings_pots(id) on delete cascade,
  date date not null,
  amount numeric not null check (amount <> 0),
  note text,
  created_at timestamptz not null default now()
);
alter table pot_entries enable row level security;
create policy "own rows only" on pot_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
