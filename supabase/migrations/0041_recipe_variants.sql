-- A recipe can be a variant of another ("Köttfärssås – kyckling" of "Köttfärssås"):
-- duplicated with an ingredient or two swapped, then grouped under the original in the
-- Recipes list. Each variant is still a whole recipe of its own, so logging, macros and
-- usuals need nothing new. Deleting the original leaves its variants as plain recipes.
alter table recipes add column variant_of uuid references recipes(id) on delete set null;
