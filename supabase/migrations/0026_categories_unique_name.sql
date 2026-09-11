-- ensure_default_categories() previously did a check-then-insert (select count, insert if
-- zero) with no locking, so two near-simultaneous calls (e.g. Today and Settings both
-- mounting around app launch) could both see zero and both insert the defaults, producing
-- duplicate rows over repeated app opens. A unique constraint plus an upsert with
-- ignoreDuplicates in the client closes the race for good.
alter table categories add constraint categories_user_id_name_key unique (user_id, name);
