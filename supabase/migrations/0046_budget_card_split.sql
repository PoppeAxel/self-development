-- Economy: how his Revolut card top-ups are spent, per pay period, e.g.
-- {"groceries": 3000, "fuel_parking": 1500, "shopping": 500} — filled in that order, the rest
-- counts as Other. The card's own purchases never reach the Nordea export, so the top-up row
-- (category 'card') is spread over these subcategories instead.
alter table user_settings add column budget_card_split jsonb not null default '{}'::jsonb;
