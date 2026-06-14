import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "仪表盘 · 易房拼拼" };

function startOfWeekISO(): string {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - (day - 1));
  return monday.toISOString();
}

const SUN_BUCKETS = [
  { name: "90-100", min: 90, max: 100 },
  { name: "70-89", min: 70, max: 89 },
  { name: "50-69", min: 50, max: 69 },
  { name: "30-49", min: 30, max: 49 },
  { name: "0-29", min: 0, max: 29 },
];

interface TodoRow {
  content: string | null;
  next_follow_at: string | null;
  customers: { name: string | null; phone: string | null } | null;
}

async function getData() {
  const supabase = createClient();
  const weekStart = startOfWeekISO();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const since7 = new Date();
  since7.setDate(since7.getDate() - 6);
  since7.setHours(0, 0, 0, 0);

  const [propsRes, newBuyers, openDemands, toFollow, trendRes, todoRes] = await Promise.all([
    supabase.from("properties").select("sun_score,status"),
    supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("customer_type", "buyer")
      .gte("created_at", weekStart),
    supabase.from("buyer_demands").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("follow_ups")
      .select("*", { count: "exact", head: true })
      .not("next_follow_at", "is", null)
      .lte("next_follow_at", todayEnd.toISOString()),
    supabase
      .from("customers")
      .select("created_at")
      .eq("customer_type", "buyer")
      .gte("created_at", since7.toISOString()),
    supabase
      .from("follow_ups")
      .select("content,next_follow_at,customers(name,phone)")
      .not("next_follow_at", "is", null)
      .lte("next_follow_at", todayEnd.toISOString())
      .order("next_follow_at", { ascending: true })
      .limit(5),
  ]);

  const properties = (propsRes.data ?? []) as { sun_score: number; status: string }[];
  const onSale = properties.filter((p) => p.status === "on_sale").length;
  const total = properties.length;

  const dist = SUN_BUCKETS.map((b) => ({
    name: b.name,
    count: properties.filter((p) => p.sun_score >= b.min && p.sun_score <= b.max).length,
  }));
  const maxDist = Math.max(1, ...dist.map((d) => d.count));
  const avgSun = total ? Math.round((properties.reduce((a, p) => a + p.sun_score, 0) / total) * 10) / 10 : 0;
  const highPct = total ? Math.round((properties.filter((p) => p.sun_score >= 80).length / total) * 100) : 0;

  // 近 7 天买家线索趋势
  const days: { label: string; count: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(since7);
    d.setDate(since7.getDate() + i);
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0 });
  }
  for (const row of (trendRes.data ?? []) as { created_at: string }[]) {
    const d = new Date(row.created_at);
    const idx = Math.floor((d.getTime() - since7.getTime()) / 86400000);
    if (idx >= 0 && idx < 7) days[idx].count++;
  }

  return {
    onSale,
    newBuyers: newBuyers.count ?? 0,
    openDemands: openDemands.count ?? 0,
    toFollow: toFollow.count ?? 0,
    dist,
    maxDist,
    avgSun,
    highPct,
    days,
    todos: (todoRes.data ?? []) as unknown as TodoRow[],
    failed: !!(propsRes.error || newBuyers.error || openDemands.error || toFollow.error),
  };
}

function trendPaths(days: { count: number }[]) {
  const w = 560;
  const max = Math.max(1, ...days.map((d) => d.count));
  const x = (i: number) => 10 + (i * (w - 20)) / (days.length - 1);
  const y = (c: number) => 170 - (c / max) * 130;
  const pts = days.map((d, i) => ({ x: x(i), y: y(d.count) }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(0)},190 L${pts[0].x.toFixed(0)},190 Z`;
  return { line, area, pts };
}

export default async function DashboardPage() {
  const s = await getData();
  const { line, area, pts } = trendPaths(s.days);

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>仪表盘</h1>
          <p>立足深圳 · 放眼大湾区 —— 今日业务概览</p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/admin/customers/import" className="yfp-btn yfp-btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M5 21h14" />
            </svg>
            批量导入
          </Link>
          <Link href="/admin/properties/new" className="yfp-btn yfp-btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
            录入新房源
          </Link>
        </div>
      </div>

      {s.failed ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          部分数据加载失败，请确认已配置 Supabase 环境变量并执行迁移。
        </p>
      ) : null}

      <div className="yfp-kpis mb-[18px]">
        <Link href="/admin/properties" className="yfp-kpi" style={{ ["--accent" as string]: "rgba(216,50,59,.10)" }}>
          <div className="k-top">
            <span className="yfp-k-icon ic-red">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V21h14V9.5" />
              </svg>
            </span>
          </div>
          <div className="k-num tabular">{s.onSale}</div>
          <div className="k-label">在售笋盘</div>
        </Link>

        <Link
          href="/admin/customers?type=buyer"
          className="yfp-kpi"
          style={{ ["--accent" as string]: "rgba(242,180,58,.14)" }}
        >
          <div className="k-top">
            <span className="yfp-k-icon ic-gold">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="9" cy="8" r="3.2" />
                <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
              </svg>
            </span>
          </div>
          <div className="k-num tabular">{s.newBuyers}</div>
          <div className="k-label">本周新增买家线索</div>
        </Link>

        <Link href="/admin/demands" className="yfp-kpi" style={{ ["--accent" as string]: "rgba(45,116,196,.12)" }}>
          <div className="k-top">
            <span className="yfp-k-icon ic-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M5 4h14v16l-7-3-7 3z" />
              </svg>
            </span>
          </div>
          <div className="k-num tabular">{s.openDemands}</div>
          <div className="k-label">待匹配需求</div>
        </Link>

        <Link href="/admin/customers" className="yfp-kpi" style={{ ["--accent" as string]: "rgba(31,157,107,.12)" }}>
          <div className="k-top">
            <span className="yfp-k-icon ic-ok">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 8v4l3 2" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <span className="yfp-trend up">今日</span>
          </div>
          <div className="k-num tabular">{s.toFollow}</div>
          <div className="k-label">待跟进客户</div>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
        {/* 趋势图 */}
        <div className="yfp-card">
          <div className="yfp-card-h">
            <h3>近 7 天新增买家线索</h3>
            <Link href="/admin/customers?type=buyer" className="more">
              查看明细 ›
            </Link>
          </div>
          <div className="yfp-card-b">
            <svg viewBox="0 0 560 200" preserveAspectRatio="none" className="h-[200px] w-full">
              <defs>
                <linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#D8323B" stopOpacity=".22" />
                  <stop offset="1" stopColor="#D8323B" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1="40" x2="560" y2="40" stroke="#F0E8D9" />
              <line x1="0" y1="90" x2="560" y2="90" stroke="#F0E8D9" />
              <line x1="0" y1="140" x2="560" y2="140" stroke="#F0E8D9" />
              <path d={area} fill="url(#g-red)" />
              <path
                d={line}
                fill="none"
                stroke="#D8323B"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke="#D8323B" strokeWidth="2.5" />
              ))}
            </svg>
            <div className="flex justify-between px-1 text-[11.5px] text-[var(--yfp-ink-3)]">
              {s.days.map((d) => (
                <span key={d.label}>{d.label}</span>
              ))}
            </div>
          </div>
        </div>

        {/* 笋度分布 */}
        <div className="yfp-card">
          <div className="yfp-card-h">
            <h3>在售笋盘 · 笋度分布</h3>
          </div>
          <div className="yfp-card-b">
            <div className="yfp-bars">
              {s.dist.map((d) => (
                <div key={d.name} className="yfp-bar-row">
                  <span className="b-name">{d.name}</span>
                  <span className="yfp-bar-track">
                    <span className="yfp-bar-fill" style={{ width: `${(d.count / s.maxDist) * 100}%` }} />
                  </span>
                  <span className="b-val">{d.count}</span>
                </div>
              ))}
            </div>
            <div className="mt-[18px] flex items-center justify-between border-t border-[var(--yfp-line-soft)] pt-[15px]">
              <div>
                <div className="text-xs text-[var(--yfp-ink-3)]">平均笋度</div>
                <div className="yfp-serif text-[26px] font-bold text-[var(--yfp-red)]">{s.avgSun}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--yfp-ink-3)]">高笋盘(≥80)占比</div>
                <div className="yfp-serif text-[26px] font-bold text-[var(--yfp-gold-deep)]">{s.highPct}%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 今日待办 */}
      <div className="yfp-card mt-4">
        <div className="yfp-card-h">
          <h3>今日待办 · 跟进提醒</h3>
          <span className="more">共 {s.toFollow} 条</span>
        </div>
        <div className="yfp-card-b py-1.5">
          {s.todos.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--yfp-ink-3)]">暂无今日待跟进，保持节奏 👍</div>
          ) : (
            <div className="yfp-todo">
              {s.todos.map((t, i) => {
                const overdue = t.next_follow_at ? new Date(t.next_follow_at).getTime() < Date.now() : false;
                return (
                  <div key={i} className="yfp-todo-item">
                    <span className={`yfp-todo-ic ${overdue ? "ic-red" : "ic-gold"}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </span>
                    <div className="yfp-todo-main">
                      <div className="t-title">回访 {t.customers?.name || "未命名客户"}</div>
                      <div className="t-sub">{t.content || "暂无跟进备注"}</div>
                    </div>
                    <span className={`yfp-pill ${overdue ? "pill-red" : "pill-warn"}`}>
                      {overdue ? "已逾期" : "今天到期"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
