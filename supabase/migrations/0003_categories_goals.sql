-- Category labels for daily tasks, and weekly-goal recurrence + task linking.

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  color text not null default 'violet'
);

alter table categories enable row level security;
create policy "own rows only" on categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table daily_tasks add column category_id uuid references categories(id) on delete set null;
-- Links a task to a *series* of recurring weekly goals (not a specific week's row) so the
-- link survives the goal being re-instantiated each week. See weekly_goals.series_id below.
alter table daily_tasks add column goal_series_id uuid;

alter table weekly_goals add column series_id uuid not null default gen_random_uuid();
alter table weekly_goals add column recurring boolean not null default false;
