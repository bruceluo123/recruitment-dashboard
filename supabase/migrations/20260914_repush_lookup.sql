create or replace function public.recruit_repush_lookup(
  p_source_ids text[],
  p_candidate_codes text[],
  p_candidate_identity_ids text[],
  p_resume_urls text[],
  p_column text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  from public.recruit_kv
  cross join lateral jsonb_array_elements(
    replace(value, chr(92) || 'u0000', '')::jsonb
  ) as item
  where key = 'recruit:repush'
    and (expires_at is null or expires_at > now())
    and item->>'column' = p_column
    and (
      item->>'id' = any(p_source_ids)
      or (
        item->>'resumeUrl' = any(p_resume_urls)
        and (
          lower(item->>'candidateCode') = any(p_candidate_codes)
          or lower(item->>'candidateIdentityId') = any(p_candidate_identity_ids)
        )
      )
    );
$$;

revoke all on function public.recruit_repush_lookup(text[], text[], text[], text[], text) from public, anon, authenticated;
grant execute on function public.recruit_repush_lookup(text[], text[], text[], text[], text) to service_role;
