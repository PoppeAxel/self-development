-- Calorie/macro tracking: a personal ingredient library (imported from Livsmedelsverket's
-- open food-composition API, or entered manually) built into reusable recipes, logged
-- per day. Purely illustrative — no targets/goals, see CONTEXT.md.

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  source text not null default 'manual', -- 'livsmedelsverket' | 'manual'
  source_ref text, -- Livsmedelsverket's `nummer`, when imported from there
  kcal_per_100g numeric not null,
  protein_per_100g numeric not null default 0,
  carbs_per_100g numeric not null default 0,
  fat_per_100g numeric not null default 0,
  fiber_per_100g numeric not null default 0,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  servings numeric not null default 1,
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  grams numeric not null,
  position int not null default 0
);

-- Logs either a recipe (N servings) or a raw ingredient (N grams) eaten on a given day —
-- exactly one of the two, enforced below. No FK-joined name is stored (unlike gym_sessions'
-- program_name snapshot) since macros are always recomputed live from the current
-- ingredient/recipe data; this is a rough trend tool, not a historical audit log.
create table food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null default current_date,
  recipe_id uuid references recipes(id) on delete cascade,
  servings numeric,
  ingredient_id uuid references ingredients(id) on delete cascade,
  grams numeric,
  created_at timestamptz not null default now(),
  constraint exactly_one_source check (
    (recipe_id is not null and ingredient_id is null and servings is not null and grams is null) or
    (ingredient_id is not null and recipe_id is null and grams is not null and servings is null)
  )
);

alter table ingredients enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table food_log_entries enable row level security;

create policy "own rows only" on ingredients for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on recipes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on recipe_ingredients for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows only" on food_log_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
