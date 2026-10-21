-- Daily macro targets for the Food tab's protein / carbs / fat overview. Grams per day,
-- each optional on its own — the overview shows plain grams for any left unset.
alter table user_settings
  add column protein_goal numeric,
  add column carbs_goal numeric,
  add column fat_goal numeric;
