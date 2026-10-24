-- One table for every in-app editable list (Fas 2). `kind` says which list, `key` is the stable
-- id other rows store (bank_transactions.category = a budget_sub key), so renaming never rewrites
-- data. Delete = archived_at, so old rows keep their label and Undo can restore it. `system` rows
-- are ones code logic depends on (can be renamed, not deleted).
create table options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  key text not null,
  label text not null,
  icon text,
  color text,
  position integer not null default 0,
  meta jsonb not null default '{}',
  system boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
alter table options enable row level security;
create policy "own rows only" on options for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Step 2 seed: exactly the budget heads, subcategories and keyword guesses that were hardcoded in
-- src/lib/budget.ts (HEADS / SUB_INFO / GUESSES) up to 8ac6699.
insert into options (user_id, kind, key, label, icon, color, position)
select u.id, 'budget_head', v.key, v.label, v.icon, v.color, v.position
from auth.users u cross join (values
  ('home', 'Home', '🏠', '#8a5a44', 0),
  ('food', 'Food', '🛒', '#3f9a6b', 1),
  ('transport', 'Transport', '🚗', '#4f7f8c', 2),
  ('bills', 'Bills & subscriptions', '📱', '#7a6aa8', 3),
  ('loans', 'Loans', '🎓', '#6b5a8a', 4),
  ('shopping', 'Shopping', '🛍️', '#a8842f', 5),
  ('health', 'Health & training', '💪', '#b45a6e', 6),
  ('fun', 'Fun & travel', '🎉', '#c0703a', 7),
  ('other', 'Other', '📦', '#8c8577', 8)
) as v(key, label, icon, color, position);

insert into options (user_id, kind, key, label, position, meta, system)
select u.id, 'budget_sub', v.key, v.label, v.position, jsonb_build_object('head', v.head, 'group', v.grp), v.key in ('mortgage', 'other')
from auth.users u cross join (values
  ('housing', 'Housing fee', 'home', 'fixed', 0),
  ('mortgage', 'Mortgage interest', 'home', 'fixed', 1),
  ('electricity', 'Electricity', 'home', 'fixed', 2),
  ('home_insurance', 'Home insurance', 'home', 'fixed', 3),
  ('household', 'Furnishing & household', 'home', 'variable', 4),
  ('groceries', 'Groceries', 'food', 'variable', 0),
  ('eating_out', 'Eating out', 'food', 'variable', 1),
  ('car_costs', 'Car costs', 'transport', 'fixed', 0),
  ('fuel_parking', 'Fuel & parking', 'transport', 'variable', 1),
  ('public_transport', 'Public transport', 'transport', 'variable', 2),
  ('phone', 'Phone', 'bills', 'fixed', 0),
  ('streaming', 'Streaming & apps', 'bills', 'fixed', 1),
  ('union', 'Union & a-kassa', 'bills', 'fixed', 2),
  ('csn', 'CSN', 'loans', 'fixed', 0),
  ('other_loans', 'Other loans', 'loans', 'fixed', 1),
  ('clothes', 'Clothes', 'shopping', 'variable', 0),
  ('shopping', 'Other shopping', 'shopping', 'variable', 1),
  ('gym', 'Gym', 'health', 'fixed', 0),
  ('pharmacy_care', 'Pharmacy & care', 'health', 'variable', 1),
  ('going_out', 'Going out', 'fun', 'variable', 0),
  ('trips', 'Trips', 'fun', 'variable', 1),
  ('other', 'Other', 'other', 'variable', 0)
) as v(key, label, head, grp, position);

-- First match wins, in position order. `label` is the pattern (a JS regex, tested against the
-- lower-cased description padded with spaces).
insert into options (user_id, kind, key, label, position, meta)
select u.id, 'budget_keyword', 'kw' || v.position, v.pattern, v.position, jsonb_build_object('category', v.category)
from auth.users u cross join (values
  (0, '\b(lön|lon|salary|försäkringskassan)\b', 'income'),
  (1, '(avanza|nordnet|sparkonto|\bisk\b)', 'savings'),
  (2, '(hyra|\bbrf\b|\bhsb\b)', 'housing'),
  (3, '(bolån|omsättning lån)', 'mortgage'),
  (4, '(ellevio|vattenfall|e\.on|tibber|fortum)', 'electricity'),
  (5, '(hemförsäkring|if skade|folksam|trygg-hansa|länsförsäkringar)', 'home_insurance'),
  (6, '(ikea|clas ohlson|jula|bauhaus|hornbach|byggmax|mio\b|rusta)', 'household'),
  (7, '(\bcsn\b)', 'csn'),
  (8, '(ränta|avgift lån|nordea bank\b)', 'other_loans'),
  (9, '(telia|tele2|comviq|telenor|\btre\b|hallon)', 'phone'),
  (10, '(spotify|netflix|\bhbo\b|viaplay|disney|youtube|apple\.com|anthropic|claude|microsoft)', 'streaming'),
  (11, '(akademike|a-kassa|unionen|\bsaco\b)', 'union'),
  (12, '(revolut)', 'card'),
  (13, '(\bica\b|coop|willys|hemköp|lidl|city gross|mathem|\bspar\b|tempo)', 'groceries'),
  (14, '(\bbar\b|\bpub\b|liffey|nattklubb|tickster|ticketmaster|filmstaden|biljett)', 'going_out'),
  (15, '(restaurang|brasserie|mcdonald|\bmax\b|burger|pizz|sushi|foodora|wolt|espresso house|pressbyrån|7-eleven|cafe|café)', 'eating_out'),
  (16, '(transportstyrelsen|fordonsskatt|bilförsäkring|besiktning|bilprovning|däck)', 'car_costs'),
  (17, '(circle k|preem|okq8|\bingo\b|\bst1\b|easypark|parkering|trafikkon|biltema)', 'fuel_parking'),
  (18, '(\bsl\b|\bsj\b|ruter|a train|\bvy\b|uber|\bbolt\b|västtrafik|skånetrafiken)', 'public_transport'),
  (19, '(\bsas\b|norwegian|ryanair|booking\.com|airbnb|hotel|hotell)', 'trips'),
  (20, '(sats|nordic wellness|friskis|actic)', 'gym'),
  (21, '(apotek|vårdcentral|tandläk|\bkry\b|1177)', 'pharmacy_care'),
  (22, '(h&m|zalando|boozt|vinted|johnhenric|stadium|dressmann|weekday|carlings)', 'clothes'),
  (23, '(klarna|elgiganten|amazon|systembolaget|åhléns|ahlens|webhallen|inet)', 'shopping')
) as v(position, pattern, category);
