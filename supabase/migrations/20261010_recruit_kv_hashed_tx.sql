-- Compare large KV snapshots by digest before delegating the unchanged atomic write.
-- Both functions take the same advisory transaction lock, so the comparison and
-- write cannot be interleaved with another recruitment KV update.
create or replace function public.recruit_kv_tx_hashed(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  current_value text;
  current_exists boolean;
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

  return public.recruit_kv_tx(p_payload - 'expected');
end;
$$;

revoke all on function public.recruit_kv_tx_hashed(jsonb) from public, anon, authenticated;
grant execute on function public.recruit_kv_tx_hashed(jsonb) to service_role;
