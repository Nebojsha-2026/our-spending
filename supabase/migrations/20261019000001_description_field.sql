-- Repair "Card payment" Android captures whose notification named the shop
-- in a field: "A payment was made of $9.77 From: VISA card ending 6800
-- Description: Afterpay afterpay.com" (the app now reads these; see
-- src/lib/notifications.ts). The notification text is in capture_text, or in
-- the note ("Notification: …") for captures from before capture_text.

with source as (
  select t.id, t.household_id, t.amount_cents,
         coalesce(t.capture_text, substring(t.note from '^Notification: (.*)$')) as text
    from public.transactions t
   where t.source = 'android' and t.merchant_raw is null and t.merchant = 'Card payment'
),
after_label as (
  -- Everything after "Description:" (or Merchant / Payee …) …
  select id, household_id, amount_cents,
         substring(text from '(?i)(?:description|merchant name|merchant|payee|paid to|purchase at)\s*:\s*(.*)$') as rest
    from source
),
field as (
  -- … up to the next "Field:", minus a trailing web address.
  select id, household_id, amount_cents,
         btrim(regexp_replace(
           regexp_replace(rest, '\s+(from|to|card|account|date|time|amount|reference|ref|balance|location)\s*:.*$', '', 'i'),
           '\s+(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|app|shop|store)(\.au)?(/\S*)?$', '', 'i')) as name
    from after_label
   where rest is not null
),
named as (
  select f.id, f.name, r.clean_name, r.category_id
    from field f
    left join lateral private.merchant_rule_for(f.household_id, f.name, f.amount_cents) r on true
   where f.name ~ '[A-Za-z]'
     and f.name !~* '^\s*((anz|nab|cba|commbank|westpac|ing|macquarie)\s+)?(visa|mastercard|amex|eftpos|debit|credit)(\s+(debit|credit|card|platinum|rewards|black|gold))*\s*([•·*x]{2,}\s*[0-9]{4})?\s*$'
)
update public.transactions t
   set merchant_raw = left(n.name, 200),
       merchant = left(coalesce(n.clean_name, public.clean_merchant(n.name)), 120),
       category_id = coalesce(t.category_id, n.category_id),
       note = case when t.note like 'Notification: %' then null else t.note end
  from named n
 where n.id = t.id;
