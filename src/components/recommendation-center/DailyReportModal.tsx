'use client';
import { useMemo, useState } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { RepushItem, RepushColumnId } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import {
  buildRemoteRecord,
  todaysRecommendations,
  todaysInterviews,
  findExistingReportId,
  submitRemoteRecord,
  makeJobKey,
  isInterviewPassed,
  INTERVIEW_PENDING,
  INTERVIEW_STATUS_OPTIONS,
  type JobLine,
  type ScheduledLine,
  type InterviewLine,
  type OnboardLine,
  type RemoteRecord,
} from '@/lib/daily-report';

interface DailyReportModalProps {
  column: RepushColumnId;     // 当前查看的推荐人列（作为日报数据来源）
  name: string;               // 录入人名（即该列名，如「麦满分」）
  items: RepushItem[];        // 全部推荐记录
  candidates: Candidate[];    // 全部面试候选人
  onClose: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

const sum = (arr: JobLine[]) => arr.reduce((s, j) => s + (Number(j.qty) || 0), 0);

/** 把本系统今日数据组装成看板站日报，可编辑预览后一键提交到团队数据看板。 */
export function DailyReportModal({ column, name, items, candidates, onClose }: DailyReportModalProps) {
  const ref = useMemo(() => new Date(), []);
  const today = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`;

  // 仅用一次自动算出的初稿来初始化可编辑状态；之后全部以编辑态为准。
  const draft = useMemo(() => {
    const recommendations = todaysRecommendations(items, ref, column);
    const interviews = todaysInterviews(candidates, ref, column);
    return buildRemoteRecord({ date: today, name, recommendations, interviews });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [recommend, setRecommend] = useState<JobLine[]>(draft.recommendDetail);
  const [cv, setCv] = useState<JobLine[]>(draft.cvDetail);
  const [screenNew, setScreenNew] = useState<number>(draft.screenNew);
  const [scheduled, setScheduled] = useState<ScheduledLine[]>(draft.scheduledDetail);
  const [interview, setInterview] = useState<InterviewLine[]>(draft.interviewDetail);
  // Offer 申请 / 入职：不自动抓取，默认为空，由使用者手动填写后随日报一并提交。
  const [offer, setOffer] = useState<JobLine[]>([]);
  const [onboard, setOnboard] = useState<OnboardLine[]>([]);
  const [remark, setRemark] = useState<string>(draft.remark);

  const [state, setState] = useState<SubmitState>('idle');
  const [errMsg, setErrMsg] = useState('');

  const recommendTotal = sum(recommend);
  const cvTotal = sum(cv);
  const offerTotal = sum(offer);
  // 业务面试 pass / pending 统计
  const passCount = interview.filter((v) => isInterviewPassed(v.status)).length;
  const pendingCount = interview.length - passCount;
  const hasData = recommendTotal > 0 || scheduled.length > 0 || interview.length > 0 || offerTotal > 0 || onboard.length > 0;

  const buildFinal = (): RemoteRecord => ({
    id: draft.id,
    date: today,
    name,
    cvDetail: cv.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
    cvTotal,
    screenNew: Number(screenNew) || 0,
    recommendDetail: recommend.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
    recommendTotal,
    scheduledDetail: scheduled,
    scheduledInt: scheduled.length,
    interviewDetail: interview.map((v) => ({ ...v, jobKey: makeJobKey(v.name, v.department) })),
    interviewTotal: interview.length,
    offer: offerTotal,
    offerDetail: offer.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
    onboard: onboard.length,
    onboardDetail: onboard.map((o) => ({ ...o, jobKey: makeJobKey(o.jobName, o.department) } as OnboardLine & { jobKey: string })),
    remark,
  });

  const handleSubmit = async () => {
    setState('submitting');
    setErrMsg('');
    try {
      const record = buildFinal();
      const existingId = await findExistingReportId(today, name);
      await submitRemoteRecord(existingId ? { ...record, id: existingId } : record);
      setState('done');
    } catch (error: unknown) {
      setState('error');
      setErrMsg(error instanceof Error ? error.message : '提交失败，请重试');
    }
  };

  // 通用：更新/删除/新增某个明细数组里的一行
  const patch = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, partial: Partial<T>) =>
    setter((arr) => arr.map((row, idx) => (idx === i ? { ...row, ...partial } : row)));
  const drop = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number) =>
    setter((arr) => arr.filter((_, idx) => idx !== i));

  const addJob = (setter: React.Dispatch<React.SetStateAction<JobLine[]>>) =>
    setter((arr) => [...arr, { name: '', department: '', jobKey: '', qty: 1 }]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">
            一键看板 · <span className="text-indigo-600">{name}</span>
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
              今日（{name}）暂无推荐或约面数据，可手动添加或直接提交空日报。
            </div>
          )}

          {/* 汇总数字（推荐/收取总数自动跟随明细，沟通人数可改） */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="推荐总数" value={recommendTotal} />
            <Stat label="新收简历总数" value={cvTotal} />
            <NumStat label="新增沟通(初筛)" value={screenNew} onChange={setScreenNew} />
          </div>

          <JobSection
            title="各岗位推荐明细"
            rows={recommend}
            onPatch={(i, p) => patch(setRecommend, i, p)}
            onDrop={(i) => drop(setRecommend, i)}
            onAdd={() => addJob(setRecommend)}
          />

          <JobSection
            title="各岗位收取明细"
            rows={cv}
            onPatch={(i, p) => patch(setCv, i, p)}
            onDrop={(i) => drop(setCv, i)}
            onAdd={() => addJob(setCv)}
          />

          {/* 约面明细 */}
          <EditSection title="约面明细" onAdd={() => setScheduled((a) => [...a, { job: '', person: '', date: today, time: '', tz: '北京时间' }])}>
            {scheduled.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
                <input className={inputCls} placeholder="人选" value={s.person} onChange={(e) => patch(setScheduled, i, { person: e.target.value })} />
                <input className={inputCls} placeholder="岗位" value={s.job} onChange={(e) => patch(setScheduled, i, { job: e.target.value })} />
                <input type="date" className="w-36 px-2 h-8 rounded-lg border border-gray-200" value={s.date} onChange={(e) => patch(setScheduled, i, { date: e.target.value })} />
                <input className="w-20 px-2 h-8 rounded-lg border border-gray-200" placeholder="时间" value={s.time} onChange={(e) => patch(setScheduled, i, { time: e.target.value })} />
                <DropBtn onClick={() => drop(setScheduled, i)} />
              </div>
            ))}
          </EditSection>

          {/* 业务面试明细（含 pass/pending 统计） */}
          <EditSection
            title={`业务面试明细（通过 ${passCount} · 待反馈 ${pendingCount}）`}
            onAdd={() => setInterview((a) => [...a, { name: '', department: '', jobKey: '', person: '', status: INTERVIEW_PENDING }])}
          >
            {interview.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
                <input className={inputCls} placeholder="人选" value={v.person} onChange={(e) => patch(setInterview, i, { person: e.target.value })} />
                <input className={inputCls} placeholder="岗位" value={v.name} onChange={(e) => patch(setInterview, i, { name: e.target.value })} />
                <select className="w-28 px-2 h-8 rounded-lg border border-gray-200 bg-white" value={v.status} onChange={(e) => patch(setInterview, i, { status: e.target.value })}>
                  {INTERVIEW_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <DropBtn onClick={() => drop(setInterview, i)} />
              </div>
            ))}
          </EditSection>

          {/* Offer 申请明细（手动填写，默认空） */}
          <JobSection
            title={`Offer 申请明细（共 ${offerTotal}）`}
            rows={offer}
            onPatch={(i, p) => patch(setOffer, i, p)}
            onDrop={(i) => drop(setOffer, i)}
            onAdd={() => addJob(setOffer)}
          />

          {/* 入职明细（手动填写，默认空；到岗日期默认今天） */}
          <EditSection
            title={`入职明细（当天入职 ${onboard.length}）`}
            onAdd={() => setOnboard((a) => [...a, {
              jobName: '', candidateName: '', department: '',
              probationSalary: '', probationCurrency: 'CNY',
              regularSalary: '', regularCurrency: 'CNY',
              source: '', score: '', onboardDate: today, responsibleHr: name, remark: '',
            }])}
          >
            {onboard.map((o, i) => (
              <div key={i} className="px-2 py-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input className={inputCls} placeholder="岗位名称" value={o.jobName} onChange={(e) => patch(setOnboard, i, { jobName: e.target.value })} />
                  <input className={inputCls} placeholder="姓名/花名" value={o.candidateName} onChange={(e) => patch(setOnboard, i, { candidateName: e.target.value })} />
                  <input className="w-24 px-2 h-8 rounded-lg border border-gray-200" placeholder="部门" value={o.department} onChange={(e) => patch(setOnboard, i, { department: e.target.value })} />
                  <DropBtn onClick={() => drop(setOnboard, i)} />
                </div>
                <div className="flex items-center gap-1.5">
                  <input className={inputCls} placeholder="试用期月薪" value={o.probationSalary} onChange={(e) => patch(setOnboard, i, { probationSalary: e.target.value })} />
                  <input className={inputCls} placeholder="转正后月薪" value={o.regularSalary} onChange={(e) => patch(setOnboard, i, { regularSalary: e.target.value })} />
                  <input className="w-24 px-2 h-8 rounded-lg border border-gray-200" placeholder="招聘来源" value={o.source} onChange={(e) => patch(setOnboard, i, { source: e.target.value })} />
                  <input className="w-16 px-2 h-8 rounded-lg border border-gray-200" placeholder="如8.5" value={o.score} onChange={(e) => patch(setOnboard, i, { score: e.target.value })} />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-gray-400 shrink-0">到岗日期</label>
                  <input type="date" className="px-2 h-8 rounded-lg border border-gray-200" value={o.onboardDate} onChange={(e) => patch(setOnboard, i, { onboardDate: e.target.value })} />
                </div>
              </div>
            ))}
          </EditSection>

          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">备注</div>
            <textarea
              className="w-full px-3 py-2 rounded-xl border border-gray-200 resize-none"
              rows={2}
              placeholder="可选"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
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
              className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-60 shrink-0"
            >
              {state === 'submitting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {state === 'submitting' ? '提交中…' : '确认提交'}
            </button>
          )}
        </div>

        {state === 'error' && <div className="px-5 pb-4 -mt-2 text-xs text-red-500">{errMsg}</div>}
      </div>
    </div>
  );
}

const inputCls = 'flex-1 min-w-0 px-2 h-8 rounded-lg border border-gray-200';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-800">{value}</div>
    </div>
  );
}

function NumStat({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-400">{label}</div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-transparent text-lg font-semibold text-gray-800 outline-none"
      />
    </div>
  );
}

interface JobSectionProps {
  title: string;
  rows: JobLine[];
  onPatch: (i: number, partial: Partial<JobLine>) => void;
  onDrop: (i: number) => void;
  onAdd: () => void;
}

function JobSection({ title, rows, onPatch, onDrop, onAdd }: JobSectionProps) {
  return (
    <EditSection title={title} onAdd={onAdd}>
      {rows.map((j, i) => (
        <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
          <input className={inputCls} placeholder="岗位名" value={j.name} onChange={(e) => onPatch(i, { name: e.target.value })} />
          <input className="w-28 px-2 h-8 rounded-lg border border-gray-200" placeholder="部门" value={j.department} onChange={(e) => onPatch(i, { department: e.target.value })} />
          <input
            type="number"
            min={0}
            className="w-16 px-2 h-8 rounded-lg border border-gray-200 text-center"
            value={j.qty}
            onChange={(e) => onPatch(i, { qty: Number(e.target.value) })}
          />
          <DropBtn onClick={() => onDrop(i)} />
        </div>
      ))}
    </EditSection>
  );
}

function EditSection({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500">{title}</span>
        <button onClick={onAdd} className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700">
          <Plus className="w-3.5 h-3.5" />添加
        </button>
      </div>
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 min-h-[40px]">{children}</div>
    </div>
  );
}

function DropBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 text-gray-300 hover:text-red-500 p-1">
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
