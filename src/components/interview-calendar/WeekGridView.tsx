'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Candidate } from '@/types/interview';
import { STAGE_COLORS } from '@/types/interview';

interface WeekGridViewProps {
  candidates: Candidate[];
  onCandidateClick: (id: string) => void;
}

const START_HOUR = 8;
const END_HOUR = 22;
const HOUR_HEIGHT = 56; // px
const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 取某日期所在周的周一 00:00 */
function mondayOf(base: Date): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function WeekGridView({ candidates, onCandidateClick }: WeekGridViewProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const today = new Date();

  // 当周内有面试时间的候选人
  const events = candidates
    .filter((c) => c.interviewDate)
    .map((c) => ({ c, d: new Date(c.interviewDate!) }))
    .filter(({ d }) => !Number.isNaN(d.getTime()) && d >= weekStart && d < new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000));

  const goWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  const rangeLabel = `${weekStart.getMonth() + 1}.${weekStart.getDate()} - ${days[6].getMonth() + 1}.${days[6].getDate()}`;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 周导航 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={() => goWeek(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-gray-800 min-w-[120px] text-center">{rangeLabel}</span>
          <button onClick={() => goWeek(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <button onClick={() => setWeekStart(mondayOf(new Date()))} className="px-3 h-8 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50">本周</button>
      </div>

      {/* 表头：星期 */}
      <div className="grid border-b border-gray-100" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <div key={i} className={cn('px-2 py-2 text-center border-l border-gray-100', isToday && 'bg-indigo-50')}>
              <p className={cn('text-xs', isToday ? 'text-indigo-500 font-semibold' : 'text-gray-400')}>{DAY_LABELS[i]}</p>
              <p className={cn('text-sm font-bold', isToday ? 'text-indigo-600' : 'text-gray-700')}>{d.getMonth() + 1}.{d.getDate()}</p>
            </div>
          );
        })}
      </div>

      {/* 时间网格 */}
      <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
        <div className="grid relative" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
          {/* 时间刻度列 */}
          <div className="relative">
            {hours.map((h) => (
              <div key={h} className="text-[10px] text-gray-400 text-right pr-1.5 -translate-y-1.5" style={{ height: HOUR_HEIGHT }}>
                {h}:00
              </div>
            ))}
          </div>

          {/* 7 天列 */}
          {days.map((day, di) => {
            const isToday = isSameDay(day, today);
            const dayEvents = events.filter(({ d }) => isSameDay(d, day));
            return (
              <div key={di} className={cn('relative border-l border-gray-100', isToday && 'bg-indigo-50/30')} style={{ height: hours.length * HOUR_HEIGHT }}>
                {/* 小时横线 */}
                {hours.map((h) => (
                  <div key={h} className="border-b border-gray-50" style={{ height: HOUR_HEIGHT }} />
                ))}
                {/* 事件块 */}
                {dayEvents.map(({ c, d }) => {
                  const minutesFromStart = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
                  const top = Math.max(0, (minutesFromStart / 60) * HOUR_HEIGHT);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onCandidateClick(c.id)}
                      className={cn('absolute left-1 right-1 rounded-lg px-2 py-1 text-left text-white shadow-sm hover:brightness-110 transition-all overflow-hidden', STAGE_COLORS[c.stage])}
                      style={{ top, minHeight: 40 }}
                      title={`${c.name} · ${c.jdTitle}`}
                    >
                      <p className="text-xs font-semibold leading-tight truncate">{pad(d.getHours())}:{pad(d.getMinutes())} {c.name}</p>
                      <p className="text-[10px] leading-tight truncate opacity-90">{c.jdTitle}</p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
