-- Fas 2 step 5: single values that used to be constants become `options` rows of kind 'setting'
-- (meta {value, min, max, step, unit}), edited in place next to what they drive. Seeded with the
-- exact old values, so nothing behaves differently.
insert into options (user_id, kind, key, label, position, meta)
select u.id, 'setting', v.key, v.label, v.position,
       jsonb_build_object('value', v.value, 'min', v.min, 'max', v.max, 'step', v.step, 'unit', v.unit)
from auth.users u cross join (values
  ('sleep_target_hours', 'Sleep target', 8.0, 4.0, 12.0, 0.5, 'h', 0),
  ('rest_timer_seconds', 'Rest timer', 90.0, 15.0, 600.0, 15.0, 's', 1),
  ('set_target_min', 'Sets a week, low end', 10.0, 0.0, 60.0, 1.0, 'sets', 2),
  ('set_target_max', 'Sets a week, high end', 20.0, 1.0, 80.0, 1.0, 'sets', 3),
  ('kg_step_small', 'Kg step, light', 1.0, 0.25, 10.0, 0.25, 'kg', 4),
  ('kg_step_large', 'Kg step, heavy', 2.5, 0.25, 20.0, 0.25, 'kg', 5),
  ('kg_step_threshold', 'Heavy from', 10.0, 0.0, 200.0, 1.0, 'kg', 6),
  ('checkin_day_starts_hour', 'Check-in day starts at', 4.0, 0.0, 12.0, 1.0, ':00', 7),
  ('payday', 'Payday (day of month)', 22.0, 1.0, 28.0, 1.0, '', 8),
  ('notable_sleep_hours', 'Notable sleep change', 1.0 / 6, 0.05, 3.0, 0.05, 'h', 9),
  ('notable_steps', 'Notable steps change', 400.0, 50.0, 10000.0, 50.0, 'steps', 10),
  ('notable_cardio_km', 'Notable cardio change', 1.5, 0.1, 50.0, 0.1, 'km', 11),
  ('notable_strength_min', 'Notable strength change', 15.0, 1.0, 300.0, 1.0, 'min', 12),
  ('notable_intake_kcal', 'Notable intake change', 150.0, 10.0, 2000.0, 10.0, 'kcal', 13),
  ('min_logged_kcal', 'Fully logged day from', 1000.0, 0.0, 5000.0, 50.0, 'kcal', 14),
  ('min_logged_days', 'Days needed for the estimate', 5.0, 1.0, 28.0, 1.0, 'days', 15)
) as v(key, label, value, min, max, step, unit, position);

-- Step 4a moved check-in scores into `scores` (0050) and the code that wrote the old columns is
-- gone (dbd3510); the final backfill found nothing left to copy.
alter table daily_checkins
  drop column mood, drop column energy, drop column calm, drop column focus, drop column connection, drop column body;
