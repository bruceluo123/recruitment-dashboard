'use client';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Briefcase, FileSearch, CalendarDays, Users, TrendingUp, ArrowUpRight, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useJDStore } from '@/store/jd-store';
import { useResumeStore } from '@/store/resume-store';
import { useInterviewStore } from '@/store/interview-store';
import { useEffect, useState } from 'react';

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const jds = useJDStore((s) => s.jds);
  const resumes = useResumeStore((s) => s.resumes);
  const candidates = useInterviewStore((s) => s.candidates);

  useEffect(() => setMounted(true), []);

  const totalJDs = jds.length;
  const activeJDs = jds.filter((j) => j.status !== 'paused').length;
  const totalResumes = resumes.length;
  const inPipeline = candidates.filter((c) => c.stage !== 'offer').length;
  const offerCount = candidates.filter((c) => c.stage === 'offer').length;

  const stats = [
    { label: 'JD 总数', value: totalJDs, sub: `${activeJDs} 活跃`, icon: Briefcase, color: 'from-indigo-500 to-cyan-500' },
    { label: '已上传简历', value: totalResumes, sub: '本月新增', icon: FileSearch, color: 'from-violet-500 to-pink-500' },
    { label: '管道中候选人', value: inPipeline, sub: `${offerCount} 已发 Offer`, icon: Users, color: 'from-amber-500 to-orange-500' },
    { label: '匹配率', value: '85%', sub: '较上月 +5%', icon: TrendingUp, color: 'from-green-500 to-emerald-500' },
  ];

  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">仪表盘</h2>
        <p className="text-sm text-gray-500 mt-1">招聘数据一览 · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</p>
      </div>

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
            { label: 'Offer', count: candidates.filter((c) => c.stage === 'offer').length, color: 'bg-green-500' },
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
