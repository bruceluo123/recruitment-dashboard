'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { RepushItem, RepushColumnId } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import {
  buildRemoteRecord,
  todaysRecommendations,
  todaysInterviews,
  scheduledToday,
  findExistingReportId,
  submitRemoteRecord,
  makeJobKey,
  isInterviewPassed,
  INTERVIEW_PENDING,
  INTERVIEW_STATUS_OPTIONS,
  emptyOnboardLine,
  ONBOARD_WORKMODE_OPTIONS,
  ONBOARD_CHANNEL_OPTIONS,
  ONBOARD_STATUS_OPTIONS,
  REPORT_CHANNEL_OPTIONS,
  REPORT_PRIORITY_OPTIONS,
  pickRandomChannel,
  pickRandomPriority,
  spreadDefaultChannels,
  type JobLine,
  type ScheduledLine,
  type InterviewLine,
  type OnboardLine,
  type RemoteRecord,
} from '@/lib/daily-report';
import { useEscapeClose } from '@/hooks/useEscapeClose';

interface DailyReportModalProps {
  column: RepushColumnId;     // 当前查看的推荐人列（作为日报数据来源）
  name: string;               // 录入人名（即该列名，如「麦满分」）
  items: RepushItem[];        // 全部推荐记录
  candidates: Candidate[];    // 全部面试候选人
  onClose: () => void;
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error';

const sum = (arr: JobLine[]) => arr.reduce((s, j) => s + (Number(j.qty) || 0), 0);
const countPriority = <T extends { priority?: string }>(rows: T[], priority: string) => rows.filter((row) => row.priority === priority).length;
const sumPriority = (rows: JobLine[], priority: string) => rows.reduce((total, row) => total + (row.priority === priority ? Number(row.qty) || 0 : 0), 0);

// ── 草稿自动暂存：误关/切走/点到外面时不丢失填写，按「录入人 + 日期」隔离，提交成功后清除 ──
const DRAFT_VERSION = 3;
interface DraftState {
  v: number;
  recommend: JobLine[]; cv: JobLine[]; screenNew: number;
  cvTotal?: number; recommendTotal?: number; scheduledInt?: number; interviewTotal?: number; offerTotal?: number; onboardTotal?: number;
  scheduled: ScheduledLine[]; interview: InterviewLine[];
  offer: JobLine[]; onboard: OnboardLine[]; remark: string;
}
const draftKey = (name: string, date: string) => `recruitai-daily-report-draft:${name}:${date}`;
function loadDraft(name: string, date: string): DraftState | null {
  try {
    const raw = localStorage.getItem(draftKey(name, date));
    if (!raw) return null;
    const d = JSON.parse(raw) as DraftState;
    return d && d.v === DRAFT_VERSION ? d : null;
  } catch { return null; }
}
function saveDraft(name: string, date: string, d: Omit<DraftState, 'v'>): void {
  try { localStorage.setItem(draftKey(name, date), JSON.stringify({ v: DRAFT_VERSION, ...d })); } catch { /* 存储不可用时忽略 */ }
}
function clearDraft(name: string, date: string): void {
  try { localStorage.removeItem(draftKey(name, date)); } catch { /* 忽略 */ }
}
function normalizeDraft(d: DraftState | null): DraftState | null {
  if (!d) return null;
  return {
    ...d,
    recommend: spreadDefaultChannels(d.recommend),
    cv: spreadDefaultChannels(d.cv),
    scheduled: spreadDefaultChannels(d.scheduled),
    interview: spreadDefaultChannels(d.interview),
    offer: spreadDefaultChannels(d.offer),
  };
}
function normalizeAutoRecord(record: RemoteRecord): RemoteRecord {
  return {
    ...record,
    recommendDetail: spreadDefaultChannels(record.recommendDetail),
    cvDetail: spreadDefaultChannels(record.cvDetail),
    scheduledDetail: spreadDefaultChannels(record.scheduledDetail),
    interviewDetail: spreadDefaultChannels(record.interviewDetail),
    offerDetail: spreadDefaultChannels(record.offerDetail),
  };
}

const localDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 把本系统今日数据组装成看板站日报，可编辑预览后一键提交到团队数据看板。 */
export function DailyReportModal({ column, name, items, candidates, onClose }: DailyReportModalProps) {
  const todayStr = useMemo(() => localDateStr(new Date()), []);

  // 构造某一天的「参考时刻」（当天正午，避免时区把日期算偏）。
  const refFor = (dateStr: string) => new Date(`${dateStr}T12:00:00`);

  // 计算某一天的自动初稿：按该天过滤推荐 / 约面 / 业务面试，组装成日报记录。
  const computeAutoDraft = (dateStr: string): RemoteRecord => {
    const r = refFor(dateStr);
    const recommendations = todaysRecommendations(items, r, column);
    const interviews = todaysInterviews(candidates, r, column);
    const sched = scheduledToday(candidates, r, column);
    return normalizeAutoRecord(buildRemoteRecord({ date: dateStr, name, recommendations, interviews, scheduled: sched }));
  };

  // 选中日期：默认今天，可切到昨天/前几天——拉取并录入「那一天」的数据，日报日期也随之改为那天。
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // 初始化（针对今天）：优先今天已存的未提交草稿，否则用自动初稿。仅执行一次。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => ({ auto: computeAutoDraft(todayStr), saved: normalizeDraft(loadDraft(name, todayStr)) }), []);

  // 提交所用记录 id：按天各自独立，避免不同日期共用 id 导致相互覆盖。
  const [recordId, setRecordId] = useState<string>(initial.auto.id);
  const [restored, setRestored] = useState(!!initial.saved);

  const [recommend, setRecommend] = useState<JobLine[]>(initial.saved?.recommend ?? []);
  const [cv, setCv] = useState<JobLine[]>(initial.saved?.cv ?? []);
  const [cvTotal, setCvTotal] = useState<number>(initial.saved?.cvTotal ?? initial.auto.cvTotal);
  const [screenNew, setScreenNew] = useState<number>(initial.saved?.screenNew ?? initial.auto.screenNew);
  const [recommendTotal, setRecommendTotal] = useState<number>(initial.saved?.recommendTotal ?? initial.auto.recommendTotal);
  const [scheduled, setScheduled] = useState<ScheduledLine[]>(initial.saved?.scheduled ?? []);
  const [scheduledInt, setScheduledInt] = useState<number>(initial.saved?.scheduledInt ?? initial.auto.scheduledInt);
  const [interview, setInterview] = useState<InterviewLine[]>(initial.saved?.interview ?? []);
  const [interviewTotal, setInterviewTotal] = useState<number>(initial.saved?.interviewTotal ?? initial.auto.interviewTotal);
  // Offer 申请 / 入职：不自动抓取，默认为空，由使用者手动填写后随日报一并提交。
  const [offer, setOffer] = useState<JobLine[]>(initial.saved?.offer ?? []);
  const [offerTotal, setOfferTotal] = useState<number>(initial.saved?.offerTotal ?? initial.auto.offer);
  const [onboard, setOnboard] = useState<OnboardLine[]>(initial.saved?.onboard ?? []);
  const [onboardTotal, setOnboardTotal] = useState<number>(initial.saved?.onboardTotal ?? initial.auto.onboard);
  const [remark, setRemark] = useState<string>(initial.saved?.remark ?? initial.auto.remark);

  const [state, setState] = useState<SubmitState>('idle');
  const [errMsg, setErrMsg] = useState('');
  // 是否有用户实际编辑（含已恢复的草稿）。仅在此为真时才自动暂存，
  // 避免「只打开没填」也写入草稿、导致下次误弹「已恢复」。
  const [dirty, setDirty] = useState(!!initial.saved);
  const markDirty = () => setDirty(true);

  // 把某一天的数据套用到编辑态：优先该天已存草稿，否则用自动初稿。
  const applyDate = (dateStr: string) => {
    const auto = computeAutoDraft(dateStr);
    const saved = normalizeDraft(loadDraft(name, dateStr));
    setRecordId(auto.id);
    setRecommend(saved?.recommend ?? []);
    setCv(saved?.cv ?? []);
    setCvTotal(saved?.cvTotal ?? auto.cvTotal);
    setScreenNew(saved?.screenNew ?? auto.screenNew);
    setRecommendTotal(saved?.recommendTotal ?? auto.recommendTotal);
    setScheduled(saved?.scheduled ?? []);
    setScheduledInt(saved?.scheduledInt ?? auto.scheduledInt);
    setInterview(saved?.interview ?? []);
    setInterviewTotal(saved?.interviewTotal ?? auto.interviewTotal);
    setOffer(saved?.offer ?? []);
    setOfferTotal(saved?.offerTotal ?? auto.offer);
    setOnboard(saved?.onboard ?? []);
    setOnboardTotal(saved?.onboardTotal ?? auto.onboard);
    setRemark(saved?.remark ?? auto.remark);
    setRestored(!!saved);
    setDirty(!!saved);
    setState('idle');
    setErrMsg('');
  };

  const handleDateChange = (newDate: string) => {
    if (!newDate || newDate === selectedDate) return;
    setSelectedDate(newDate);
    applyDate(newDate);
  };

  // 自动暂存：用户编辑后，任一可编辑字段变化即写入 localStorage（按「录入人 + 选中日期」隔离，提交成功后不再写）。
  // 由此实现「切出去 / 点到别的 / 突然关掉」都能保留填写，重开自动恢复。
  useEffect(() => {
    if (state === 'done' || !dirty) return;
    saveDraft(name, selectedDate, {
      recommend,
      cv,
      cvTotal,
      screenNew,
      recommendTotal,
      scheduled,
      scheduledInt,
      interview,
      interviewTotal,
      offer,
      offerTotal,
      onboard,
      onboardTotal,
      remark,
    });
  }, [recommend, cv, cvTotal, screenNew, recommendTotal, scheduled, scheduledInt, interview, interviewTotal, offer, offerTotal, onboard, onboardTotal, remark, state, dirty, name, selectedDate]);

  // 关闭即可，填写已自动暂存，重开会恢复。
  const requestClose = () => onClose();
  useEscapeClose(requestClose);

  // 放弃已恢复的草稿，回到当天系统自动生成的初稿（并清除暂存）。
  const discardDraft = () => {
    clearDraft(name, selectedDate);
    const auto = computeAutoDraft(selectedDate);
    setRecordId(auto.id);
    setRecommend([]);
    setCv([]);
    setCvTotal(auto.cvTotal);
    setScreenNew(auto.screenNew);
    setRecommendTotal(auto.recommendTotal);
    setScheduled([]);
    setScheduledInt(auto.scheduledInt);
    setInterview([]);
    setInterviewTotal(auto.interviewTotal);
    setOffer([]);
    setOfferTotal(auto.offer);
    setOnboard([]);
    setOnboardTotal(auto.onboard);
    setRemark(auto.remark);
    setRestored(false);
    setDirty(false); // 放弃后回到初稿，且不再自动暂存（除非重新编辑）
  };

  // 业务面试 pass / pending 统计
  const passCount = interview.filter((v) => isInterviewPassed(v.status)).length;
  const pendingCount = interview.length - passCount;
  const hasData = recommendTotal > 0 || cvTotal > 0 || scheduledInt > 0 || interviewTotal > 0 || offerTotal > 0 || onboardTotal > 0;

  const buildFinal = (): RemoteRecord => {
    const cvRows = cv.filter((j) => j.name.trim()) || [];
    const recommendRows = recommend.filter((j) => j.name.trim()) || [];
    const scheduledRows = scheduled.filter((s) => s.job.trim() || s.person.trim());
    const interviewRows = interview.filter((v) => v.name.trim() || v.person.trim());
    const offerRows = offer.filter((j) => j.name.trim());
    const onboardRows = onboard.filter((o) => o.jobName.trim() || o.candidateName.trim());

    return {
      id: recordId,
      date: selectedDate,
      name,
      cvDetail: cvRows.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
      cvTotal: Number(cvTotal) || sum(cvRows),
      screenNew: Number(screenNew) || 0,
      recommendDetail: recommendRows.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
      recommendTotal: Number(recommendTotal) || sum(recommendRows),
      scheduledDetail: scheduledRows,
      scheduledInt: Number(scheduledInt) || scheduledRows.length,
      interviewDetail: interviewRows.map((v) => ({ ...v, jobKey: makeJobKey(v.name, v.department) })),
      interviewTotal: Number(interviewTotal) || interviewRows.length,
      offer: Number(offerTotal) || sum(offerRows),
      offerDetail: offerRows.map((j) => ({ ...j, qty: Number(j.qty) || 0, jobKey: makeJobKey(j.name, j.department) })),
      onboard: Number(onboardTotal) || onboardRows.length,
      onboardDetail: onboardRows.map((o) => ({ ...o, jobKey: makeJobKey(o.jobName, o.department) } as OnboardLine & { jobKey: string })),
      remark,
      p0rec: sumPriority(recommendRows, 'p0'),
      p1rec: sumPriority(recommendRows, 'p1'),
      p2rec: sumPriority(recommendRows, 'p2'),
      p0sched: countPriority(scheduledRows, 'p0'),
      p1sched: countPriority(scheduledRows, 'p1'),
      p2sched: countPriority(scheduledRows, 'p2'),
      p0int: countPriority(interviewRows, 'p0'),
      p1int: countPriority(interviewRows, 'p1'),
      p2int: countPriority(interviewRows, 'p2'),
      p0onboard: countPriority(onboardRows, 'p0'),
      p1onboard: countPriority(onboardRows, 'p1'),
      p2onboard: countPriority(onboardRows, 'p2'),
    };
  };

  const handleSubmit = async () => {
    setState('submitting');
    setErrMsg('');
    try {
      const record = buildFinal();
      const existingId = await findExistingReportId(selectedDate, name);
      await submitRemoteRecord(existingId ? { ...record, id: existingId } : record);
      clearDraft(name, selectedDate); // 提交成功：清除暂存草稿
      setState('done');
    } catch (error: unknown) {
      setState('error');
      setErrMsg(error instanceof Error ? error.message : '提交失败，请重试');
    }
  };

  // 通用：更新/删除/新增某个明细数组里的一行（任一操作都标记为已编辑）
  const patch = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, partial: Partial<T>) => {
    markDirty();
    setter((arr) => arr.map((row, idx) => (idx === i ? { ...row, ...partial } : row)));
  };
  const drop = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number) => {
    markDirty();
    setter((arr) => arr.filter((_, idx) => idx !== i));
  };

  const addJob = (setter: React.Dispatch<React.SetStateAction<JobLine[]>>) => {
    markDirty();
    setter((arr) => [...arr, { name: '', department: '', jobKey: '', qty: 1, channel: pickRandomChannel(), priority: pickRandomPriority() }]);
  };

  // 推荐 ↔ 收取「渠道 / 优先级」联动：同岗位（jobKey）改一处，另一处同步。数量各自独立不联动。
  const syncCP = (setter: React.Dispatch<React.SetStateAction<JobLine[]>>, jobKey: string, p: Partial<JobLine>) => {
    const cp: Partial<JobLine> = {};
    if ('channel' in p) cp.channel = p.channel;
    if ('priority' in p) cp.priority = p.priority;
    if (!Object.keys(cp).length) return;
    setter((arr) => arr.map((r) => makeJobKey(r.name, r.department) === jobKey ? { ...r, ...cp } : r));
  };
  const patchRecommend = (i: number, p: Partial<JobLine>) => {
    patch(setRecommend, i, p);
    syncCP(setCv, makeJobKey(recommend[i].name, recommend[i].department), p);
  };
  const patchCv = (i: number, p: Partial<JobLine>) => {
    patch(setCv, i, p);
    syncCP(setRecommend, makeJobKey(cv[i].name, cv[i].department), p);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-base font-semibold text-gray-800 shrink-0">
              一键看板 · <span className="text-indigo-600">{name}</span>
            </h3>
            {selectedDate !== todayStr && (
              <span className="text-[11px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 whitespace-nowrap">补录 · 非今日</span>
            )}
          </div>
          <button onClick={requestClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {restored && state !== 'done' && (
            <div className="flex items-center justify-between gap-2 text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />已恢复上次未提交的填写
              </span>
              <button onClick={discardDraft} className="text-xs text-indigo-500 hover:text-indigo-700 underline shrink-0">放弃，重新生成</button>
            </div>
          )}

          {!hasData && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              今日（{name}）暂无推荐或约面数据，可手动添加或直接提交空日报。
            </div>
          )}

          <ReportBlock title="基础信息">
            <div className="grid grid-cols-2 gap-3">
              <Field label="日期">
                <input
                  type="date"
                  value={selectedDate}
                  max={todayStr}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className={wideInputCls}
                />
              </Field>
              <Field label="录入人">
                <input value={name} readOnly className={wideInputCls + ' bg-gray-50 text-gray-500'} />
              </Field>
            </div>
          </ReportBlock>

          <ReportBlock title="简历收取与推荐">
            <div className="grid grid-cols-3 gap-3">
              <NumField label="新收简历总数" value={cvTotal} onChange={(v) => { markDirty(); setCvTotal(v); }} />
              <NumField label="新增沟通人数（初筛）" value={screenNew} onChange={(v) => { markDirty(); setScreenNew(v); }} />
              <NumField label="推荐总数（符合JD）" value={recommendTotal} onChange={(v) => { markDirty(); setRecommendTotal(v); }} />
            </div>
            <div className="text-xs text-gray-400">只需填写总数即可，岗位明细选填。</div>
            <JobSection
              title="各岗位收取明细（选填）"
              rows={cv}
              onPatch={patchCv}
              onDrop={(i) => drop(setCv, i)}
              onAdd={() => addJob(setCv)}
            />
            <JobSection
              title="各岗位推荐明细（选填）"
              rows={recommend}
              onPatch={patchRecommend}
              onDrop={(i) => drop(setRecommend, i)}
              onAdd={() => addJob(setRecommend)}
            />
          </ReportBlock>

          <ReportBlock title="业务面试与 Offer">
            <div className="grid grid-cols-3 gap-3">
              <NumField label="约面数量" value={scheduledInt} onChange={(v) => { markDirty(); setScheduledInt(v); }} />
              <NumField label="当天业务面试数量" value={interviewTotal} onChange={(v) => { markDirty(); setInterviewTotal(v); }} />
              <NumField label="Offer 申请数" value={offerTotal} onChange={(v) => { markDirty(); setOfferTotal(v); }} />
            </div>
            <div className="text-xs text-gray-400">Offer 只需填写数量即可，岗位明细选填。</div>

            <EditSection title="约面明细" onAdd={() => { markDirty(); setScheduledInt((v) => Math.max(v, scheduled.length + 1)); setScheduled((a) => [...a, { job: '', person: '', date: selectedDate, time: '', tz: '北京时间', channel: '', priority: pickRandomPriority() }]); }}>
              {scheduled.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                  <input className={inputCls} placeholder="岗位名称" value={s.job} onChange={(e) => patch(setScheduled, i, { job: e.target.value })} />
                  <input className={inputCls} placeholder="姓名" value={s.person} onChange={(e) => patch(setScheduled, i, { person: e.target.value })} />
                  <PrioritySelect value={s.priority} onChange={(v) => patch(setScheduled, i, { priority: v })} />
                  <input type="date" className="w-32 px-2 h-8 rounded-lg border border-gray-200" value={s.date} onChange={(e) => patch(setScheduled, i, { date: e.target.value })} />
                  <input type="time" className="w-24 px-2 h-8 rounded-lg border border-gray-200" value={s.time} onChange={(e) => patch(setScheduled, i, { time: e.target.value })} />
                  <select className="w-24 px-2 h-8 rounded-lg border border-gray-200 bg-white text-xs" value={s.tz} onChange={(e) => patch(setScheduled, i, { tz: e.target.value })}>
                    <option value="北京时间">北京时间</option>
                    <option value="伦敦时间">伦敦时间</option>
                  </select>
                  <DropBtn onClick={() => drop(setScheduled, i)} />
                </div>
              ))}
            </EditSection>

            <EditSection
              title={`业务面试明细（选填，通过 ${passCount} · 待反馈 ${pendingCount}）`}
              onAdd={() => { markDirty(); setInterviewTotal((v) => Math.max(v, interview.length + 1)); setInterview((a) => [...a, { name: '', department: '', jobKey: '', person: '', status: INTERVIEW_PENDING, channel: pickRandomChannel(), priority: pickRandomPriority() }]); }}
            >
              {interview.map((v, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                  <input className={inputCls} placeholder="搜索或输入岗位名称..." value={v.name} onChange={(e) => patch(setInterview, i, { name: e.target.value })} />
                  <input className={inputCls} placeholder="姓名" value={v.person} onChange={(e) => patch(setInterview, i, { person: e.target.value })} />
                  <ChannelSelect value={v.channel} onChange={(x) => patch(setInterview, i, { channel: x })} />
                  <PrioritySelect value={v.priority} onChange={(x) => patch(setInterview, i, { priority: x })} />
                  <select className="w-24 px-2 h-8 rounded-lg border border-gray-200 bg-white text-xs" value={v.status} onChange={(e) => patch(setInterview, i, { status: e.target.value })}>
                    {INTERVIEW_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <DropBtn onClick={() => drop(setInterview, i)} />
                </div>
              ))}
            </EditSection>

            <JobSection
              title="Offer 申请明细（选填）"
              rows={offer}
              onPatch={(i, p) => patch(setOffer, i, p)}
              onDrop={(i) => drop(setOffer, i)}
              onAdd={() => { setOfferTotal((v) => Math.max(v, sum(offer) + 1)); addJob(setOffer); }}
            />
          </ReportBlock>

          <ReportBlock title="入职">
            <div className="max-w-xs">
              <NumField label="当天入职数" value={onboardTotal} onChange={(v) => { markDirty(); setOnboardTotal(v); }} />
            </div>
            <div className="text-xs text-gray-400">填写数量后，请补充入职明细。</div>
            <EditSection
              title="入职人选详情"
              onAdd={() => { markDirty(); setOnboardTotal((v) => Math.max(v, onboard.length + 1)); setOnboard((a) => [...a, emptyOnboardLine(selectedDate)]); }}
            >
              {onboard.map((o, i) => (
                <div key={i} className="px-2 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-400">入职人选 #{i + 1}</span>
                    <DropBtn onClick={() => drop(setOnboard, i)} />
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    <input className={gridInput} placeholder="岗位名称" value={o.jobName} onChange={(e) => patch(setOnboard, i, { jobName: e.target.value })} />
                    <input className={gridInput} placeholder="简历名" value={o.candidateName} onChange={(e) => patch(setOnboard, i, { candidateName: e.target.value, ...(o.nickname === o.candidateName ? { nickname: e.target.value } : {}) })} />
                    <input className={gridInput} placeholder="花名" value={o.nickname} onChange={(e) => patch(setOnboard, i, { nickname: e.target.value })} />
                    <input className={gridInput} placeholder="编制组织" value={o.department} onChange={(e) => patch(setOnboard, i, { department: e.target.value })} />

                    <input className={gridInput} placeholder="面试官" value={o.interviewer} onChange={(e) => patch(setOnboard, i, { interviewer: e.target.value })} />
                    <input className={gridInput} placeholder="学历" value={o.education} onChange={(e) => patch(setOnboard, i, { education: e.target.value })} />
                    <input className={gridInput} placeholder="寻英渠道" value={o.recruitTeam} onChange={(e) => patch(setOnboard, i, { recruitTeam: e.target.value })} />
                    <select className={gridInput + ' bg-white'} value={ONBOARD_CHANNEL_OPTIONS.includes(o.source as typeof ONBOARD_CHANNEL_OPTIONS[number]) ? o.source : ''} onChange={(e) => patch(setOnboard, i, { source: e.target.value })}>
                      <option value="">招聘来源</option>
                      {ONBOARD_CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <input className={gridInput} placeholder="招聘组长" value={o.teamLead} onChange={(e) => patch(setOnboard, i, { teamLead: e.target.value })} />
                    <input className={gridInput} placeholder="招聘主管" value={o.manager} onChange={(e) => patch(setOnboard, i, { manager: e.target.value })} />
                    <input className={gridInput} placeholder="试用期月薪" value={o.probationSalary} onChange={(e) => patch(setOnboard, i, { probationSalary: e.target.value })} />
                    <input className={gridInput} placeholder="转正后月薪" value={o.regularSalary} onChange={(e) => patch(setOnboard, i, { regularSalary: e.target.value })} />

                    <input className={gridInput} placeholder="到岗评分 如8.5" value={o.score} onChange={(e) => patch(setOnboard, i, { score: e.target.value })} />
                    <select className={gridInput + ' bg-white'} value={o.workMode} onChange={(e) => patch(setOnboard, i, { workMode: e.target.value })}>
                      <option value="">到岗方式</option>
                      {ONBOARD_WORKMODE_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                    <select className={gridInput + ' bg-white'} value={o.employmentStatus} onChange={(e) => patch(setOnboard, i, { employmentStatus: e.target.value })}>
                      {ONBOARD_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input type="date" className={gridInput} value={o.onboardDate} onChange={(e) => patch(setOnboard, i, { onboardDate: e.target.value })} />
                    <select className={gridInput + ' bg-white'} value={o.priority} onChange={(e) => patch(setOnboard, i, { priority: e.target.value })}>
                      <option value="">优先级</option>
                      {REPORT_PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </EditSection>
          </ReportBlock>

          <div>
            <div className="text-xs font-medium text-gray-500 mb-1.5">备注</div>
            <textarea
              className="w-full px-3 py-2 rounded-xl border border-gray-200 resize-none"
              rows={2}
              placeholder="可选"
              value={remark}
              onChange={(e) => { markDirty(); setRemark(e.target.value); }}
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
const wideInputCls = 'w-full px-3 h-10 rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-300';
// 入职明细网格里的紧凑输入框（4 列布局，字段较多）
const gridInput = 'min-w-0 px-2 h-8 rounded-lg border border-gray-200 text-xs';

function ReportBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
      <div className="text-sm font-semibold text-indigo-600 pb-2 border-b border-gray-100">{title}</div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={wideInputCls}
      />
    </Field>
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
        <div key={i} className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
          <input className={inputCls} placeholder="岗位名" value={j.name} onChange={(e) => onPatch(i, { name: e.target.value })} />
          <input className="w-24 px-2 h-8 rounded-lg border border-gray-200" placeholder="部门" value={j.department} onChange={(e) => onPatch(i, { department: e.target.value })} />
          <input
            type="number"
            min={0}
            className="w-14 px-2 h-8 rounded-lg border border-gray-200 text-center"
            value={j.qty}
            onChange={(e) => onPatch(i, { qty: Number(e.target.value) })}
          />
          <ChannelSelect value={j.channel} onChange={(v) => onPatch(i, { channel: v })} />
          <PrioritySelect value={j.priority} onChange={(v) => onPatch(i, { priority: v })} />
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

// 渠道下拉：各明细通用（与数据看板渠道一致）
function ChannelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="w-24 px-2 h-8 rounded-lg border border-gray-200 bg-white text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">渠道</option>
      {REPORT_CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// 优先级下拉：各明细通用（存 p0/p1/p2，显示 P0/P1/P2）
function PrioritySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="w-20 px-2 h-8 rounded-lg border border-gray-200 bg-white text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">优先级</option>
      {REPORT_PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>
  );
}
