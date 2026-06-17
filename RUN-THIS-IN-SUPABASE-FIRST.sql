-- KG Stock Site Control v3 migration
-- Run once in Supabase Dashboard > SQL Editor before using Workers, Equipment or Claims.

alter table public.app_records
  drop constraint if exists app_records_collection_check;

alter table public.app_records
  add constraint app_records_collection_check check (
    collection in (
      'settings', 'sites', 'items', 'prices', 'stockTransactions',
      'deliveryOrders', 'manpower', 'jobs', 'jobActivities',
      'workers', 'equipmentTransactions', 'siteClaims'
    )
  );

create or replace function public.replace_all_app_data(p_data jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_collection text;
  v_records jsonb;
  v_record_id text;
  v_value jsonb;
begin
  if not public.is_app_user() then
    raise exception 'This Google account is not permitted.' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Backup data must be a JSON object.';
  end if;
  delete from public.app_records;
  for v_collection, v_records in select key, value from jsonb_each(p_data)
  loop
    if jsonb_typeof(v_records) = 'object' then
      for v_record_id, v_value in select key, value from jsonb_each(v_records)
      loop
        if v_collection in (
          'settings','sites','items','prices','stockTransactions','deliveryOrders',
          'manpower','jobs','jobActivities','workers','equipmentTransactions','siteClaims'
        ) then
          insert into public.app_records (collection, record_id, data, updated_at, updated_by)
          values (v_collection, v_record_id, v_value, now(), coalesce(auth.jwt() ->> 'email', 'system'));
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function public.replace_all_app_data(jsonb) from public;
grant execute on function public.replace_all_app_data(jsonb) to authenticated;
