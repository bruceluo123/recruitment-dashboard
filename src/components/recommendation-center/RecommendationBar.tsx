'use client';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { CalendarPlus, CalendarCheck, CircleX, Pencil, Trash2, Phone, UserCog, Check, Sparkles, ChevronDown, ChevronRight, ChevronUp, Repeat, FileText, X, BriefcaseBusiness, Loader2 } from 'lucide-react';
import type { RepushItem } from '@/store/repush-store';
import { displayName, formatOrgDept } from '@/lib/repush-format';
import type { FeedbackCenterItem } from '@/types/feedback-center';

export type RecommendationFeedbackLabel = '未反馈' | '未通过' | '通过';

const FEEDBACK_META: Record<RecommendationFeedbackLabel, { label: RecommendationFeedbackLabel; className: string }> = {
  未反馈: { label: '未反馈', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  未通过: { label: '未通过', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  通过: { label: '通过', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};

export function recommendationFeedbackLabel(item?: FeedbackCenterItem): RecommendationFeedbackLabel {
  const status = item?.confirmedStatus;
  if (
    status === 'interview_failed'
    || status === 'screening_failed'
    || status === 'closed'
    || item?.sourceStatus === 'interview_failed'
    || item?.sourceStatus === 'screening_failed'
  ) {
    return '未通过';
  }
  if (
    status === 'interview_passed'
    || status === 'interview_pending'
    || item?.sourceStatus === 'scheduled'
  ) {
    return '通过';
  }
  return '未反馈';
}

function feedbackMeta(item?: FeedbackCenterItem): { label: RecommendationFeedbackLabel; className: string } {
  return FEEDBACK_META[recommendationFeedbackLabel(item)];
}

interface RecommendationBarProps {
  item: RepushItem;
  feedbackItem?: FeedbackCenterItem;
  candidateGroupCount?: number;
  candidateGroupExpanded?: boolean;
  candidateGroupItems?: RepushItem[];
  candidateGroupFeedbackItems?: (FeedbackCenterItem | undefined)[];
  onToggleCandidateGroup?: () => void;
  onSchedule: (item: RepushItem) => void;
  onEdit: (item: RepushItem) => void;
  onRepush: (item: RepushItem) => void;
  onOffer: (item: RepushItem) => void;
  offerRecorded?: boolean;
  interviewFailed?: boolean;
  onRemove: (id: string) => void;
  onUpdateContact: (id: string, contact?: string) => void;
}

export function RecommendationBar({ item, feedbackItem, candidateGroupCount, candidateGroupExpanded, candidateGroupItems, candidateGroupFeedbackItems, onToggleCandidateGroup, onSchedule, onEdit, onRepush, onOffer, offerRecorded, interviewFailed, onRemove, onUpdateContact }: RecommendationBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState(item.contact || '');
  const [showHighlights, setShowHighlights] = useState(false);
  const [lookingUpContact, setLookingUpContact] = useState(false);
  const [contactHint, setContactHint] = useState('');
  const base = displayName(item);
  const orgDept = formatOrgDept(item.organization, item.department);
  const isCollapsedCandidateGroup = Boolean(candidateGroupCount && candidateGroupCount > 1 && !candidateGroupExpanded);
  const jobTitle = item.jdTitle?.trim();
  const candidateTitle = item.candidateName?.trim()
    || (jobTitle && base.includes(jobTitle)
      ? base.slice(0, base.lastIndexOf(jobTitle)).replace(/[-_\s]+$/, '').trim()
      : base);
  const displayedJobTitle = jobTitle
    || (isCollapsedCandidateGroup ? item.department?.trim() || item.organization?.trim() : '');
  const groupDepartments = isCollapsedCandidateGroup
    ? Array.from(new Set((candidateGroupItems || []).map((groupItem) => groupItem.department || groupItem.organization).filter(Boolean)))
    : [];
  const groupDepartmentSummary = groupDepartments.length > 2
    ? `${groupDepartments.slice(0, 2).join('、')}等${groupDepartments.length}个部门`
    : groupDepartments.join('、');
  const groupHandlers = isCollapsedCandidateGroup
    ? Array.from(new Set((candidateGroupItems || []).map((groupItem) => groupItem.contactPerson?.trim()).filter(Boolean)))
    : [];
  const feedback = feedbackMeta(feedbackItem);
  const groupFeedbackCounts = candidateGroupFeedbackItems?.reduce<Record<RecommendationFeedbackLabel, number>>((counts, groupFeedbackItem) => {
    counts[feedbackMeta(groupFeedbackItem).label] += 1;
    return counts;
  }, { 未反馈: 0, 未通过: 0, 通过: 0 });
  const showGroupFeedbackSummary = Boolean(isCollapsedCandidateGroup && groupFeedbackCounts);
  const feedbackTitle = feedbackItem?.sourceSummary
    || feedbackItem?.auditConclusion
    || '反馈中心暂未识别到这条推荐的明确反馈';
  const scheduleLabel = item.interviewRound === '一面'
    ? '约二面'
    : item.interviewRound === '二面'
      ? '约三面'
      : item.interviewRound === '三面'
        ? '已三面'
        : item.interviewStatus === 'scheduled'
          ? '已约面'
          : '面试';

  useEffect(() => {
    if (!editingContact) setContactDraft(item.contact || '');
  }, [editingContact, item.contact]);

  const copyContact = async () => {
    if (!item.contact) return;
    try {
      await navigator.clipboard.writeText(item.contact);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const startEditContact = () => {
    setCopied(false);
    setContactDraft(item.contact || '');
    setEditingContact(true);
  };

  const lookupRobinContact = async () => {
    if (item.column !== 'a') {
      startEditContact();
      return;
    }
    setLookingUpContact(true);
    setContactHint('');
    try {
      const params = new URLSearchParams({
        name: item.candidateName || base.split('-')[0].trim(),
        job: item.jdTitle || '',
      });
      const response = await fetch(`/api/tg/robin-contact?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.status !== 'found' || !data.contact) {
        setContactHint(data.message || '未找到 Robin 私聊联系方式，请手动填写');
        startEditContact();
        return;
      }
      const contact = String(data.contact).trim();
      setContactDraft(contact);
      onUpdateContact(item.id, contact);
      setContactHint('');
    } catch {
      setContactHint('查询失败，请手动填写或稍后重试');
      startEditContact();
    } finally {
      setLookingUpContact(false);
    }
  };

  const cancelEditContact = () => {
    setContactDraft(item.contact || '');
    setEditingContact(false);
  };

  const saveContact = () => {
    const next = contactDraft.trim();
    onUpdateContact(item.id, next || undefined);
    setContactDraft(next);
    setEditingContact(false);
    setCopied(false);
  };

  const handleContactKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') saveContact();
    if (event.key === 'Escape') cancelEditContact();
  };

  return (
    <div className="group rounded-lg border border-slate-200/80 bg-white hover:border-blue-200 hover:shadow-[0_5px_16px_rgba(15,23,42,0.06)] transition-all">
      <div className="flex flex-col gap-2 px-4 py-2.5 lg:flex-row lg:items-center lg:gap-3">
      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {candidateGroupCount && candidateGroupCount > 1 && onToggleCandidateGroup && (
            <button
              type="button"
              aria-expanded={candidateGroupExpanded}
              onClick={onToggleCandidateGroup}
              title={candidateGroupExpanded ? '收起该候选人的岗位' : `展开查看 ${candidateGroupCount} 个岗位`}
              className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-colors ${candidateGroupExpanded
                ? 'bg-indigo-50 text-indigo-600 ring-indigo-200'
                : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:ring-indigo-200'
              }`}
            >
              {candidateGroupExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {candidateGroupCount}个岗位
            </button>
          )}
          {item.candidateCode && (
            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-medium shrink-0">{item.candidateCode}</span>
          )}
          <span className="inline-flex min-w-0 max-w-full items-center gap-2 sm:max-w-[min(560px,52vw)]">
            <span className="shrink-0 text-sm font-bold text-slate-900" title={candidateTitle}>
              {candidateTitle}
            </span>
            {displayedJobTitle && (
              <>
                <span className="h-4 w-px shrink-0 bg-slate-200" aria-hidden="true" />
                <span
                  className="inline-flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-slate-800"
                  title={displayedJobTitle}
                >
                  <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden="true" />
                  <span className="truncate">{displayedJobTitle}</span>
                </span>
              </>
            )}
          </span>
          {showGroupFeedbackSummary && groupFeedbackCounts ? (
            (['通过', '未通过', '未反馈'] as const).map((label) => groupFeedbackCounts[label] > 0 && (
              <span
                key={label}
                className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${FEEDBACK_META[label].className}`}
                title={`${groupFeedbackCounts[label]} 个岗位${label}`}
              >
                {label} {groupFeedbackCounts[label]}
              </span>
            ))
          ) : (
            <span
              className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${feedback.className}`}
              title={feedbackTitle}
            >
              {feedback.label}
            </span>
          )}
          {!isCollapsedCandidateGroup && item.interviewRound && (
            <span className="px-1.5 py-0.5 rounded-md bg-green-50 text-green-600 text-[11px] font-medium shrink-0">{item.interviewRound}</span>
          )}
          {!isCollapsedCandidateGroup && interviewFailed && (
            <span className="px-1.5 py-0.5 rounded-md bg-red-50 text-red-500 text-[11px] font-medium shrink-0">未通过</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
          {isCollapsedCandidateGroup ? (
            groupDepartmentSummary && <span className="text-indigo-500">涉及 {groupDepartmentSummary}</span>
          ) : (
            orgDept && <span className="text-indigo-500">{orgDept}</span>
          )}
          {isCollapsedCandidateGroup ? (
            groupHandlers.length > 0 && (
              <span className="flex items-center gap-0.5">
                <UserCog className="h-3 w-3" />{groupHandlers.length === 1 ? `对接 ${groupHandlers[0]}` : `${groupHandlers.length}位对接人`}
              </span>
            )
          ) : (
            item.contactPerson && <span className="flex items-center gap-0.5"><UserCog className="h-3 w-3" />对接 {item.contactPerson}</span>
          )}
        </div>
      </div>

      {/* 联系方式：空值可直接补充，有值点击复制 */}
      {editingContact ? (
        <div className="shrink-0">
          <div className="flex items-center gap-1 px-2 h-8 rounded-lg text-sm font-semibold text-indigo-600 bg-white border border-indigo-200 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <Phone className="w-4 h-4 text-indigo-400" />
          <input
            data-contact-editor={item.id}
            autoFocus
            value={contactDraft}
            onChange={(event) => setContactDraft(event.target.value)}
            onKeyDown={handleContactKeyDown}
            placeholder="手机号 / 邮箱 / 微信 / TG"
            className="w-[180px] bg-transparent outline-none text-sm font-semibold text-indigo-600 placeholder:text-gray-300"
          />
          <button data-contact-action="save" onClick={saveContact} className="p-0.5 rounded text-green-500 hover:bg-green-50" title="保存联系方式">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={cancelEditContact} className="p-0.5 rounded text-gray-400 hover:bg-gray-100" title="取消">
            <X className="w-3.5 h-3.5" />
          </button>
          </div>
          {contactHint && <p className="mt-1 max-w-[230px] text-[11px] leading-tight text-amber-600">{contactHint}</p>}
        </div>
      ) : item.contact ? (
        <div className="shrink-0 flex items-center gap-1">
          <button
            onClick={copyContact}
            title="点击复制联系方式"
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Phone className="w-4 h-4" />}
            <span className="max-w-[180px] truncate">{copied ? '已复制' : item.contact}</span>
          </button>
          <button
            data-contact-action="edit"
            onClick={startEditContact}
            title="编辑联系方式"
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          data-contact-action="add"
          onClick={lookupRobinContact}
          disabled={lookingUpContact}
          title={item.column === 'a' ? '从 Robin 私聊自动查找 Telegram 联系方式' : '补充联系方式'}
          className="shrink-0 flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium text-indigo-500 bg-white border border-dashed border-indigo-200 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-70 transition-colors"
        >
          {lookingUpContact ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
          补
        </button>
      )}

      {/* 操作区 */}
      <div className="flex w-full shrink-0 items-center gap-1.5 overflow-x-auto pb-1 lg:w-auto lg:pb-0">
        {item.resumeUrl && (
          <a
            href={item.resumeUrl} target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            title={item.resumeFileName ? `下载简历：${item.resumeFileName}` : '下载简历'}
          >
            <FileText className="w-3.5 h-3.5" />
            简历
          </a>
        )}
        {item.highlights && (
          <button
            onClick={() => setShowHighlights((v) => !v)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
            title="查看简历亮点"
          >
            <Sparkles className="w-3.5 h-3.5" />
            亮点
            {showHighlights ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
        {!isCollapsedCandidateGroup && (interviewFailed ? (
          <span className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-500" title="面试未通过">
            <CircleX className="w-3.5 h-3.5" />未通过
          </span>
        ) : item.interviewStatus === 'scheduled' ? (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
            title="已约面，点击可改期"
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            {scheduleLabel}
          </button>
        ) : (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            title="约面并同步面试日历"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            面试
          </button>
        ))}
        {!isCollapsedCandidateGroup && <button
          onClick={() => onOffer(item)}
          className={`flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border transition-colors ${offerRecorded ? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'}`}
          title={offerRecorded ? '查看或修改 Offer 信息' : '记录 Offer 信息'}
        >
          <BriefcaseBusiness className="w-3.5 h-3.5" />
          {offerRecorded ? '已Offer' : 'Offer'}
        </button>}
        {!isCollapsedCandidateGroup && <button
          onClick={() => onRepush(item)}
          className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors"
          title="复推到其他岗位（新建一条推荐）"
        >
          <Repeat className="w-3.5 h-3.5" />
          复推
        </button>}
        {!isCollapsedCandidateGroup && <button
          onClick={() => onEdit(item)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
          title="编辑"
        >
          <Pencil className="w-4 h-4" />
        </button>}
        {!isCollapsedCandidateGroup && (confirming ? (
          <div className="flex items-center gap-1">
            <button onClick={() => { onRemove(item.id); setConfirming(false); }} className="px-2 h-8 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">确认删除</button>
            <button onClick={() => setConfirming(false)} className="px-2 h-8 rounded-lg text-xs text-gray-500 hover:bg-gray-100">取消</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ))}
      </div>
      </div>

      {/* 简历亮点展开面板 */}
      {showHighlights && item.highlights && (
        <div className="px-4 pb-3 pt-0">
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />简历亮点（仅内部可见）
            </p>
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">{item.highlights}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
