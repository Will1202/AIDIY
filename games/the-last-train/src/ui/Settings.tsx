import { settingsStore, useSettings, saveSettings, type Settings } from '../state/store'
import { QUALITY_LEVELS, QUALITY_LABEL } from '../engine/quality'
import { game } from '../game/Game'
import { audio } from '../audio/AudioEngine'

const set = (p: Partial<Settings>) => {
  settingsStore.setState(p)
  const s = settingsStore.getState()
  audio.setVolumes(s)
  game.applySettings()
  void saveSettings()
}

function Slider({ label, k, min, max, step, fmt }: { label: string; k: keyof Settings; min: number; max: number; step: number; fmt?: (v: number) => string }) {
  const v = useSettings((s) => s[k] as number)
  return (
    <div className="set">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      <output>{fmt ? fmt(v) : Math.round(v * 100)}</output>
    </div>
  )
}

function Toggle({ label, k }: { label: string; k: keyof Settings }) {
  const v = useSettings((s) => s[k] as boolean)
  return (
    <div className="set">
      <label>{label}</label>
      <div className="seg">
        <button className={v ? 'on' : ''} onClick={() => set({ [k]: true } as Partial<Settings>)}>开</button>
        <button className={!v ? 'on' : ''} onClick={() => set({ [k]: false } as Partial<Settings>)}>关</button>
      </div>
      <output />
    </div>
  )
}

export function SettingsPanel() {
  const q = useSettings((s) => s.quality) ?? game.qLevel
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 6 }}>画面</div>
      <div className="set">
        <label>画质档位</label>
        <div className="seg">
          {QUALITY_LEVELS.map((l) => (
            <button key={l} className={q === l ? 'on' : ''} onClick={() => game.setQuality(l)}>{QUALITY_LABEL[l]}</button>
          ))}
        </div>
        <output />
      </div>
      <Slider label="视野 FOV" k="fov" min={55} max={95} step={1} fmt={(v) => `${v}°`} />
      <Toggle label="镜头晃动" k="headBob" />
      <Toggle label="显示帧率" k="showFps" />
      <div className="kicker" style={{ margin: '26px 0 6px' }}>操作</div>
      <Slider label="鼠标灵敏度" k="sensitivity" min={0.2} max={2.5} step={0.05} fmt={(v) => v.toFixed(2)} />
      <Toggle label="反转 Y 轴" k="invertY" />
      <Slider label="字幕大小" k="subtitleSize" min={0.8} max={1.5} step={0.05} fmt={(v) => v.toFixed(2)} />
      <div className="kicker" style={{ margin: '26px 0 6px' }}>声音</div>
      <Slider label="主音量" k="master" min={0} max={1} step={0.01} />
      <Slider label="配乐" k="music" min={0} max={1} step={0.01} />
      <Slider label="环境声" k="ambience" min={0} max={1} step={0.01} />
      <Slider label="音效" k="sfx" min={0} max={1} step={0.01} />
      <Toggle label="静音" k="muted" />
      <div className="keys">
        <span className="k">WASD</span><span>移动　<span className="k">Shift</span> 奔跑　<span className="k">Space</span> 跳跃</span>
        <span className="k">E</span><span>检查 / 拾取 / 使用 / 交谈</span>
        <span className="k">Tab</span><span>背包　<span className="k">J</span> 任务　<span className="k">M</span> 地图</span>
        <span className="k">H</span><span>提示（停留一段时间后逐级解锁）</span>
        <span className="k">C</span><span>电影模式（隐藏 HUD）　<span className="k">P</span> 拍照模式</span>
        <span className="k">R / F</span><span>时间沙漠：倒转 / 暂停·恢复</span>
        <span className="k">Esc</span><span>暂停　<span className="k">F3</span> 帧率</span>
      </div>
    </div>
  )
}
