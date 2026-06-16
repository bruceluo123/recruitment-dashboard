-- =====================================================================
-- 易房拼拼 · 房产金融贷款撮合模块
-- 定位：仅做「信息撮合 + 顾问对接」，严守五不原则
--       （不放贷 / 不募集 / 不担保 / 不触碰资金 / 不虚假承诺）。
-- loan_products：平台展示的银行/机构公开贷款产品（仅展示，利率以银行最终审批为准）。
-- loan_applications：C 端留资的贷款咨询意向，由顾问线下对接，无任何资金往来。
-- 金额单位统一：万元，numeric(12,2)；利率为「年化百分数」，如 3.05 表示 3.05%。
-- =====================================================================

-- ---------- 枚举 ----------
-- 贷款类型：按揭购房 / 房抵经营贷 / 房抵消费贷 / 公积金 / 其他
create type loan_type       as enum ('mortgage_buy', 'mortgage_biz', 'mortgage_consume', 'provident', 'other');
-- 咨询单状态：待联系 / 已联系 / 已关闭
create type loan_app_status as enum ('open', 'contacted', 'closed');

-- ---------- 贷款产品表 ----------
create table public.loan_products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                         -- 产品名，如「首套商业按揭贷」
  bank_name     text not null,                         -- 银行/机构名
  loan_type     loan_type not null default 'other',
  rate_min      numeric(5,2),                          -- 年化利率下限 %
  rate_max      numeric(5,2),                          -- 年化利率上限 %
  amount_max    numeric(12,2),                         -- 最高额度（万元）
  term_max_years int,                                  -- 最长年限
  ltv_max       int,                                   -- 最高成数（房产估值占比 %），按揭/抵押用
  highlight     text,                                  -- 一句话亮点
  requirements  text[] not null default '{}',          -- 申请条件清单
  sort_order    int not null default 100,              -- 排序，越小越靠前
  is_active     boolean not null default true,         -- 是否上架
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_loan_products_type   on public.loan_products(loan_type);
create index idx_loan_products_active on public.loan_products(is_active, sort_order);

create trigger trg_loan_products_updated_at
  before update on public.loan_products
  for each row execute function public.set_updated_at();

-- ---------- 贷款咨询意向表（C 端留资）----------
create table public.loan_applications (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid references public.customers(id) on delete set null,
  product_id     uuid references public.loan_products(id) on delete set null,
  name           text,
  phone          text not null,
  loan_type      loan_type,
  amount_wanted  numeric(12,2),                         -- 期望贷款额度（万元）
  property_value numeric(12,2),                         -- 房产估值（万元，选填）
  has_property   boolean not null default false,        -- 名下是否有房产
  note           text,
  status         loan_app_status not null default 'open',
  source         text,                                  -- 来源，如 H5 / H5:房源id
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_loan_apps_status on public.loan_applications(status);
create index idx_loan_apps_phone  on public.loan_applications(phone);

create trigger trg_loan_applications_updated_at
  before update on public.loan_applications
  for each row execute function public.set_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.loan_products     enable row level security;
alter table public.loan_applications enable row level security;

-- 产品：admin 全权直接读写基表；C 端通过下方视图读上架产品
create policy loan_products_admin_all on public.loan_products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 咨询单：admin 全权；匿名仅可 insert（手机号必填，H5 留资）
create policy loan_apps_admin_all on public.loan_applications
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy loan_apps_anon_insert on public.loan_applications
  for insert to anon with check (phone is not null);

-- ---------- C 端白名单视图 public_loan_products ----------
-- 仅暴露上架产品的展示字段，按 sort_order 排序
create view public.public_loan_products
with (security_invoker = false) as
  select
    id, name, bank_name, loan_type, rate_min, rate_max,
    amount_max, term_max_years, ltv_max, highlight, requirements, sort_order
  from public.loan_products
  where is_active = true;

grant select on public.public_loan_products to anon, authenticated;

-- =====================================================================
-- 种子数据 · 2026 年深圳地区公开银行贷款产品（仅供撮合展示，利率以银行最终审批为准）
-- =====================================================================
insert into public.loan_products
  (name, bank_name, loan_type, rate_min, rate_max, amount_max, term_max_years, ltv_max, highlight, requirements, sort_order)
values
  ('首套住房商业按揭贷', '多家国有/股份制银行', 'mortgage_buy', 3.05, 3.40, 1000.00, 30, 80,
   '首套最低 LPR-45BP，最长 30 年',
   array['深圳无房或符合首套认定','征信良好、收入覆盖月供','房产为住宅且产权清晰'], 10),

  ('二套住房商业按揭贷', '多家国有/股份制银行', 'mortgage_buy', 3.45, 3.90, 800.00, 30, 70,
   '二套利率随政策动态调整',
   array['名下已有 1 套住房贷款记录','征信良好、负债可控','首付比例按当地政策执行'], 20),

  ('公积金住房贷款（首套）', '深圳市住房公积金中心', 'provident', 2.60, 2.60, 126.00, 30, 80,
   '首套 5 年以上仅 2.6%，最划算',
   array['连续正常缴存满 6 个月','深圳购房且符合公积金贷款条件','额度按缴存基数与系数核定'], 30),

  ('房产抵押经营贷', '广发/平安/招商等', 'mortgage_biz', 2.35, 2.80, 1000.00, 10, 70,
   '持牌经营主体专享，年化低至 2.35%',
   array['本人/配偶名下有可抵押房产','持有满 6 个月以上的营业执照','房产估值 7 成内核定额度'], 40),

  ('房产抵押消费贷', '多家商业银行', 'mortgage_consume', 3.40, 4.20, 300.00, 10, 70,
   '装修/教育等大额消费，最高 300 万',
   array['名下有可抵押房产','征信良好、有稳定收入','资金用途合规、不得违规流入楼市股市'], 50),

  ('公积金信用消费贷', '深圳多家银行', 'provident', 2.80, 3.20, 50.00, 5, null,
   '公积金缴存职工专享，纯信用免抵押',
   array['公积金连续缴存满 1 年','征信良好、无当前逾期','额度按缴存与收入综合核定'], 60);
