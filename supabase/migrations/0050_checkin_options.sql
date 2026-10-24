-- Fas 2 step 4a: the daily check-in's six questions and the diary's prompt chips become `options`
-- rows (edited in place in the check-in), so a check-in's scores can no longer be one fixed column
-- each. `scores` holds {question key: 1–10}; keys are the old column names, so history carries over.
-- The old columns stay until the new code is live (the old code still writes them); a later
-- migration drops them after a final backfill.
alter table daily_checkins add column scores jsonb not null default '{}';

update daily_checkins
set scores = jsonb_strip_nulls(jsonb_build_object('mood', mood, 'energy', energy, 'calm', calm, 'focus', focus, 'connection', connection, 'body', body));

-- meta: the question asked, and the words at each end of the 1–10 slider.
insert into options (user_id, kind, key, label, position, meta)
select u.id, 'checkin_question', v.key, v.label, v.position, jsonb_build_object('question', v.question, 'low', v.low, 'high', v.high)
from auth.users u cross join (values
  ('mood', 'Mood', 'How good did today feel overall?', 'Awful', 'Great', 0),
  ('energy', 'Energy', 'How much energy did you have?', 'Drained', 'Energised', 1),
  ('calm', 'Calm', 'How calm did you feel?', 'Stressed', 'Calm', 2),
  ('focus', 'Focus', 'Did you spend your time on what mattered?', 'Scattered', 'Focused', 3),
  ('connection', 'Connection', 'How connected did you feel to others?', 'Lonely', 'Connected', 4),
  ('body', 'Body', 'How did your body feel?', 'Beat up', 'Fresh', 5)
) as v(key, label, question, low, high, position);

insert into options (user_id, kind, key, label, position)
select u.id, 'diary_prompt', v.key, v.label, v.position
from auth.users u cross join (values
  ('best', 'Best part of today', 0),
  ('drained', 'What drained me', 1),
  ('tomorrow', 'Tomorrow I want to', 2)
) as v(key, label, position);
