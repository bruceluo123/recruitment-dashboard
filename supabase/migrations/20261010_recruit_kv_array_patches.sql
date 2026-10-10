-- Apply small resume-intake array changes under the same lock and digest check.
-- This avoids transporting the full recommendation and talent snapshots back
-- through PostgREST for every Telegram intake batch.
create or replace function public.recruit_kv_tx_hashed(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  replacement jsonb;
  current_value text;
  current_exists boolean;
  array_value jsonb;
  prefix jsonb;
  suffix jsonb;
  array_index integer;
begin
  perform pg_advisory_xact_lock(2026091401);

  for item in select value from jsonb_array_elements(coalesce(p_payload->'expected', '[]'::jsonb)) loop
    select value into current_value
    from public.recruit_kv
    where key = item->>'key'
      and (expires_at is null or expires_at > now());
    current_exists := found;
    if current_exists is distinct from coalesce((item->>'exists')::boolean, false)
      or (current_exists and encode(extensions.digest(convert_to(current_value, 'UTF8'), 'sha1'), 'hex')
        is distinct from item->>'sha1') then
      return jsonb_build_object('ok', false);
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'patches', '[]'::jsonb)) loop
    select value into current_value from public.recruit_kv where key = item->>'key';
    array_value := coalesce(current_value, '[]')::jsonb;
    prefix := coalesce(item->'prepend', '[]'::jsonb);
    suffix := coalesce(item->'append', '[]'::jsonb);
    if jsonb_typeof(array_value) <> 'array' or jsonb_typeof(prefix) <> 'array'
      or jsonb_typeof(suffix) <> 'array' then
      return jsonb_build_object('ok', false);
    end if;
    for replacement in select value from jsonb_array_elements(coalesce(item->'replace', '[]'::jsonb)) loop
      array_index := (replacement->>'index')::integer;
      if array_index < 0 or array_index >= jsonb_array_length(array_value) then
        return jsonb_build_object('ok', false);
      end if;
      array_value := jsonb_set(array_value, array[array_index::text], replacement->'value', false);
    end loop;
    array_value := prefix || array_value || suffix;
    p_payload := jsonb_set(p_payload, '{writes}',
      coalesce(p_payload->'writes', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('key', item->>'key', 'value', array_value::text)), true);
  end loop;

  return public.recruit_kv_tx(p_payload - 'expected' - 'patches');
end;
$$;
