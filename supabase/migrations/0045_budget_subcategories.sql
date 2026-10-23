-- Economy: head categories with subcategories, and the savings buffers split in three.
-- bank_transactions.category now holds subcategory ids (see HEADS in src/lib/budget.ts);
-- existing rows were remapped by a one-off data update, not here.

-- The savings tab tracks a car and a travel buffer next to the main one.
alter table savings_entries drop constraint savings_entries_account_check;
alter table savings_entries add constraint savings_entries_account_check
  check (account in ('buffer', 'car_buffer', 'travel_buffer', 'investments', 'mortgage'));

-- Monthly kr per buffer, e.g. {"buffer": 2500, "car_buffer": 500, "travel_buffer": 1000};
-- the rest of what goes into savings counts as ETF & stocks. Replaces
-- budget_buffer_per_month (0043), which is left in place unused.
alter table user_settings add column budget_savings_split jsonb not null default '{}'::jsonb;
