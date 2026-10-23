-- Finance → Budget: transactions imported from Nordea's CSV export (no bank API — PSD2
-- needs a licensed aggregator). Negative amount = money out. `import_key` makes re-importing
-- an overlapping export a no-op (upsert ignoreDuplicates on the unique constraint).
create table bank_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  amount numeric not null,
  description text not null,
  category text not null,
  import_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, import_key)
);

create index bank_transactions_user_date on bank_transactions (user_id, date);

alter table bank_transactions enable row level security;

create policy "own rows only" on bank_transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
