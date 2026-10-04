-- Finance → Pots becomes a ranked, categorised shopping list (things Pontus wants to buy,
-- in the order he wants them). Same savings_pots rows: target_amount is now the price,
-- status 'done' means bought. Saving into an item (pot_entries) stays optional.

-- His own categories only — no presets.
create table pot_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table pot_categories enable row level security;
create policy "own rows only" on pot_categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table savings_pots add column category_id uuid references pot_categories(id) on delete set null;
-- Lower rank = higher priority. Moving an item swaps ranks with its neighbour.
alter table savings_pots add column rank integer not null default 0;

-- Existing items keep the order they were created in.
update savings_pots p set rank = r.n
from (select id, row_number() over (partition by user_id order by created_at) as n from savings_pots) r
where p.id = r.id;
