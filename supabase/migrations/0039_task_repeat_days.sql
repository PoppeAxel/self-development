-- Recurring tasks can repeat on chosen weekdays ("gym Mon/Wed/Fri") instead of only every
-- day. Null means every day — what every existing recurring task already does, so nothing
-- changes for them. Same 0–6 = Sun–Sat numbering as reminders.days_of_week (and getDay()).
alter table daily_tasks add column repeat_days smallint[];
