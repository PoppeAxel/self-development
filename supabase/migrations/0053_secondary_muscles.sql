-- An exercise can hit several secondary muscles (bench: chest primary, shoulders and triceps
-- secondary), so the single secondary_muscle becomes a list. Existing tags are copied over.
-- secondary_muscle stays for now as a mirror of the first entry, which the app keeps writing,
-- so an older cached PWA still reads something sensible; drop it once no client uses it.
alter table exercises add column secondary_muscles text[] not null default '{}';

update exercises set secondary_muscles = array[secondary_muscle]
where secondary_muscle is not null and secondary_muscles = '{}';
