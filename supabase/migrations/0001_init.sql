-- Core tables for the self-development app.
-- Every table is scoped to auth.uid() via RLS since this is a single-user-per-account app.

create table daily_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null references daily_tasks(id) on delete cascade,
  date date not null,
  completed_at timestamptz not null default now(),
  unique (task_id, date)
);

create table weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  target_value numeric,
  progress numeric not null default 0,
  week_start date not null,
  status text not null default 'active' check (status in ('active', 'done')),
  created_at timestamptz not null default now()
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null default current_date,
  type text not null check (type in ('weight', 'mood', 'note')),
  value_numeric numeric,
  value_text text,
  created_at timestamptz not null default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null,
  time_of_day time not null,
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  enabled boolean not null default true,
  last_sent_at timestamptz
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, subscription)
);

-- Row-level security: users can only ever see/modify their own rows.
alter table daily_tasks enable row level security;
alter table task_completions enable row level security;
alter table weekly_goals enable row level security;
alter table journal_entries enable row level security;
alter table reminders enable row level security;
alter table push_subscriptions enable row level security;

create policy "own rows only" on daily_tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on task_completions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on weekly_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on reminders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
