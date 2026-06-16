import Link from "next/link";

export const metadata = { title: "提交成功 · 易房拼拼" };

export default function DemandSuccessPage() {
  return (
    <div className="yfp-m">
      <main className="m-wrap m-success">
        <div className="seal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1>提交成功</h1>
        <p>我们已收到您的需求，专属顾问将在 24 小时内与您联系，请保持电话畅通。</p>
        <Link href="/m" className="m-back">
          继续看房
        </Link>
      </main>
    </div>
  );
}
