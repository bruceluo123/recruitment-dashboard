'use client';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Briefcase, FileSearch, CalendarDays, Users, Award, ArrowUpRight, ArrowRight, Flame, Clock, UserPlus, CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useJDStore } from '@/store/jd-store';
import { useTalentStore } from '@/store/talent-store';
import { useInterviewStore } from '@/store/interview-store';
import { useRepushStore } from '@/store/repush-store';
import { STAGE_COLORS } from '@/types/interview';
import { JD_STATUS_COLORS, JD_STATUS_LABELS } from '@/types/jd';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

/** 把缺口文本（"3"、"5人"、"急招2"）解析为数字，无法解析时为 0。 */
function parseGap(gap?: string): number {
  if (!gap) return 0;
  const m = gap.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

const STAGE_LABELS: Record<string, string> = { 'interview-1': '一面', 'interview-2': '二面', offer: 'Offer' };

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const jds = useJDStore((s) => s.jds);
  const selectJD = useJDStore((s) => s.selectJD);
  const talents = useTalentStore((s) => s.talents);
  const candidates = useInterviewStore((s) => s.candidates);
  const repushItems = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // 今日推荐（复推池中当天录入的推荐人）
  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
  const todayRecs = repushItems
    .filter((it) => { const t = new Date(it.uploadedAt).getTime(); return !Number.isNaN(t) && t >= todayStart; })
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const todayScheduled = todayRecs.filter((it) => it.interviewStatus === 'scheduled').length;

  const totalJDs = jds.length;
  const urgentJDs = jds.filter((j) => j.status === 'urgent').length;
  const talentCount = talents.length;
  const inPipeline = candidates.filter((c) => c.stage !== 'offer').length;
  const offerCandidates = candidates.filter((c) => c.stage === 'offer');
  const offerCount = offerCandidates.length;
  const offerScoreTotal = offerCandidates.reduce((sum, c) => sum + (c.score || 0), 0);
  const onboardedCount = offerCandidates.filter((c) => c.onboardDate).length;

  // 本周待面试（未来 7 天内有面试日期、且未到 Offer 阶段）
  const now = Date.now();
  const weekEnd = now + 7 * 24 * 60 * 60 * 1000;
  const upcomingInterviews = candidates
    .filter((c) => c.stage !== 'offer' && c.interviewDate)
    .map((c) => ({ c, t: new Date(c.interviewDate as string).getTime() }))
    .filter(({ t }) => !Number.isNaN(t) && t >= now - 12 * 60 * 60 * 1000 && t <= weekEnd)
    .sort((a, b) => a.t - b.t);
  const weekInterviewCount = upcomingInterviews.length;

  // 急招岗位：按缺口数量降序
  const urgentByGap = jds
    .map((j) => ({ j, gap: parseGap(j.gap) }))
    .filter(({ gap, j }) => gap > 0 || j.status === 'urgent')
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 6);

  const stats = [
    { label: 'JD 总数', value: totalJDs, sub: `${urgentJDs} 急招`, icon: Briefcase, color: 'from-indigo-500 to-cyan-500' },
    { label: '人才库人数', value: talentCount, sub: '已入库简历', icon: FileSearch, color: 'from-violet-500 to-pink-500' },
    { label: '管道中候选人', value: inPipeline, sub: `${weekInterviewCount} 本周待面`, icon: Users, color: 'from-amber-500 to-orange-500' },
    { label: 'Offer 人选', value: offerCount, sub: `总分 ${offerScoreTotal}${onboardedCount > 0 ? ` · ${onboardedCount} 已入职` : ''}`, icon: Award, color: 'from-green-500 to-emerald-500' },
  ];

  const handleOpenJD = (id: string) => { selectJD(id); router.push('/jd-library'); };

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">仪表盘</h2>
        <p className="text-sm text-gray-500 mt-1">招聘数据一览 · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</p>
      </div>

      {/* 今日推荐（复推池当天录入） */}
      <GlassPanel>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-indigo-500" />今日推荐
            <span className="text-sm font-normal text-gray-400">{todayRecs.length} 人 · {todayScheduled} 已约面</span>
          </h3>
          <Link href="/repush-pool" className="text-sm text-indigo-500 hover:text-indigo-600 flex items-center gap-1">推荐中心 <ArrowUpRight className="w-3 h-3" /></Link>
        </div>
        {todayRecs.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {todayRecs.slice(0, 9).map((it) => {
              const base = it.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
              return (
                <Link key={it.id} href="/repush-pool"
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate group-hover:text-indigo-600">{base}</p>
                    <p className="text-xs text-gray-400 truncate">{[it.organization, it.department].filter(Boolean).join(' · ') || columnNames[it.column]}</p>
                  </div>
                  {it.interviewStatus === 'scheduled' ? (
                    <span className="shrink-0 flex items-center gap-1 text-xs text-green-600"><CalendarCheck className="w-3.5 h-3.5" />已约面</span>
                  ) : (
                    <span className={cn('shrink-0 px-2 py-0.5 rounded-md text-xs font-medium', it.feedback === 'done' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600')}>
                      {it.feedback === 'done' ? '已反馈' : '待反馈'}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={UserPlus} title="今日暂无推荐" description="在推荐中心粘贴简历一键录入推荐人" />
        )}
      </GlassPanel>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <GlassPanel key={stat.label} padding="md" hover>
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-800">{stat.value}</p>
                <p className="text-xs text-gray-400">{stat.sub}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
            </div>
          </GlassPanel>
        ))}
      </div>

      {/* 急招岗位（缺口最多） + 本周面试 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2"><Flame className="w-4 h-4 text-red-500" />急招岗位 · 缺口最多</h3>
            <Link href="/jd-library" className="text-sm text-indigo-500 hover:text-indigo-600 flex items-center gap-1">JD 库 <ArrowUpRight className="w-3 h-3" /></Link>
          </div>
          {urgentByGap.length > 0 ? (
            <div className="space-y-2">
              {urgentByGap.map(({ j, gap }) => (
                <button key={j.id} onClick={() => handleOpenJD(j.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all text-left group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate group-hover:text-indigo-600">{j.title}</p>
                    <p className="text-xs text-gray-400 truncate">{j.department || j.organization || '—'}</p>
                  </div>
                  {j.status === 'urgent' && (
                    <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium shrink-0', JD_STATUS_COLORS.urgent)}>{JD_STATUS_LABELS.urgent}</span>
                  )}
                  {gap > 0 && (
                    <span className="shrink-0 text-right">
                      <span className="text-lg font-bold text-red-500">{gap}</span>
                      <span className="text-xs text-gray-400 ml-0.5">缺口</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={Flame} title="暂无缺口岗位" description="JD 设置缺口数量后将在此排序展示" />
          )}
        </GlassPanel>

        <GlassPanel>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-500" />本周面试安排</h3>
            <Link href="/interview-calendar" className="text-sm text-indigo-500 hover:text-indigo-600 flex items-center gap-1">面试日历 <ArrowUpRight className="w-3 h-3" /></Link>
          </div>
          {upcomingInterviews.length > 0 ? (
            <div className="space-y-2">
              {upcomingInterviews.slice(0, 6).map(({ c, t }) => (
                <Link key={c.id} href="/interview-calendar"
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 hover:border-gray-200 transition-all group">
                  <div className={cn('w-2 h-2 rounded-full shrink-0', STAGE_COLORS[c.stage])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate group-hover:text-indigo-600">{c.name} <span className="text-gray-400 font-normal">· {STAGE_LABELS[c.stage]}</span></p>
                    <p className="text-xs text-gray-400 truncate">{c.jdTitle}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">{new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState icon={Clock} title="本周暂无面试" description="候选人设置面试日期后将在此展示" />
          )}
        </GlassPanel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link href="/jd-library">
          <GlassPanel hover padding="lg" className="cursor-pointer h-full group">
            <div className="flex items-center justify-between mb-3">
              <Briefcase className="w-8 h-8 text-indigo-500" />
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-1">JD 岗位库</h3>
            <p className="text-sm text-gray-500">管理岗位信息，支持 Excel 批量导入和分类检索</p>
            <div className="mt-4 flex gap-2 flex-wrap">
              {['前端', '后端', 'AI', '算法', '运营', '总监'].map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-gray-100 text-xs text-gray-500">{tag}</span>
              ))}
            </div>
          </GlassPanel>
        </Link>
        <Link href="/resume-matching">
          <GlassPanel hover padding="lg" className="cursor-pointer h-full group">
            <div className="flex items-center justify-between mb-3">
              <FileSearch className="w-8 h-8 text-violet-500" />
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-1">简历匹配</h3>
            <p className="text-sm text-gray-500">上传简历，DeepSeek AI 智能匹配最适合的岗位</p>
            <div className="mt-4 flex items-center gap-2 text-xs text-violet-600">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />AI 驱动
            </div>
          </GlassPanel>
        </Link>
        <Link href="/interview-calendar">
          <GlassPanel hover padding="lg" className="cursor-pointer h-full group">
            <div className="flex items-center justify-between mb-3">
              <CalendarDays className="w-8 h-8 text-green-500" />
              <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-1">面试日历</h3>
            <p className="text-sm text-gray-500">看板式面试流程管理，拖拽推进候选人状态</p>
            <div className="mt-4 flex items-center gap-3">
              {['一面', '二面', 'Offer'].map((stage, i) => (
                <div key={stage} className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${['bg-blue-500', 'bg-amber-500', 'bg-green-500'][i]}`} />
                  <span className="text-xs text-gray-400">{stage}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </Link>
      </div>

      <GlassPanel>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-gray-800">面试管道概览</h3>
          <Link href="/interview-calendar" className="text-sm text-indigo-500 hover:text-indigo-600 flex items-center gap-1">查看全部 <ArrowUpRight className="w-3 h-3" /></Link>
        </div>
        <div className="grid grid-cols-3 gap-4 max-w-md">
          {[
            { label: '一面', count: candidates.filter((c) => c.stage === 'interview-1').length, color: 'bg-blue-500' },
            { label: '二面', count: candidates.filter((c) => c.stage === 'interview-2').length, color: 'bg-amber-500' },
            { label: 'Offer', count: offerCount, color: 'bg-green-500' },
          ].map((stage) => (
            <div key={stage.label} className="text-center p-3 rounded-xl bg-gray-50">
              <div className="text-xl font-bold text-gray-800">{stage.count}</div>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                <span className="text-xs text-gray-500">{stage.label}</span>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
