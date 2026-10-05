-- The 22:00 daily check-in nudge is a normal reminders row (so Settings can change its time
-- or switch it off) tagged kind = 'checkin': send-reminders skips it when tonight's
-- daily_checkins row already exists, and the push opens /?checkin=1 straight into it.
alter table reminders add column kind text check (kind in ('checkin'));
