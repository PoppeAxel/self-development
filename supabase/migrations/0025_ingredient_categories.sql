-- Optional free-text category per ingredient (e.g. "Protein", "Vegetable", "Sauce &
-- Condiment") so the Library list can be grouped/scanned by kind, not just alphabetically.
-- Free text rather than an enum/lookup table — same philosophy as portion_label: a light
-- organizational aid, not a rigid taxonomy Pontus has to fit every item into.

alter table ingredients add column category text;
