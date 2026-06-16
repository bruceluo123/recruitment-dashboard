-- =====================================================================
-- 易房拼拼 · C 端购房者账号体系
-- 账号身份复用 auth.users（手机号+密码，合成邮箱登录）。
-- 手机号/角色存 app_metadata（用户不可改），昵称/头像存 user_metadata。
-- 本迁移仅新增 收藏 / 浏览历史 两张归属于购房者本人的表。
-- 「我的需求」复用 buyer_demands，由服务端按 app_metadata.phone 查询，无需新表。
-- =====================================================================

-- ---------- 收藏 ----------
create table if not exists public.favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, property_id)
);
create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);

-- ---------- 浏览历史 ----------
create table if not exists public.browse_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  viewed_at   timestamptz not null default now(),
  unique (user_id, property_id)
);
create index if not exists browse_history_user_idx on public.browse_history (user_id, viewed_at desc);

-- ---------- RLS：本人可读写自己的记录；admin 可读全部 ----------
alter table public.favorites      enable row level security;
alter table public.browse_history enable row level security;

create policy favorites_self_all on public.favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy favorites_admin_select on public.favorites
  for select to authenticated using (public.is_admin());

create policy history_self_all on public.browse_history
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy history_admin_select on public.browse_history
  for select to authenticated using (public.is_admin());

-- ---------- 授权（RLS 仍逐行约束） ----------
grant select, insert, update, delete on public.favorites      to authenticated;
grant select, insert, update, delete on public.browse_history to authenticated;
