'use client';

import { useState } from 'react';
import { LiquidGlassSurface } from '@/components/ui/liquid-glass';
import { useFridayGlass } from './FridayGlassProvider';

const toggles = [
  ['motion', '液态弹性动画'],
  ['ambient', '环境色适配'],
  ['cinemaDark', '深色影院控制栏'],
  ['playbackProtection', '播放性能保护'],
] as const;

const environments = [
  { label: '海洋', tone: 'dark', background: 'linear-gradient(135deg, #102957, #126782)' },
  { label: '日落', tone: 'light', background: 'linear-gradient(135deg, #fff0d1, #ee8f72)' },
  { label: '夜间', tone: 'dark', background: 'linear-gradient(135deg, #101424, #3c2c57)' },
  { label: '冰雪', tone: 'light', background: 'linear-gradient(135deg, #effafa, #b4cadb)' },
] as const;

export function FridayGlassControls() {
  const { backend, preferences, update, reset } = useFridayGlass();
  const [environment, setEnvironment] = useState(0);
  const sample = environments[environment];
  return (
    <div className="mt-4 grid gap-4 border-t border-line pt-4 text-sm text-content">
      <h3 className="font-semibold">液态玻璃</h3>
      <label className="grid gap-1">
        玻璃材质
        <select className="rounded-lg border border-line bg-surface p-2" value={preferences.material}
          onChange={(event) => update({ material: event.target.value as typeof preferences.material })}>
          <option value="regular">标准玻璃</option>
          <option value="clear">晶透玻璃</option>
          <option value="frosted">磨砂玻璃</option>
          <option value="cinema">影院玻璃</option>
          <option value="ambient">环境玻璃</option>
          <option value="solid">实色玻璃</option>
        </select>
      </label>
      <label className="grid gap-1">
        玻璃主题
        <select className="rounded-lg border border-line bg-surface p-2" value={preferences.theme}
          onChange={(event) => update({ theme: event.target.value as typeof preferences.theme })}>
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
      <label className="grid gap-1">
        效果强度 {preferences.intensity}%
        <input type="range" min="0" max="100" value={preferences.intensity}
          onChange={(event) => update({ intensity: event.target.valueAsNumber })} />
      </label>
      <label className="grid gap-1">
        渲染质量
        <select className="rounded-lg border border-line bg-surface p-2" value={preferences.quality}
          onChange={(event) => update({ quality: event.target.value as typeof preferences.quality })}>
          <option value="auto">自动适配</option>
          <option value="optical">高级折射</option>
          <option value="native">基础玻璃</option>
          <option value="safe">实色</option>
        </select>
      </label>
      {toggles.map(([key, label]) => (
        <label key={key} className="flex items-center gap-2">
          <input type="checkbox" checked={preferences[key]}
            onChange={(event) => update({ [key]: event.target.checked })} />
          {label}
        </label>
      ))}
      <details className="text-muted">
        <summary>环境玻璃预览</summary>
        <div className="mt-2 grid gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="预览背景">
            {environments.map(({ label }, index) => (
              <button key={label} className="rounded border border-line px-3 py-1" type="button"
                aria-pressed={index === environment} onClick={() => setEnvironment(index)}>
                {label}
              </button>
            ))}
          </div>
          <div className="rounded-xl p-4" style={{ background: sample.background }}>
            <LiquidGlassSurface material="ambient" ambientTone={sample.tone} disableEngine
              className="rounded-xl px-4 py-3">{sample.label}背景</LiquidGlassSurface>
          </div>
        </div>
      </details>
      <a className="underline text-sm" href="/ipad-edition/glass-lab">打开六材质与折射验证实验室</a>
      <details className="text-muted">
        <summary>渲染诊断</summary>
        <output>{({ optical: '高级折射', webkit: 'WebKit 玻璃', native: '基础玻璃', safe: '实色' })[backend]}</output>
      </details>
      <button type="button" className="justify-self-start rounded-lg border border-line px-3 py-2" onClick={reset}>
        恢复玻璃默认设置
      </button>
    </div>
  );
}
