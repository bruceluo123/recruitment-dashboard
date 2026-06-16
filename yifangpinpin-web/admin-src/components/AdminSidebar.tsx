"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";

type Item = {
  href?: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  soon?: boolean;
};

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminSidebar({
  propCount,
  demandCount,
  loanAppCount,
}: {
  propCount: number;
  demandCount: number;
  loanAppCount: number;
}) {
  const pathname = usePathname();

  const core: Item[] = [
    {
      href: "/admin",
      label: "仪表盘",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      ),
    },
    {
      href: "/admin/properties",
      label: "房源管理",
      badge: propCount,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      ),
    },
    {
      label: "匹配工作台",
      soon: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="7" cy="7" r="3.2" />
          <circle cx="17" cy="17" r="3.2" />
          <path d="M10 7h5a2 2 0 0 1 2 2v5" />
          <path d="M14 17H9a2 2 0 0 1-2-2v-5" />
        </svg>
      ),
    },
    {
      href: "/admin/customers",
      label: "客户 CRM",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="18" cy="9" r="2.4" />
          <path d="M21 19c0-2.4-1.6-4.2-3.6-4.8" />
        </svg>
      ),
    },
    {
      href: "/admin/demands",
      label: "需求池",
      badge: demandCount,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 4h14v16l-7-3-7 3z" />
        </svg>
      ),
    },
  ];

  const finance: Item[] = [
    {
      href: "/admin/loan-products",
      label: "贷款产品",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <circle cx="8" cy="14.5" r="1.4" />
        </svg>
      ),
    },
    {
      href: "/admin/loan-applications",
      label: "贷款咨询",
      badge: loanAppCount,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      ),
    },
    {
      label: "征信预审",
      soon: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 3v5h5" />
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      ),
    },
  ];

  const renderItem = (it: Item) => {
    if (it.soon || !it.href) {
      return (
        <span key={it.label} className="item soon">
          {it.icon}
          {it.label}
          <span className="tag-soon">即将上线</span>
        </span>
      );
    }
    return (
      <Link key={it.label} href={it.href} className={isActive(pathname, it.href) ? "on" : undefined}>
        {it.icon}
        {it.label}
        {it.badge ? <span className="badge">{it.badge}</span> : null}
      </Link>
    );
  };

  return (
    <aside className="yfp-side">
      <div className="yfp-side-brand">
        <span className="yfp-side-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="易房拼拼" width={40} height={40} />
        </span>
        <div>
          <div className="yfp-side-name">
            易房<b>拼拼</b>
          </div>
          <div className="yfp-side-tag">经纪人工作台</div>
        </div>
      </div>

      <div className="yfp-side-sect">业务核心</div>
      <nav className="yfp-nav">{core.map(renderItem)}</nav>

      <div className="yfp-side-sect">地产金融</div>
      <nav className="yfp-nav">{finance.map(renderItem)}</nav>

      <div className="yfp-side-foot">
        <div className="yfp-side-user">
          <span className="yfp-avatar">罗</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="u-name">罗经理</div>
            <div className="u-role">超级管理员</div>
          </div>
        </div>
        <form action={signOut}>
          <button type="submit" className="yfp-logout">
            退出登录
          </button>
        </form>
      </div>
    </aside>
  );
}
