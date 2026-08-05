-- Per-user settings that don't fit any existing table (currently just a goal weight,
-- shown as a reference line on the weight trend chart in Stats).

create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  goal_weight numeric
);

alter table user_settings enable row level security;
create policy "own row only" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
