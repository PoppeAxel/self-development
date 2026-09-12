Read `CONTEXT.md` (repo root, untracked) at the start of every session before making
changes — it has architecture notes, data model, known quirks, and lessons from past
sessions that aren't otherwise visible from the code alone.

After making a nontrivial change (new feature, schema/migration, bug fix with a
non-obvious root cause, a new integration or automation), update `CONTEXT.md` yourself
with what changed and why, in the same style as the existing entries. Don't wait to be
asked — this file is how future sessions (including other concurrent ones on this repo)
stay in sync, since it is intentionally kept untracked and never committed to git.
