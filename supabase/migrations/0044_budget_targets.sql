-- Economy → Budget plan: one monthly target per budget category, e.g. {"groceries": 5000}.
-- A jsonb map rather than a table — it's one small object, always read and written whole.
alter table user_settings add column budget_targets jsonb not null default '{}'::jsonb;
