-- Finance → Budget: two numbers that split bank rows into the savings tab's accounts.
-- Per pay period the first `budget_buffer_per_month` kr into savings (Avanza) is buffer, the
-- rest ETF & stocks; of each mortgage payment the first `mortgage_amortization_per_month` kr
-- is amortization (saved), the rest interest (a fixed cost).
alter table user_settings
  add column budget_buffer_per_month numeric not null default 0,
  add column mortgage_amortization_per_month numeric not null default 0;
