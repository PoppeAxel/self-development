-- Fas 2 step 4b: the remaining hardcoded lists move into `options`, seeded with exactly what the
-- app showed up to dbd3510. Rows elsewhere keep storing the same strings, so no data is rewritten.

-- Balance regions (Training → muscle balance) and the muscle groups that roll up into them.
-- A muscle group's `label` is the text exercises.primary_muscle / secondary_muscle store.
insert into options (user_id, kind, key, label, position)
select u.id, 'balance_region', v.key, v.label, v.position
from auth.users u cross join (values
  ('back', 'Back', 0), ('chest', 'Chest', 1), ('shoulders', 'Shoulders', 2), ('arms', 'Arms', 3), ('legs', 'Legs', 4), ('core', 'Core', 5)
) as v(key, label, position);

insert into options (user_id, kind, key, label, position, meta)
select u.id, 'muscle_group', v.key, v.label, v.position, jsonb_build_object('region', v.region)
from auth.users u cross join (values
  ('chest', 'Chest', 'chest', 0), ('triceps', 'Triceps', 'arms', 1), ('shoulders', 'Shoulders', 'shoulders', 2),
  ('upper_back', 'Upper back', 'back', 3), ('lower_back', 'Lower back', 'back', 4), ('biceps', 'Biceps', 'arms', 5),
  ('forearms', 'Forearms', 'arms', 6), ('quads', 'Quads', 'legs', 7), ('hamstrings', 'Hamstrings', 'legs', 8),
  ('glutes', 'Glutes', 'legs', 9), ('calves', 'Calves', 'legs', 10), ('core', 'Core', 'core', 11), ('full_body', 'Full body', 'core', 12)
) as v(key, label, region, position);

-- Lifts tracked on Training: `label` is shown, meta.exercise is matched (case-insensitive) against
-- gym_session_sets.exercise_name.
insert into options (user_id, kind, key, label, position, meta)
select u.id, 'tracked_lift', v.key, v.label, v.position, jsonb_build_object('exercise', v.exercise)
from auth.users u cross join (values
  ('squat', 'Squat', 'Squat', 0), ('bench', 'Bench press', 'Bench press', 1), ('deadlift', 'Deadlift', 'Deadlift', 2),
  ('ohp', 'Overhead press', 'Military press (overhead press)', 3)
) as v(key, label, exercise, position);

-- Strava sport styles: meta.sport_type = Strava's sport_type. Colours are what the cardio chart
-- actually drew (every ride used the light terracotta, whatever SPORT_STYLES said).
insert into options (user_id, kind, key, label, icon, color, position, meta)
select u.id, 'sport_style', v.sport, v.label, v.icon, v.color, v.position, jsonb_build_object('sport_type', v.sport)
from auth.users u cross join (values
  ('Run', 'Run', '👟', '#a8563f', 0), ('TrailRun', 'Trail run', '👟', '#8a4630', 1), ('Ride', 'Ride', '🚴', '#e6b39f', 2),
  ('VirtualRide', 'Virtual ride', '🚴', '#e6b39f', 3), ('MountainBikeRide', 'MTB ride', '🚵', '#e6b39f', 4), ('GravelRide', 'Gravel ride', '🚴', '#e6b39f', 5),
  ('Swim', 'Swim', '🏊', '#3f7f8a', 6), ('Walk', 'Walk', '🚶', '#8b8577', 7), ('Hike', 'Hike', '🥾', '#6f8a3f', 8),
  ('Soccer', 'Football', '⚽', '#2f6b5a', 9), ('AlpineSki', 'Ski', '⛷️', '#6a4f7a', 10), ('Snowboard', 'Snowboard', '🏂', '#5d4470', 11),
  ('Rowing', 'Rowing', '🚣', '#7a5a8a', 12)
) as v(sport, label, icon, color, position);

-- Goal check-up ratings: the ids are pinned by goal_checkins' CHECK and the suggestion logic, so
-- these are system rows — renamable and recolourable, not deletable.
insert into options (user_id, kind, key, label, color, position, system)
select u.id, v.kind, v.key, v.label, v.color, v.position, true
from auth.users u cross join (values
  ('month_rating', 'on_track', 'On track', '#1f6b5c', 0), ('month_rating', 'slipping', 'Slipping', '#8a6321', 1),
  ('month_rating', 'stuck', 'Stuck', '#a33327', 2),
  ('period_rating', 'done', 'Done', null, 0), ('period_rating', 'partly', 'Partly', null, 1), ('period_rating', 'missed', 'Missed', null, 2)
) as v(kind, key, label, color, position);

-- GoalDetail's nudge after the projection sentence: key = the goal's auto_metric.
insert into options (user_id, kind, key, label, position)
select u.id, 'goal_nudge', v.key, v.label, v.position
from auth.users u cross join (values
  ('strength_sessions', 'One more session a week closes the gap.', 0),
  ('cardio_sessions', 'One more session a week closes the gap.', 1),
  ('cardio_minutes', 'One extra session a week closes most of the gap.', 2),
  ('strength_minutes', 'A longer session each week closes most of the gap.', 3),
  ('steps', 'A single longer walk most days covers it.', 4)
) as v(key, label, position);

-- Food's quantity sheet presets: meta.value in servings (recipes) or grams (ingredients).
insert into options (user_id, kind, key, label, position, meta)
select u.id, v.kind, v.key, v.label, v.position, jsonb_build_object('value', v.value)
from auth.users u cross join (values
  ('serving_preset', 's05', '½', 0.5, 0), ('serving_preset', 's1', '1', 1, 1), ('serving_preset', 's15', '1½', 1.5, 2), ('serving_preset', 's2', '2', 2, 3),
  ('gram_preset', 'g50', '50', 50, 0), ('gram_preset', 'g100', '100', 100, 1), ('gram_preset', 'g150', '150', 150, 2), ('gram_preset', 'g200', '200', 200, 3)
) as v(kind, key, label, value, position);

-- Today's quick "when" chips: a one-time to-do `offset` days after the day shown, or a habit
-- repeating on `days` (0 = Sunday; null = every day).
insert into options (user_id, kind, key, label, position, meta)
select u.id, 'quick_when', v.key, v.label, v.position, v.meta::jsonb
from auth.users u cross join (values
  ('today', 'Today', 0, '{"repeat": false, "offset": 0}'),
  ('tomorrow', 'Tomorrow', 1, '{"repeat": false, "offset": 1}'),
  ('daily', 'Every day', 2, '{"repeat": true, "days": null}'),
  ('weekdays', 'Weekdays', 3, '{"repeat": true, "days": [1, 2, 3, 4, 5]}')
) as v(key, label, position, meta);
