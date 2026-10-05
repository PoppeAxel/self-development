-- Reminders used to store time_of_day in UTC, converted with the device's offset at save
-- time — so every reminder drifted an hour when Sweden switched between CEST and CET.
-- Now time_of_day is the wall-clock time in `timezone`, and send-reminders works out
-- "now" in that zone, so 22:00 stays 22:00 all year. days_of_week is local days too.
alter table reminders add column timezone text not null default 'Europe/Stockholm';

-- Convert existing rows with today's offset — i.e. to the time Settings shows right now.
update reminders
set time_of_day = ((current_date + time_of_day) at time zone 'UTC' at time zone timezone)::time;
