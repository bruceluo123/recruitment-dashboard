'use client';

import { FormEvent, useState } from 'react';
import { LockKeyhole } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, rememberMe }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '登录失败');
      const requested = new URLSearchParams(window.location.search).get('next') || '/';
      window.location.assign(requested.startsWith('/') && !requested.startsWith('//') ? requested : '/');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-12 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        <div className="mb-7 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">登录企鹅岛</h1>
            <p className="mt-1 text-sm text-slate-500">招聘数据仅对授权账号开放</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            账号
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              placeholder="请输入账号"
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              placeholder="请输入密码"
              required
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 accent-blue-600"
            />
            30天内免登录
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl bg-blue-600 font-semibold text-white shadow-md shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? '正在登录…' : '登录'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs leading-5 text-slate-400">麦满分与啵啵账号均可查看完整业务数据，操作仍按所属人记录。</p>
      </section>
    </main>
  );
}
