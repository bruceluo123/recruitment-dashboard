'use client'

/**
 * 跨境电商 AI 渠道触达管理系统
 * 面试作品展示页 — 所有组件写在单文件，通过 fixed inset-0 覆盖 dashboard 布局
 */

import React, { useState, useRef, useEffect } from 'react'

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

type Tab = 'customers' | 'scripts' | 'kanban'
type Platform = 'Amazon' | 'TikTok Shop' | 'Shopee' | 'Lazada'
type Category = '家居日用' | '3C配件' | '美妆护肤' | '服饰鞋包' | '户外运动'
type SalesVolume = '1-5万单' | '5-20万单' | '20万+单'
type FollowStatus = '待触达' | '已触达' | '跟进中' | '已签约'
type ApiStatus = 'idle' | 'loading' | 'success' | 'error'

interface Customer {
  id: string
  companyName: string
  platform: Platform
  category: Category
  salesVolume: SalesVolume
  status: FollowStatus
  painPoint: string
  lastFollowUp: string
}

interface GeneratedScripts {
  first_touch: string
  follow_up: string
  objection: string
}

// ─────────────────────────────────────────────
// MOCK DATA — 25 条
// ─────────────────────────────────────────────

const INITIAL_CUSTOMERS: Customer[] = [
  { id: '001', companyName: '深圳市晴日家居科技有限公司', platform: 'Amazon', category: '家居日用', salesVolume: '5-20万单', status: '跟进中', painPoint: '客服响应慢导致差评率上升，多语言工单处理跟不上', lastFollowUp: '2025-06-15' },
  { id: '002', companyName: '深圳市诺瓦电子科技有限公司', platform: 'TikTok Shop', category: '3C配件', salesVolume: '1-5万单', status: '待触达', painPoint: '新品上架铺货速度慢，TikTok爆款窗口期短来不及反应', lastFollowUp: '2025-06-10' },
  { id: '003', companyName: '深圳市盈肤生物科技有限公司', platform: 'Shopee', category: '美妆护肤', salesVolume: '5-20万单', status: '已触达', painPoint: '竞品频繁调价，手动监控多个SKU价格耗费大量人力', lastFollowUp: '2025-06-18' },
  { id: '004', companyName: '深圳市极峰户外用品有限公司', platform: 'Amazon', category: '户外运动', salesVolume: '20万+单', status: '已签约', painPoint: 'FBA补货决策靠经验，旺季前断货两次造成排名下滑', lastFollowUp: '2025-06-20' },
  { id: '005', companyName: '深圳市潮域服饰贸易有限公司', platform: 'Lazada', category: '服饰鞋包', salesVolume: '1-5万单', status: '已触达', painPoint: '广告ACOS偏高但不知道哪些关键词在浪费预算', lastFollowUp: '2025-06-12' },
  { id: '006', companyName: '深圳市朗曜照明科技有限公司', platform: 'Amazon', category: '家居日用', salesVolume: '5-20万单', status: '待触达', painPoint: '多平台库存不同步，超卖后投诉率明显上升', lastFollowUp: '2025-06-08' },
  { id: '007', companyName: '深圳市领跑电商科技有限公司', platform: 'TikTok Shop', category: '美妆护肤', salesVolume: '5-20万单', status: '跟进中', painPoint: '达人合作素材合规审核慢，屡次被平台警告', lastFollowUp: '2025-06-17' },
  { id: '008', companyName: '深圳市凯盛体育用品有限公司', platform: 'Shopee', category: '户外运动', salesVolume: '1-5万单', status: '待触达', painPoint: '东南亚多国站点运营人手不足，本地化响应跟不上', lastFollowUp: '2025-06-05' },
  { id: '009', companyName: '深圳市迅码电子有限公司', platform: 'Amazon', category: '3C配件', salesVolume: '20万+单', status: '已签约', painPoint: '退货率高但缺乏系统分析，不清楚根因在哪', lastFollowUp: '2025-06-21' },
  { id: '010', companyName: '深圳市博锐日用品有限公司', platform: 'Lazada', category: '家居日用', salesVolume: '1-5万单', status: '已触达', painPoint: '物流时效差异大，东南亚清关风险无法提前预判', lastFollowUp: '2025-06-13' },
  { id: '011', companyName: '深圳市斐然服饰贸易有限公司', platform: 'TikTok Shop', category: '服饰鞋包', salesVolume: '5-20万单', status: '跟进中', painPoint: '短视频内容产出慢，竞品爆款已铺开但自己还在审稿', lastFollowUp: '2025-06-16' },
  { id: '012', companyName: '深圳市蔓葆生物科技有限公司', platform: 'Amazon', category: '美妆护肤', salesVolume: '5-20万单', status: '待触达', painPoint: '亚马逊A+页面更新慢，新品上市节奏跟不上营销计划', lastFollowUp: '2025-06-07' },
  { id: '013', companyName: '深圳市弘凯电子商务有限公司', platform: 'Shopee', category: '3C配件', salesVolume: '1-5万单', status: '已触达', painPoint: '客服团队夜班成本高，但东南亚买家深夜咨询量大', lastFollowUp: '2025-06-14' },
  { id: '014', companyName: '深圳市盛远户外科技有限公司', platform: 'Amazon', category: '户外运动', salesVolume: '5-20万单', status: '已签约', painPoint: '旺季广告预算分配全靠经验，ROAS波动大', lastFollowUp: '2025-06-19' },
  { id: '015', companyName: '深圳市云起科技有限公司', platform: 'TikTok Shop', category: '3C配件', salesVolume: '20万+单', status: '已签约', painPoint: '直播带货话术靠人工准备，上新品时压力极大', lastFollowUp: '2025-06-22' },
  { id: '016', companyName: '深圳市锐思数码科技有限公司', platform: 'Amazon', category: '3C配件', salesVolume: '5-20万单', status: '待触达', painPoint: '知识产权投诉频发但核查响应慢，曾被下架商品', lastFollowUp: '2025-06-06' },
  { id: '017', companyName: '深圳市海纳百川科技有限公司', platform: 'TikTok Shop', category: '家居日用', salesVolume: '1-5万单', status: '跟进中', painPoint: '选品靠感觉，缺乏数据支撑，爆款预测准确率低', lastFollowUp: '2025-06-20' },
  { id: '018', companyName: '东莞市晟达运动用品有限公司', platform: 'Lazada', category: '户外运动', salesVolume: '1-5万单', status: '待触达', painPoint: '多国站点促销活动节奏不统一，错过多次大促窗口', lastFollowUp: '2025-06-03' },
  { id: '019', companyName: '东莞市通达贸易有限公司', platform: 'Lazada', category: '家居日用', salesVolume: '5-20万单', status: '跟进中', painPoint: '多仓库调拨频率高，人工协调经常出现备货错位', lastFollowUp: '2025-06-11' },
  { id: '020', companyName: '广州市翎动服饰科技有限公司', platform: 'Shopee', category: '服饰鞋包', salesVolume: '5-20万单', status: '已触达', painPoint: '跨境退货翻新流程全手工处理，库存准确率低', lastFollowUp: '2025-06-15' },
  { id: '021', companyName: '广州市魅尚服饰有限公司', platform: 'Shopee', category: '服饰鞋包', salesVolume: '1-5万单', status: '待触达', painPoint: '尺码投诉多但退货原因分类全靠人工整理', lastFollowUp: '2025-06-04' },
  { id: '022', companyName: '广州悦肤堂生物科技有限公司', platform: 'TikTok Shop', category: '美妆护肤', salesVolume: '5-20万单', status: '跟进中', painPoint: '种草内容合规风险高，人工审核每天占用大量运营精力', lastFollowUp: '2025-06-18' },
  { id: '023', companyName: '广州市弘远电商有限公司', platform: 'Amazon', category: '家居日用', salesVolume: '1-5万单', status: '已触达', painPoint: 'Listing关键词更新不及时，搜索排名持续下滑', lastFollowUp: '2025-06-09' },
  { id: '024', companyName: '义乌市博远国际贸易有限公司', platform: 'Amazon', category: '户外运动', salesVolume: '1-5万单', status: '待触达', painPoint: '欧洲站VAT合规进度滞后，担心账号被限制', lastFollowUp: '2025-06-02' },
  { id: '025', companyName: '杭州领域电商科技有限公司', platform: 'Lazada', category: '服饰鞋包', salesVolume: '20万+单', status: '已签约', painPoint: '东南亚多国物流时效监控缺失，客诉响应不及时', lastFollowUp: '2025-06-21' },
]

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const PLATFORM_STYLES: Record<Platform, string> = {
  Amazon: 'bg-orange-100 text-orange-700',
  'TikTok Shop': 'bg-gray-900 text-white',
  Shopee: 'bg-red-100 text-red-600',
  Lazada: 'bg-blue-100 text-blue-600',
}

const STATUS_STYLES: Record<FollowStatus, string> = {
  待触达: 'bg-gray-100 text-gray-500',
  已触达: 'bg-blue-100 text-blue-600',
  跟进中: 'bg-amber-100 text-amber-700',
  已签约: 'bg-emerald-100 text-emerald-700',
}

const ALL_PLATFORMS: Platform[] = ['Amazon', 'TikTok Shop', 'Shopee', 'Lazada']
const ALL_STATUSES: FollowStatus[] = ['待触达', '已触达', '跟进中', '已签约']
const ALL_CATEGORIES: Category[] = ['家居日用', '3C配件', '美妆护肤', '服饰鞋包', '户外运动']
const ALL_VOLUMES: SalesVolume[] = ['1-5万单', '5-20万单', '20万+单']

// ─────────────────────────────────────────────
// SHARED TINY COMPONENTS
// ─────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PLATFORM_STYLES[platform]}`}>
      {platform}
    </span>
  )
}

function StatusBadge({ status }: { status: FollowStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  )
}

function Pulse({ width = 'w-full' }: { width?: string }) {
  return <div className={`h-3 rounded-md bg-gray-100 animate-pulse ${width}`} />
}

// ─────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────

function Header({
  activeTab,
  setActiveTab,
}: {
  activeTab: Tab
  setActiveTab: (t: Tab) => void
}) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'customers', label: '客户库' },
    { id: 'scripts', label: 'AI 话术生成' },
    { id: 'kanban', label: '跟进看板' },
  ]

  return (
    <header className="bg-[#1E3A5F] text-white relative z-10">
      <div className="px-6 flex items-center justify-between h-16">
        {/* Logo + Tabs */}
        <div className="flex items-center gap-8">
          <div className="leading-tight">
            <div className="text-base font-bold">跨境 AI 渠道助手</div>
            <div className="text-xs text-blue-200">Channel Outreach System</div>
          </div>
          <nav className="flex h-16">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 h-full text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-400 text-white'
                    : 'border-transparent text-blue-200 hover:text-white hover:border-blue-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: Powered by + User */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-blue-300/70 px-2 py-1 rounded border border-blue-400/20">
            ⚡ Powered by DeepSeek
          </span>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold select-none">
              J
            </div>
            <span className="text-sm">Jacky</span>
          </div>
        </div>
      </div>
    </header>
  )
}

// ─────────────────────────────────────────────
// TAB 1 — CUSTOMER TABLE
// ─────────────────────────────────────────────

function CustomerTable({
  customers,
  onGenerateScript,
}: {
  customers: Customer[]
  onGenerateScript: (c: Customer) => void
}) {
  const [search, setSearch] = useState('')
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<FollowStatus | 'all'>('all')

  const filtered = customers.filter(
    (c) =>
      c.companyName.toLowerCase().includes(search.toLowerCase()) &&
      (platformFilter === 'all' || c.platform === platformFilter) &&
      (statusFilter === 'all' || c.status === statusFilter)
  )

  const FilterBtn = ({
    active,
    onClick,
    children,
  }: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
  }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
        active
          ? 'bg-[#1E3A5F] text-white shadow-sm'
          : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="p-6">
      {/* Filter bar */}
      <div className="flex items-center flex-wrap gap-2 mb-5">
        <div className="relative">
          <input
            type="text"
            placeholder="搜索公司名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 w-52 bg-white"
          />
          <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
          </svg>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <FilterBtn active={platformFilter === 'all'} onClick={() => setPlatformFilter('all')}>全部平台</FilterBtn>
          {ALL_PLATFORMS.map((p) => (
            <FilterBtn key={p} active={platformFilter === p} onClick={() => setPlatformFilter(p)}>{p}</FilterBtn>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <div className="flex gap-1.5 flex-wrap">
          <FilterBtn active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部状态</FilterBtn>
          {ALL_STATUSES.map((s) => (
            <FilterBtn key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{s}</FilterBtn>
          ))}
        </div>

        <span className="ml-auto text-sm text-gray-400 whitespace-nowrap">
          共 <strong className="text-gray-600">{filtered.length}</strong> 条客户
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-100">
              {['公司名', '平台', '主营品类', '月销量级', '跟进状态', '核心痛点', '最后跟进', '操作'].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((c) => (
              <tr key={c.id} className="hover:bg-blue-50/30 transition-colors group">
                <td className="px-4 py-3 font-medium text-gray-900">{c.companyName}</td>
                <td className="px-4 py-3">
                  <PlatformBadge platform={c.platform} />
                </td>
                <td className="px-4 py-3 text-gray-500">{c.category}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{c.salesVolume}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3 text-gray-400 max-w-xs">
                  <div className="truncate" title={c.painPoint}>{c.painPoint}</div>
                </td>
                <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{c.lastFollowUp}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onGenerateScript(c)}
                    className="px-3 py-1.5 bg-[#3B82F6] text-white text-xs rounded-lg font-medium hover:bg-blue-600 transition-colors active:scale-95 whitespace-nowrap"
                  >
                    生成话术
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-16 text-center text-gray-300 text-sm">未找到匹配客户</div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// TAB 2 — AI SCRIPT GENERATOR
// ─────────────────────────────────────────────

const SCRIPT_CARDS: Array<{ key: keyof GeneratedScripts; icon: string; title: string; subtitle: string }> = [
  { key: 'first_touch', icon: '✉️', title: '首次触达', subtitle: '适用于第一次联系客户' },
  { key: 'follow_up', icon: '🔁', title: '跟进触达', subtitle: '客户 3 天未回复时使用' },
  { key: 'objection', icon: '💬', title: '异议处理', subtitle: '客户表示暂不需要时使用' },
]

function buildPrompt(
  companyName: string,
  platform: Platform,
  category: Category,
  salesVolume: SalesVolume,
  painPoint: string
): string {
  return `你是一名跨境电商 AI 解决方案的 BD 专员，推广一款基于 RPA + 大模型的跨境电商 AI Agent 产品，功能包括：智能客服自动回复与邀评、多平台批量铺货、竞品价格实时监控、广告素材合规审核、物流进度跟踪、FBA 智能补货等。

现在你要触达以下客户：
- 公司名：${companyName}
- 平台：${platform}
- 主营品类：${category}
- 月销量级：${salesVolume}
- 核心痛点：${painPoint || '请根据以上信息自行判断最可能的痛点'}

请生成三版话术，严格按以下 JSON 格式输出，不要输出任何其他内容：
{
  "first_touch": "首次触达话术，70字以内，简短有力，结尾附一个低门槛行动指令（如'方便聊15分钟吗'），不要用'您好我是XX'开头，直接切入对方痛点",
  "follow_up": "跟进话术，60字以内，换一个角度切入，不要重复首触内容，可以补充一个同行案例或数据",
  "objection": "异议处理话术，60字以内，对方说'暂时不需要'时的回应，保留机会不纠缠，给对方一个低成本了解的方式"
}`
}

function ScriptGenerator({
  initialCustomer,
}: {
  initialCustomer: Customer | null
}) {
  const [companyName, setCompanyName] = useState(initialCustomer?.companyName ?? '')
  const [platform, setPlatform] = useState<Platform>(initialCustomer?.platform ?? 'Amazon')
  const [category, setCategory] = useState<Category>(initialCustomer?.category ?? '家居日用')
  const [salesVolume, setSalesVolume] = useState<SalesVolume>(initialCustomer?.salesVolume ?? '1-5万单')
  const [painPoint, setPainPoint] = useState(initialCustomer?.painPoint ?? '')
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle')
  const [scripts, setScripts] = useState<GeneratedScripts | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  // Sync form when coming from customer table
  useEffect(() => {
    if (!initialCustomer) return
    setCompanyName(initialCustomer.companyName)
    setPlatform(initialCustomer.platform)
    setCategory(initialCustomer.category)
    setSalesVolume(initialCustomer.salesVolume)
    setPainPoint(initialCustomer.painPoint)
    setApiStatus('idle')
    setScripts(null)
    setError('')
  }, [initialCustomer])

  const generate = async () => {
    if (!companyName.trim()) {
      setError('请填写公司名称')
      return
    }

    setApiStatus('loading')
    setError('')
    setScripts(null)

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          max_tokens: 1000,
          messages: [{ role: 'user', content: buildPrompt(companyName, platform, category, salesVolume, painPoint) }],
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error ?? `请求失败 (${res.status})`)
      }

      // DeepSeek 返回 OpenAI 兼容格式：choices[0].message.content
      const text: string = data.choices?.[0]?.message?.content ?? ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('AI 返回格式异常，请重试')

      const parsed = JSON.parse(match[0]) as GeneratedScripts
      setScripts(parsed)
      setApiStatus('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请重试')
      setApiStatus('error')
    }
  }

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* browser fallback — no-op */
    }
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const ToggleBtn = ({
    active,
    onClick,
    children,
  }: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
  }) => (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 text-xs rounded-lg border font-medium transition-all ${
        active
          ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="p-6 flex gap-5">
      {/* ── Left: input form ── */}
      <div className="w-80 shrink-0">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-1.5">
            <span className="w-1 h-4 bg-[#3B82F6] rounded-full inline-block" />
            客户信息
          </h2>

          <div className="space-y-4">
            {/* Company name */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">公司名称</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="输入公司名称"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 transition-shadow"
              />
            </div>

            {/* Platform */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">所在平台</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => (
                  <ToggleBtn key={p} active={platform === p} onClick={() => setPlatform(p)}>
                    {p}
                  </ToggleBtn>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">主营品类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Sales volume */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">月销量级别</label>
              <div className="flex gap-1.5">
                {ALL_VOLUMES.map((v) => (
                  <ToggleBtn key={v} active={salesVolume === v} onClick={() => setSalesVolume(v)}>
                    {v}
                  </ToggleBtn>
                ))}
              </div>
            </div>

            {/* Pain point */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">
                核心痛点
                <span className="text-gray-300 font-normal ml-1">（可选）</span>
              </label>
              <textarea
                value={painPoint}
                onChange={(e) => setPainPoint(e.target.value)}
                placeholder="如不填则由 AI 自动判断"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="text-xs text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg leading-relaxed">
                {error}
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={apiStatus === 'loading'}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                apiStatus === 'loading'
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-[#3B82F6] text-white hover:bg-blue-600 active:scale-[0.98] shadow-sm shadow-blue-200'
              }`}
            >
              {apiStatus === 'loading' ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI 正在生成...
                </span>
              ) : (
                '🤖 生成触达话术'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: 3 script cards ── */}
      <div className="flex-1 grid grid-cols-3 gap-4">
        {SCRIPT_CARDS.map(({ key, icon, title, subtitle }) => (
          <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col min-h-64">
            <div className="mb-4">
              <div className="text-sm font-bold text-gray-900">{icon} {title}</div>
              <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>
            </div>

            <div className="flex-1">
              {apiStatus === 'idle' && (
                <p className="text-sm text-gray-300 leading-relaxed">
                  点击左侧「生成触达话术」按钮，AI 将自动生成三版话术
                </p>
              )}
              {apiStatus === 'loading' && (
                <div className="space-y-2.5 pt-1">
                  <Pulse />
                  <Pulse width="w-4/5" />
                  <Pulse width="w-full" />
                  <Pulse width="w-3/4" />
                  <Pulse width="w-5/6" />
                  <Pulse width="w-2/3" />
                </div>
              )}
              {apiStatus === 'success' && scripts && (
                <p className="text-sm text-gray-700 leading-relaxed">{scripts[key]}</p>
              )}
              {apiStatus === 'error' && (
                <p className="text-sm text-red-400 leading-relaxed">生成失败，请稍后重试</p>
              )}
            </div>

            {apiStatus === 'success' && scripts && (
              <button
                onClick={() => copy(scripts[key], key)}
                className={`mt-4 px-3 py-1.5 text-xs rounded-lg border font-medium transition-all ${
                  copied === key
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                }`}
              >
                {copied === key ? '已复制 ✓' : '复制'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// TAB 3 — KANBAN BOARD
// ─────────────────────────────────────────────

const KANBAN_COLS: Array<{
  status: FollowStatus
  labelCls: string
  bg: string
  border: string
  dot: string
}> = [
  { status: '待触达', labelCls: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' },
  { status: '已触达', labelCls: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-100', dot: 'bg-blue-400' },
  { status: '跟进中', labelCls: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100', dot: 'bg-amber-400' },
  { status: '已签约', labelCls: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100', dot: 'bg-emerald-400' },
]

function KanbanCard({
  customer,
  onDragStart,
}: {
  customer: Customer
  onDragStart: (id: string) => void
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(customer.id)}
      className="bg-white rounded-lg p-3.5 shadow-sm border border-gray-100 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="font-semibold text-sm text-gray-900 mb-2 leading-snug">{customer.companyName}</div>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <PlatformBadge platform={customer.platform} />
        <span className="text-xs text-gray-400">{customer.category}</span>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 mb-2">{customer.painPoint}</p>
      <div className="text-xs text-gray-300">{customer.lastFollowUp}</div>
    </div>
  )
}

function KanbanColumn({
  status,
  labelCls,
  bg,
  border,
  dot,
  customers,
  onDrop,
  onDragStart,
}: {
  status: FollowStatus
  labelCls: string
  bg: string
  border: string
  dot: string
  customers: Customer[]
  onDrop: (s: FollowStatus) => void
  onDragStart: (id: string) => void
}) {
  const [isOver, setIsOver] = useState(false)

  return (
    <div
      className={`flex flex-col rounded-xl border transition-all ${
        isOver ? 'border-blue-300 ring-2 ring-blue-100' : border
      } ${bg}`}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true) }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => { e.preventDefault(); setIsOver(false); onDrop(status) }}
    >
      {/* Column header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-black/5">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${dot}`} />
          <span className={`font-semibold text-sm ${labelCls}`}>{status}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full bg-white/80 font-bold ${labelCls}`}>
          {customers.length}
        </span>
      </div>

      {/* Cards */}
      <div className="p-3 space-y-2 min-h-64 flex-1">
        {customers.map((c) => (
          <KanbanCard key={c.id} customer={c} onDragStart={onDragStart} />
        ))}
        {customers.length === 0 && !isOver && (
          <div className="h-16 flex items-center justify-center text-xs text-gray-300 border-2 border-dashed border-gray-200 rounded-lg">
            拖拽至此
          </div>
        )}
      </div>
    </div>
  )
}

function KanbanBoard({
  customers,
  setCustomers,
}: {
  customers: Customer[]
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>
}) {
  const draggingId = useRef<string | null>(null)

  const handleDragStart = (id: string) => {
    draggingId.current = id
  }

  const handleDrop = (newStatus: FollowStatus) => {
    if (!draggingId.current) return
    setCustomers((prev) =>
      prev.map((c) => (c.id === draggingId.current ? { ...c, status: newStatus } : c))
    )
    draggingId.current = null
  }

  const stats = [
    { label: '总客户数', value: '25', color: 'text-gray-900' },
    { label: '本月新增触达', value: '12', color: 'text-[#3B82F6]' },
    { label: '本月签约', value: '4', color: 'text-emerald-600' },
    { label: '触达→回复转化率', value: '38%', color: 'text-amber-500' },
  ]

  return (
    <div className="p-6">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className={`text-3xl font-bold ${color} mb-1`}>{value}</div>
            <div className="text-xs text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-4 gap-4">
        {KANBAN_COLS.map((col) => (
          <KanbanColumn
            key={col.status}
            {...col}
            customers={customers.filter((c) => c.status === col.status)}
            onDrop={handleDrop}
            onDragStart={handleDragStart}
          />
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// ROOT PAGE — covers the dashboard shell
// ─────────────────────────────────────────────

export default function ChannelOutreachPage() {
  const [activeTab, setActiveTab] = useState<Tab>('customers')
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const handleGenerateScript = (customer: Customer) => {
    setSelectedCustomer(customer)
    setActiveTab('scripts')
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'customers' && (
          <CustomerTable customers={customers} onGenerateScript={handleGenerateScript} />
        )}
        {activeTab === 'scripts' && (
          <ScriptGenerator initialCustomer={selectedCustomer} />
        )}
        {activeTab === 'kanban' && (
          <KanbanBoard customers={customers} setCustomers={setCustomers} />
        )}
      </main>
    </div>
  )
}
