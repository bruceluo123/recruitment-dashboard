'use client';
import { useMemo, useState } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { RepushItem, RepushColumnId } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import {
  buildRemoteRecord,
  todaysRecommendations,
  todaysInterviews,
  findExistingReportId,
  submitRemoteRecord,
} from '@/lib/daily-report';

interface DailyReportModalProps {
  column: RepushColumnId;     // 当前查看的推荐人列（作为日报数据来源）
  name: string;               // 录入人名（即该列名，如「麦满分」）
  items: RepushItem[];        // 全部推荐记录
  candidates: Candidate[];    // 全部面试候选人
  onClose: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

/** 把本系统今日数据组装成看板站日报，预览后一键提交到团队数据看板。 */
export function DailyReportModal({ column, name, items, candidates, onClose }: DailyReportModalProps) {
  const ref = useMemo(() => new Date(), []);
  const today = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;

  const recommendations = useMemo(() => todaysRecommendations(items, ref, column), [items, ref, column]);
  const interviews = useMemo(() => todaysInterviews(candidates, ref), [candidates, ref]);

  // rng 固定一次，保证预览与提交是同一份数据（避免再次随机导致总数对不上）
  const record = useMemo(
    () => buildRemoteRecord({ date: today, name, recommendations, interviews }),
    [today, name, recommendations, interviews],
  );

  const [state, setState] = useState<SubmitState>('idle');
  const [errMsg, setErrMsg] = useState('');

  const hasData = record.recommendTotal > 0 || record.scheduledInt > 0;

  const handleSubmit = async () => {
    setState('submitting');
    setErrMsg('');
    try {
      const existingId = await findExistingReportId(today, name);
      await submitRemoteRecord(existingId ? { ...record, id: existingId } : record);
      setState('done');
    } catch (error: unknown) {
      setState('error');
      setErrMsg(error instanceof Error ? error.message : '提交失败，请重试');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">
            一键日报 · <span className="text-indigo-600">{name}</span>
            <span className="ml-2 text-sm font-normal text-gray-400">{today}</span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {!hasData && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              今日（{name}）暂无推荐或约面数据，提交将是一条空日报。
            </div>
          )}

          {/* 汇总数字 */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="推荐总数" value={record.recommendTotal} />
            <Stat label="新收简历总数" value={record.cvTotal} />
            <Stat label="新增沟通(初筛)" value={record.screenNew} />
            <Stat label="约面" value={record.scheduledInt} />
            <Stat label="业务面试" value={record.interviewTotal} />
            <Stat label="Offer" value={record.offer} />
          </div>

          <Section title="各岗位推荐明细">
            {record.recommendDetail.length === 0 ? (
              <Empty />
            ) : (
              record.recommendDetail.map((j) => (
                <Row key={j.jobKey} left={`${j.name}${j.department ? ` · ${j.department}` : ''}`} right={`${j.qty}`} />
              ))
            )}
          </Section>

          <Section title="各岗位收取明细">
            {record.cvDetail.length === 0 ? (
              <Empty />
            ) : (
              record.cvDetail.map((j) => (
                <Row key={j.jobKey} left={`${j.name}${j.department ? ` · ${j.department}` : ''}`} right={`${j.qty}`} />
              ))
            )}
          </Section>

          <Section title="约面明细">
            {record.scheduledDetail.length === 0 ? (
              <Empty />
            ) : (
              record.scheduledDetail.map((s, i) => (
                <Row key={i} left={`${s.person} · ${s.job}`} right={`${s.date} ${s.time}`} />
              ))
            )}
          </Section>

          <Section title="业务面试明细">
            {record.interviewDetail.length === 0 ? (
              <Empty />
            ) : (
              record.interviewDetail.map((v, i) => (
                <Row key={i} left={`${v.person} · ${v.name}`} right={v.status} />
              ))
            )}
          </Section>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            提交到团队数据看板（远程招聘 · {name}）。同日同录入人会自动覆盖更新。
          </div>
          {state === 'done' ? (
            <span className="flex items-center gap-1.5 text-green-600 font-medium">
              <CheckCircle2 className="w-4 h-4" />已提交
            </span>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={state === 'submitting'}
              className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-60"
            >
              {state === 'submitting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {state === 'submitting' ? '提交中…' : '确认提交'}
            </button>
          )}
        </div>

        {state === 'error' && (
          <div className="px-5 pb-4 -mt-2 text-xs text-red-500">{errMsg}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-800">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500 mb-1.5">{title}</div>
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="text-gray-700">{left}</span>
      <span className="text-gray-500 tabular-nums">{right}</span>
    </div>
  );
}

function Empty() {
  return <div className="px-3 py-2 text-gray-300">—</div>;
}
