-- "Start the maintenance estimate over from here." The app was built over months of
-- partial food logging, so the 28-day window kept averaging in days that were never fully
-- logged. Rather than deleting those logs (they're real, and the Food tab should keep
-- showing them), the estimate reads only days on or after this date.
--
-- Intake only, deliberately: weight logging has no such gaps, and the weight trend needs
-- 2+ weeks of data, so restarting it too would blank the card for a fortnight after every
-- reset. Null = no reset, use the full 28-day window.
alter table user_settings add column maintenance_reset_date date;
