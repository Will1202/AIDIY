import { useEffect, useRef, useState } from 'react'
import { useUI } from '../app/store'
import { editor, PALETTE, REGISTRY } from '../editor/editor'
import { engine } from '../app/engine'
import type { ParamDef } from '../sim/component'

/** BUILD YOUR OWN MACHINE — palette, toolbar, inspector and validation */
export function BuildUI() {
  const toast = useUI((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useUI.getState().set({ toast: null }), 2600)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <>
      <Palette />
      <Toolbar />
      <Inspector />
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function Palette() {
  const placing = useUI((s) => s.placing)
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => { if (Object.keys(editor.thumbs).length) { force((x) => x + 1); clearInterval(t) } }, 300)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel palette">
      <h4>Component library</h4>
      <div className="grid">
        {PALETTE.map((p) => (
          <button key={p.key} className={`pal ${placing === p.key ? 'on' : ''}`} onClick={() => (placing === p.key ? editor.cancelPlace() : editor.startPlace(p.key))} title={p.desc}>
            {editor.thumbs[p.key] ? <img src={editor.thumbs[p.key]} alt="" /> : <div className="ph" />}
            <span className="nm">{p.name}</span>
            <span className="ds">{p.desc}</span>
          </button>
        ))}
      </div>
      <div className="hint">
        Click a part, then click in the scene to place it on the work plane (<span className="kbd">[</span>/<span className="kbd">]</span> height, <span className="kbd">Q</span>/<span className="kbd">E</span> turn). Tracks snap onto open track ends.
      </div>
    </div>
  )
}

function Toolbar() {
  const canUndo = useUI((s) => s.canUndo)
  const canRedo = useUI((s) => s.canRedo)
  const snap = useUI((s) => s.snap)
  const name = useUI((s) => s.sceneName)
  const file = useRef<HTMLInputElement>(null)
  const [showLoad, setShowLoad] = useState(false)
  const saved = showLoad ? Object.keys(editor.listLocal()) : []
  return (
    <div className="panel toolbar">
      <button className="btn" onClick={() => { useUI.getState().set({ screen: 'landing' }); editor.exit() }}>◂ Exit</button>
      <div className="sep" />
      <button className="btn" onClick={() => editor.newScene()}>New</button>
      <button className="btn" onClick={() => editor.loadDemo()}>Grand Contraption</button>
      <button className="btn" onClick={() => editor.saveLocal(prompt('Save machine as', name) ?? name)}>Save machine</button>
      <span style={{ position: 'relative' }}>
        <button className="btn" onClick={() => setShowLoad(!showLoad)}>Load machine</button>
        {showLoad && (
          <div className="panel" style={{ top: 34, left: 0, minWidth: 220, padding: 8, zIndex: 5 }}>
            {saved.length === 0 && <div className="hint">No saved machines yet.</div>}
            {saved.map((n) => (
              <div key={n} className="conn">
                <button className="btn" style={{ gridColumn: '1 / 3', textAlign: 'left' }} onClick={() => { editor.loadLocal(n); setShowLoad(false) }}>{n}</button>
                <button className="btn danger" onClick={() => { editor.deleteLocal(n); setShowLoad(false) }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </span>
      <button className="btn" onClick={() => editor.exportJson()}>Export JSON</button>
      <button className="btn" onClick={() => file.current?.click()}>Import JSON</button>
      <input ref={file} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
        const f = e.target.files?.[0]
        if (f) editor.importJson(await f.text())
        e.target.value = ''
      }} />
      <div className="sep" />
      <button className="btn" disabled={!canUndo} onClick={() => editor.undoAction()}>Undo</button>
      <button className="btn" disabled={!canRedo} onClick={() => editor.redoAction()}>Redo</button>
      <button className="btn" style={snap ? { borderColor: 'var(--brass)', color: 'var(--brass-hi)' } : undefined} onClick={() => useUI.getState().set({ snap: !snap })}>Snap {snap ? 'on' : 'off'}</button>
      <div className="sep" />
      <button className="btn gold" onClick={() => editor.test()}>▶ Start simulation</button>
    </div>
  )
}

function Field({ def, value, onCommit }: { def: ParamDef; value: number | boolean | string; onCommit: (v: number | boolean | string) => void }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  if (def.type === 'boolean') {
    return (
      <label className="field"><span>{def.label}</span><input type="checkbox" checked={local === true} onChange={(e) => onCommit(e.target.checked)} /></label>
    )
  }
  if (def.type === 'select') {
    return (
      <label className="field"><span>{def.label}</span>
        <select value={String(local)} onChange={(e) => onCommit(e.target.value)}>{def.options!.map((o) => <option key={o}>{o}</option>)}</select>
      </label>
    )
  }
  return (
    <label className="field"><span>{def.label}</span>
      <input type="number" value={Number(local)} step={def.step} min={def.min} max={def.max} onChange={(e) => setLocal(Number(e.target.value))} onBlur={() => onCommit(Number(local))} onKeyDown={(e) => e.key === 'Enter' && onCommit(Number(local))} />
      <input type="range" value={Number(local)} step={def.step} min={def.min} max={def.max} onChange={(e) => setLocal(Number(e.target.value))} onPointerUp={() => onCommit(Number(local))} onKeyUp={() => onCommit(Number(local))} />
    </label>
  )
}

function Inspector() {
  const sel = useUI((s) => s.selected)
  const issues = useUI((s) => s.issues)
  useUI((s) => s.canUndo) // re-render after commits
  const spec = sel ? editor.spec.components.find((c) => c.id === sel) : undefined
  const comp = sel ? engine.sim.byId.get(sel) : undefined
  const info = spec ? REGISTRY[spec.type] : undefined
  const conns = sel ? editor.spec.connections.filter((k) => k.from === sel || k.to === sel) : []
  const targets = engine.sim.components.filter((c) => c.id !== sel)
  const [linkTo, setLinkTo] = useState('')
  return (
    <div className="panel inspector">
      {!spec && (
        <>
          <h4>Inspector</h4>
          <div className="hint">Select a component in the scene to edit it.<br />
            <span className="kbd">G</span> move · <span className="kbd">R</span> rotate · <span className="kbd">Q</span>/<span className="kbd">E</span> turn 15° · <span className="kbd">Ctrl D</span> duplicate · <span className="kbd">Del</span> delete · <span className="kbd">Ctrl Z</span>/<span className="kbd">Ctrl Y</span> undo/redo · drag = orbit, right-drag = pan, wheel = zoom
          </div>
        </>
      )}
      {spec && info && comp && (
        <>
          <h4>{spec.type} · {spec.id}</h4>
          <label className="field"><span>Name</span><input type="text" defaultValue={spec.label ?? ''} key={spec.id + 'l'} onBlur={(e) => editor.setLabel(spec.id, e.target.value)} /></label>
          <div className="hint" style={{ marginTop: 0 }}>Drive: <b>{comp.drive}</b>{comp.signalInputs.length ? ` · inputs: ${comp.signalInputs.join(', ')}` : ''}{comp.signalOutputs.length ? ` · outputs: ${comp.signalOutputs.join(', ')}` : ''}{comp.rotors().length ? ' · has a shaft' : ''}</div>
          {(['x', 'y', 'z'] as const).map((ax, i) => (
            <Field key={ax + spec.id} def={{ key: ax, label: `Position ${ax.toUpperCase()}`, type: 'number', step: 0.05, min: -60, max: 60, default: 0 }} value={spec.pos[i]} onCommit={(v) => {
              const p = [...spec.pos] as [number, number, number]
              p[i] = Number(v)
              editor.setTransform(spec.id, p, spec.rot)
            }} />
          ))}
          <Field def={{ key: 'rot', label: 'Rotation (deg)', type: 'number', step: 5, min: -360, max: 360, default: 0 }} value={Math.round((spec.rot * 180) / Math.PI)} onCommit={(v) => editor.setTransform(spec.id, spec.pos, (Number(v) * Math.PI) / 180)} />
          {info.params.filter((d) => !d.when || d.when({ ...Object.fromEntries(info.params.map((x) => [x.key, x.default])), ...spec.params })).map((d) => <Field key={d.key + spec.id} def={d} value={spec.params[d.key] ?? d.default} onCommit={(v) => editor.setParam(spec.id, d.key, v)} />)}
          <div className="btns">
            <button className="btn" onClick={() => editor.setGizmoMode('translate')}>Move</button>
            <button className="btn" onClick={() => editor.setGizmoMode('rotate')}>Rotate</button>
            <button className="btn" onClick={() => editor.duplicate(spec.id)}>Duplicate</button>
            <button className="btn danger" onClick={() => editor.remove(spec.id)}>Delete</button>
            {spec.type === 'final' && <button className="btn" onClick={() => editor.setFinal(spec.id)}>Set as finish</button>}
          </div>
          <h4>Connections</h4>
          {conns.length === 0 && <div className="hint" style={{ marginTop: 0 }}>Physical contact needs no wire. Wires carry signals (switch → motor); chains carry rotation (gear → conveyor).</div>}
          {conns.map((k) => (
            <div key={k.id} className="conn">
              <span style={{ gridColumn: '1 / 3', fontFamily: 'var(--mono)', fontSize: 10.5, color: k.kind === 'mechanical' ? 'var(--brass-hi)' : 'var(--ember)' }}>
                {k.kind === 'mechanical' ? '⚙ chain' : '⚡ wire'} {k.from}.{k.output} → {k.to}.{k.input}{k.ratio ? ` ×${k.ratio}` : ''}
              </span>
              <button className="btn danger" onClick={() => editor.removeConnection(k.id)}>✕</button>
            </div>
          ))}
          <div className="conn">
            <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
              <option value="">connect to…</option>
              {targets.filter((t) => (comp.signalOutputs.length && t.signalInputs.length) || (comp.rotors().length && t.rotors().length)).map((t) => <option key={t.id} value={t.id}>{t.spec.label ?? t.id}</option>)}
            </select>
            <button className="btn" onClick={() => {
              const t = engine.sim.byId.get(linkTo)
              if (!t) return
              if (comp.signalOutputs.length && t.signalInputs.length) editor.addConnection({ kind: 'signal', from: comp.id, output: comp.signalOutputs[0], to: t.id, input: t.signalInputs[0] })
              else editor.addConnection({ kind: 'mechanical', from: comp.id, output: 'shaft', to: t.id, input: 'drive', ratio: 1 })
              setLinkTo('')
            }}>Add</button>
            <button className="btn" title="click target in the scene" onClick={() => editor.beginLink(comp.id)}>⌖</button>
          </div>
        </>
      )}
      <div className="issues">
        <h4>Validation</h4>
        {issues.length === 0 && <div className="issue ok">No structural problems found. (This does not prove the chain will succeed — run it.)</div>}
        {issues.map((i, n) => <div key={n} className={`issue ${i.level}`} onClick={() => i.id && editor.select(i.id)}>{i.level === 'error' ? '✕ ' : '! '}{i.text}</div>)}
      </div>
    </div>
  )
}
