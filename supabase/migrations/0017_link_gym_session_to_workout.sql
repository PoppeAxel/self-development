-- Garmin logs to Strava, but the sync isn't instant (runs every 3 hours) — so a gym
-- session logged at the gym often can't be linked to its Strava workout until later, once
-- that workout has actually synced in. Nullable link, filled in after the fact.
alter table gym_sessions add column strava_workout_id uuid references workouts(id) on delete set null;
