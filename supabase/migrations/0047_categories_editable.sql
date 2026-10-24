-- Labels become editable in place (Fas 2, step 1): an explicit order, and delete = archive so
-- tasks/goals that still point at a label keep reading its name, and Undo can bring it back.
alter table categories
  add column position integer not null default 0,
  add column archived_at timestamptz;

-- Keep today's order (alphabetical) as the starting position.
update categories c
set position = r.rn
from (select id, row_number() over (partition by user_id order by name) - 1 as rn from categories) r
where r.id = c.id;
