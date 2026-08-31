-- Optional "standard portion" per ingredient — a familiar unit (tbsp, banana, scoop) with
-- its gram equivalent, so logging a regular item doesn't mean typing an exact gram count
-- every time. Purely a UI shortcut: food_log_entries and recipe_ingredients still store
-- grams as the actual unit, this just prefills/quick-fills that number.

alter table ingredients add column portion_label text;
alter table ingredients add column portion_grams numeric;
