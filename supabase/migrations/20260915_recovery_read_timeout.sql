-- The backend reads multi-megabyte legacy recommendation snapshots. Keep the
-- timeout bounded without applying the authenticator's 8-second default to it.
alter role service_role set statement_timeout = '30s';

-- Read-only snapshots use a single statement snapshot, not volatile evaluation.
alter function public.recruit_kv_read(text[]) stable;
notify pgrst, 'reload config';

-- Preserve an exact recovery snapshot. Remove only JSON NUL escapes, never
-- literal text such as a double-escaped backslash followed by u0000.
do $$
declare original text; cleaned text;
begin
  perform pg_advisory_xact_lock(2026091401);
  select value into original from public.recruit_kv where key='recruit:repush' for update;
  if original is null then return; end if;
  cleaned := regexp_replace(original, '(?<!\\)(\\\\)*\\u0000', '\1', 'g');
  perform jsonb_array_length(cleaned::jsonb);
  if cleaned is distinct from original then
    insert into public.recruit_kv(key,value) values ('recruit:recovery:repush:before-nul-cleanup-20260915',original) on conflict(key) do nothing;
    update public.recruit_kv set value=cleaned,updated_at=now() where key='recruit:repush';
    update public.recruit_kv set value=(value::bigint+1)::text,updated_at=now() where key='recruit:version';
  end if;
end $$;
