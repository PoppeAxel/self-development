-- A place to park recipe links for later ("cook this sometime") next to the Recipes tab's
-- existing "Import from URL" flow, which until now left no trace of what had been imported.
-- Every successful import writes here too, so the list builds itself.
--
-- Dedup: `url_key` is the normalized form of `url` (see normalizeUrl in src/lib/links.ts —
-- scheme dropped, host lowercased minus www., trailing slash trimmed, tracking params
-- stripped, remaining params sorted) so the same page pasted twice in slightly different
-- shapes collapses to one row. The unique constraint is the actual guarantee; the client's
-- own pre-check exists only to produce a friendlier message than a constraint violation.
-- `url` keeps the usable form (original scheme/host, so a www-only site still opens).
create table saved_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url text not null,
  url_key text not null,
  title text,
  -- Set every time the link is run through import-recipe. Only ever a "this has been
  -- imported at least once" marker — the recipe it produced isn't linked back here, since
  -- the builder can be cancelled or saved under a different name after the fact.
  last_imported_at timestamptz,
  created_at timestamptz not null default now(),
  constraint saved_links_user_id_url_key_key unique (user_id, url_key)
);

alter table saved_links enable row level security;

create policy "own rows only" on saved_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
