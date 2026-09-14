create table if not exists public.recruit_kv (
  key text primary key,
  value text not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.recruit_kv enable row level security;
alter table public.recruit_kv force row level security;
revoke all on table public.recruit_kv from anon, authenticated;

create or replace function public.recruit_kv_read(p_keys text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.recruit_kv
  where key = any(p_keys)
    and (expires_at is null or expires_at > now());
$$;

create or replace function public.recruit_kv_tx(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  current_value text;
  current_exists boolean;
  next_value text;
  list_value jsonb;
  list_item jsonb;
  list_index integer;
  list_count integer;
  remove_count integer;
  removed integer;
  ttl_seconds integer;
  result jsonb := '{"ok":true,"increments":{},"popped":{}}'::jsonb;
begin
  perform pg_advisory_xact_lock(2026091401);
  delete from public.recruit_kv where expires_at is not null and expires_at <= now();

  for item in select value from jsonb_array_elements(coalesce(p_payload->'expected', '[]'::jsonb)) loop
    select value into current_value from public.recruit_kv where key = item->>'key';
    current_exists := found;
    if current_exists is distinct from coalesce((item->>'exists')::boolean, false)
      or (current_exists and current_value is distinct from item->>'value') then
      return jsonb_build_object('ok', false);
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'writes', '[]'::jsonb)) loop
    ttl_seconds := nullif(item->>'ttlSeconds', '')::integer;
    insert into public.recruit_kv(key, value, expires_at, updated_at)
    values (
      item->>'key',
      coalesce(item->>'value', ''),
      case when ttl_seconds is null then null else now() + make_interval(secs => ttl_seconds) end,
      now()
    )
    on conflict (key) do update set
      value = excluded.value,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'deletes', '[]'::jsonb)) loop
    delete from public.recruit_kv where key = item #>> '{}';
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'increments', '[]'::jsonb)) loop
    select value into current_value from public.recruit_kv where key = item #>> '{}';
    next_value := (coalesce(nullif(current_value, ''), '0')::bigint + 1)::text;
    insert into public.recruit_kv(key, value, expires_at, updated_at)
    values (item #>> '{}', next_value, null, now())
    on conflict (key) do update set value = excluded.value, expires_at = null, updated_at = excluded.updated_at;
    result := jsonb_set(result, array['increments', item #>> '{}'], to_jsonb(next_value::bigint), true);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'lists', '[]'::jsonb)) loop
    select value into current_value from public.recruit_kv where key = item->>'key';
    begin
      list_value := coalesce(current_value, '[]')::jsonb;
      if jsonb_typeof(list_value) <> 'array' then list_value := '[]'::jsonb; end if;
    exception when others then
      list_value := '[]'::jsonb;
    end;

    if item->>'op' = 'push' then
      list_value := list_value || jsonb_build_array(item->>'value');
    elsif item->>'op' = 'pop_left' then
      list_item := list_value->0;
      if jsonb_array_length(list_value) > 0 then
        select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
          into list_value
          from jsonb_array_elements(list_value) with ordinality
          where ordinality > 1;
      end if;
      result := jsonb_set(result, array['popped', item->>'key'], coalesce(list_item, 'null'::jsonb), true);
    elsif item->>'op' = 'remove' then
      remove_count := coalesce((item->>'count')::integer, 0);
      removed := 0;
      list_index := 0;
      select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
        into list_value
        from jsonb_array_elements(list_value) with ordinality
        where not (
          value = to_jsonb(item->>'value')
          and (remove_count = 0 or ordinality <= remove_count)
        );
    end if;

    insert into public.recruit_kv(key, value, expires_at, updated_at)
    values (item->>'key', list_value::text, null, now())
    on conflict (key) do update set value = excluded.value, expires_at = null, updated_at = excluded.updated_at;
  end loop;

  return result;
end;
$$;

revoke all on function public.recruit_kv_read(text[]) from public, anon, authenticated;
revoke all on function public.recruit_kv_tx(jsonb) from public, anon, authenticated;
grant execute on function public.recruit_kv_read(text[]) to service_role;
grant execute on function public.recruit_kv_tx(jsonb) to service_role;
