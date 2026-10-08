-- Cards from any bank, not only ANZ and NAB (other banks' CSV exports use the
-- generic importer).
alter table public.accounts drop constraint if exists accounts_bank_check;
alter table public.accounts
  add constraint accounts_bank_check check (length(trim(bank)) between 1 and 30);
