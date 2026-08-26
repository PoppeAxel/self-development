-- Meal categorization (breakfast/lunch/dinner/snack) for recipes (a default tag, used to
-- prefill logging) and food_log_entries (the actual meal a day's entry was eaten at,
-- which can differ from the recipe's default — e.g. dinner leftovers eaten as lunch).
-- Nullable on both: existing rows and ingredient-only log entries aren't required to have one.

alter table recipes add column meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'));
alter table food_log_entries add column meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack'));
