'use client';

import Link from 'next/link';
import { useState } from 'react';

const modules = [
  { title: '界面扫描', detail: '分析页面结构、组件边界、响应式断点与潜在布局问题。', icon: '⌕', status: '基础能力' },
  { title: '设计规范', detail: '沉淀颜色、字体、间距、圆角、玻璃材质与交互状态。', icon: '◈', status: 'Skill 已接入' },
  { title: '视觉检测', detail: '通过浏览器采集桌面、平板和手机的 Light / Dark 截图。', icon: '▧', status: '截图工具已提交' },
  { title: '自动修复', detail: '根据视觉差异定位代码并生成受控修复，当前尚未开放自动写入。', icon: '⌘', status: '待接入' },
  { title: '质量验收', detail: '汇总类型检查、Lint、单元测试、构建和 Preview 证据。', icon: '✓', status: '验收规范已建立' },
  { title: '设备验收', detail: '区分 Chromium 自动化与真实 iPhone / iPad Safari 测试。', icon: '▣', status: '验收规范已建立' },
];

export default function UIStudioPage() {
  const [target, setTarget] = useState('/');
  const [note, setNote] = useState('');

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 pb-20 pt-8 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.24em] text-[var(--muted)]">LIBRETV / AUTONOMOUS UI ENGINEERING</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">AI 界面工作台</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">统一管理页面分析、设计规范、视觉检查和质量验收。当前版本先提供工作台入口与可验证的浏览器截图能力。</p>
          </div>
          <Link href="/" className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm">返回 LibreTV</Link>
        </header>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <article key={module.title} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface)] text-xl" aria-hidden="true">{module.icon}</span>
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)]">{module.status}</span>
              </div>
              <h2 className="mt-4 text-base font-semibold">{module.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{module.detail}</p>
            </article>
          ))}
        </section>

        <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">视觉检查任务</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">选择要检查的页面，后续由受控 Browser Runner 采集截图和运行证据。</p>
            </div>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-300">执行引擎接入中</span>
          </div>
          <label htmlFor="ui-agent-target" className="mt-5 block text-sm font-medium">目标页面</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select id="ui-agent-target" value={target} onChange={(event) => setTarget(event.target.value)} className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 text-sm">
              <option value="/">首页 /</option>
              <option value="/movies">电影 /movies</option>
              <option value="/anime">动漫 /anime</option>
              <option value="/resource-studio">资源管理中心 /resource-studio</option>
              <option value="/settings">设置 /settings</option>
              <option value="/detail">详情页 /detail</option>
            </select>
            <button type="button" onClick={() => setNote('已记录目标页面 ' + target + '。当前工作台尚未连接任务执行 API，因此没有启动扫描或修改代码。')} className="min-h-11 rounded-xl bg-[var(--foreground)] px-5 text-sm font-semibold text-[var(--background)]">准备检查</button>
          </div>
          {note ? <p className="mt-3 text-sm text-[var(--muted)]" role="status">{note}</p> : null}
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">安全与部署状态</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface)] p-4"><p className="text-sm font-medium">运行范围</p><p className="mt-1 text-sm text-[var(--muted)]">独立功能分支与 Preview；不允许自动修改 main、合并 PR 或部署生产。</p></div>
            <div className="rounded-xl bg-[var(--surface)] p-4"><p className="text-sm font-medium">代码写入</p><p className="mt-1 text-sm text-[var(--muted)]">自动写入尚未启用。后续需加入任务授权、文件范围白名单和人工审批。</p></div>
            <div className="rounded-xl bg-[var(--surface)] p-4"><p className="text-sm font-medium">浏览器证据</p><p className="mt-1 text-sm text-[var(--muted)]">CI 可采集 Chromium 截图；不等同真实 iPhone / iPad Safari 验收。</p></div>
            <div className="rounded-xl bg-[var(--surface)] p-4"><p className="text-sm font-medium">当前入口</p><p className="mt-1 text-sm text-[var(--muted)]">设置 → AI 界面工作台，或直接访问 /ui-studio。</p></div>
          </div>
        </section>
      </div>
    </main>
  );
}
