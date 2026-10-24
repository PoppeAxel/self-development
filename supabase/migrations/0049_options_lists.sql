-- Fas 2 step 3: meal types, ingredient categories, media kinds and savings accounts move from
-- code into `options` (0048), seeded with exactly the values hardcoded up to 34d3e33. Rows
-- elsewhere keep storing the same strings (keys; for ingredient categories the label itself,
-- since ingredients.category has always been free text), so no data is rewritten.

-- The lists are editable now, so the columns can't be pinned to the old four/five values.
alter table recipes drop constraint recipes_meal_type_check;
alter table food_log_entries drop constraint food_log_entries_meal_type_check;
alter table media_entries drop constraint media_entries_kind_check;
alter table savings_entries drop constraint savings_entries_account_check;

-- Meal types: `color` is a palette name (CATEGORY_STYLES); meta.until_hour = the guessed default
-- meal before that hour (src/lib/food.ts defaultMealTypeForNow).
insert into options (user_id, kind, key, label, icon, color, position, meta)
select u.id, 'meal_type', v.key, v.label, v.icon, v.color, v.position, jsonb_build_object('until_hour', v.until_hour)
from auth.users u cross join (values
  ('breakfast', 'Breakfast', '🌅', 'amber', 0, 10),
  ('lunch', 'Lunch', '🥪', 'emerald', 1, 15),
  ('dinner', 'Dinner', '🍽', 'pink', 2, 21),
  ('snack', 'Snack', '🍎', 'violet', 3, 24)
) as v(key, label, icon, color, position, until_hour);

-- Ingredient categories: `label` is the text ingredients.category stores; `color` the row accent,
-- meta.tint the tile behind the glyph.
insert into options (user_id, kind, key, label, icon, color, position, meta)
select u.id, 'ingredient_category', v.key, v.label, v.icon, v.color, v.position, jsonb_build_object('tint', v.tint)
from auth.users u cross join (values
  ('protein', 'Protein', '🥩', '#a8563f', '#f6ebe4', 0),
  ('vegetable', 'Vegetable', '🥦', '#2f6b5a', '#e8efe8', 1),
  ('fruit', 'Fruit', '🍎', '#a8842f', '#f7efdf', 2),
  ('dairy', 'Dairy', '🥛', '#46608f', '#e8edf4', 3),
  ('grains', 'Grains & Carbs', '🍞', '#6a4f7a', '#f1ecf2', 4),
  ('fats', 'Fats & Oils', '🫗', '#8b8577', '#efe9dc', 5),
  ('sauces', 'Sauces & Condiments', '🫙', '#8b8577', '#efe9dc', 6),
  ('spices', 'Spices & Seasoning', '🧂', '#8b8577', '#efe9dc', 7),
  ('sweets', 'Sweets & Snacks', '🍫', '#8b8577', '#efe9dc', 8),
  ('beverages', 'Beverages', '🥤', '#8b8577', '#efe9dc', 9)
) as v(key, label, icon, color, tint, position);

-- Media kinds: meta.plural for "Books" etc. The four keys are also what the Media goal sources
-- (books_finished → 'book', …) count.
insert into options (user_id, kind, key, label, icon, position, meta)
select u.id, 'media_kind', v.key, v.label, v.icon, v.position, jsonb_build_object('plural', v.plural)
from auth.users u cross join (values
  ('book', 'Book', 'Books', '📚', 0),
  ('game', 'Game', 'Games', '🎮', 1),
  ('movie', 'Movie', 'Movies', '🎬', 2),
  ('series', 'Series', 'Series', '📺', 3)
) as v(key, label, plural, icon, position);

-- Savings accounts: meta.buffer = filled, in order, from each pay period's bank savings (the rest
-- goes to investments). investments and mortgage carry budget logic → system.
insert into options (user_id, kind, key, label, icon, color, position, meta, system)
select u.id, 'savings_account', v.key, v.label, v.icon, v.color, v.position, jsonb_build_object('buffer', v.buffer), v.key in ('investments', 'mortgage')
from auth.users u cross join (values
  ('buffer', 'Buffer', '🛟', '#2f6b5a', 0, true),
  ('car_buffer', 'Car buffer', '🚗', '#4f7f8c', 1, true),
  ('travel_buffer', 'Travel buffer', '✈️', '#6a8fb0', 2, true),
  ('investments', 'ETF & stocks', '📈', '#a8842f', 3, false),
  ('mortgage', 'House loan paid', '🏠', '#46608f', 4, false)
) as v(key, label, icon, color, position, buffer);
