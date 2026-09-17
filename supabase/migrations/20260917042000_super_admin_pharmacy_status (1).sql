alter table public.pharmacies
  add column if not exists platform_status text not null default 'active',
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz;

alter table public.pharmacies
  drop constraint if exists pharmacies_platform_status_check;

alter table public.pharmacies
  add constraint pharmacies_platform_status_check
  check (platform_status in ('active','suspended','disabled','archived'));

update public.pharmacies
set platform_status = case when is_active then 'active' else 'disabled' end
where platform_status is null
   or platform_status not in ('active','suspended','disabled','archived')
   or (platform_status = 'active' and is_active = false);

create index if not exists pharmacies_platform_status_idx
  on public.pharmacies(platform_status);
