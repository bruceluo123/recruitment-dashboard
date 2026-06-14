"use client";

import { usePathname } from "next/navigation";

const CRUMB: { match: (p: string) => boolean; label: string }[] = [
  { match: (p) => p === "/admin", label: "仪表盘" },
  { match: (p) => p.startsWith("/admin/properties"), label: "房源管理" },
  { match: (p) => p.startsWith("/admin/customers"), label: "客户 CRM" },
  { match: (p) => p.startsWith("/admin/demands"), label: "需求池" },
];

export function AdminTopbar() {
  const pathname = usePathname();
  const current = CRUMB.find((c) => c.match(pathname))?.label ?? "工作台";

  return (
    <header className="yfp-topbar">
      <div className="yfp-crumb">
        易房拼拼 / <b>{current}</b>
      </div>
      <div className="yfp-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4-4" />
        </svg>
        <input placeholder="搜索房源 / 客户 / 需求…" />
      </div>
      <button className="yfp-icon-btn" type="button" aria-label="通知">
        <span className="dot" />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      </button>
    </header>
  );
}
