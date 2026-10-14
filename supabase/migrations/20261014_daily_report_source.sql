create or replace function public.recruit_daily_report_source(p_day date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with daily_recommendations as (
    select item
    from public.recruit_kv k
    cross join lateral jsonb_array_elements(replace(k.value, chr(92) || 'u0000', '')::jsonb) item
    cross join lateral (
      select case when item->>'deliveryStatus' = 'sent'
        then coalesce(nullif(item->>'deliveredAt', ''), nullif(item->>'deliveryUpdatedAt', ''), nullif(item->>'uploadedAt', ''))
        else nullif(item->>'uploadedAt', '')
      end as delivered_time
    ) delivery
    where k.key = 'recruit:repush'
      and (k.expires_at is null or k.expires_at > now())
      and item->>'deliveryStatus' in ('sent', 'manual')
      and case when delivery.delivered_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then (delivery.delivered_time::timestamptz at time zone 'Asia/Shanghai')::date = p_day
        else false
      end
  )
  select jsonb_build_object(
    'items', case when exists (
      select 1 from public.recruit_kv
      where key = 'recruit:repush' and (expires_at is null or expires_at > now())
    ) then (select coalesce(jsonb_agg(item), '[]'::jsonb) from daily_recommendations) end,
    'candidates', (
      select replace(value, chr(92) || 'u0000', '')::jsonb
      from public.recruit_kv
      where key = 'recruit:candidates' and (expires_at is null or expires_at > now())
    ),
    'tombstones', coalesce((
      select value::jsonb
      from public.recruit_kv
      where key = 'recruit:tombstones' and (expires_at is null or expires_at > now())
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.recruit_daily_report_source(date) from public, anon, authenticated;
grant execute on function public.recruit_daily_report_source(date) to service_role;
