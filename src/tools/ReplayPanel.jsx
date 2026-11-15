// ReplayPanel.jsx — the replay harness (open the 3D tab with ?replay in the URL).
//
// Rebuilds a batch of saved .trc projects from their feature recipes, one after
// another, and reports for each: which bodies failed to rebuild, how long they
// took, every rougher / retry method the CAD worker had to fall back on, and the
// model-health readout of every body. Compared with a saved baseline it becomes
// a regression test: a fix that quietly changes an old project (a body fails, a
// volume changes, a shape goes invalid) shows up in red.
//
// Projects come from the replay-projects/ folder (dev server only — the folder
// is git-ignored, so student work is never committed or deployed) or from
// "Add files…" (read in the browser; nothing is uploaded anywhere).
// replay-projects/baseline.json, if present, is loaded as the baseline.
import { useState, useRef } from 'react'

const DEV_FILES = import.meta.env.DEV
  ? import.meta.glob('/replay-projects/**/*.trc', { query: '?raw', import: 'default' }) : {}
const DEV_BASELINE = import.meta.env.DEV
  ? import.meta.glob('/replay-projects/baseline.json', { query: '?raw', import: 'default' }) : {}

const C = { red: '#ff6b6b', amber: '#ffb74d', green: '#7ED957', dim: '#888' }
const SLOW_MS = 5000

// Problems a project has on its own (no baseline needed).
function ownProblems(r) {
  if (r.error) return [['red', 'could not open: ' + r.error]]
  const p = []
  for (const f of r.rebuilt || []) if (f.error) p.push(['red', `${f.name} failed: ${f.error}`])
  for (const b of r.bodies || []) {
    if (b.error) { p.push(['red', `${b.name}: could not measure`]); continue }
    if (!b.valid) p.push(['red', `${b.name}: invalid shape`])
    if (b.solids > 1) p.push(['red', `${b.name}: ${b.solids} separate solids`])
    if (b.tinyEdges) p.push(['amber', `${b.name}: ${b.tinyEdges} tiny edge${b.tinyEdges > 1 ? 's' : ''}`])
    if (b.tinyFaces) p.push(['amber', `${b.name}: ${b.tinyFaces} tiny face${b.tinyFaces > 1 ? 's' : ''}`])
    const flat = b.faceTypes?.PLANE || 0
    if (flat > 60 && flat > b.faces * 0.8) p.push(['amber', `${b.name}: ${flat} flat faces (facets?)`])
  }
  // 'slow step' entries are timings (one heavy step over 1 s), not fallbacks —
  // they're listed in the row's detail, not as problems.
  const kinds = {}
  for (const d of r.fallbacks || []) if (d.kind !== 'slow step') kinds[d.kind] = (kinds[d.kind] || 0) + 1
  for (const [k, n] of Object.entries(kinds)) p.push(['amber', `fallback: ${k}${n > 1 ? ' ×' + n : ''}`])
  if (r.totalMs > SLOW_MS) p.push(['amber', `slow: ${(r.totalMs / 1000).toFixed(1)} s`])
  return p
}

// What changed since the baseline run of the same file.
function vsBaseline(r, b) {
  if (!b) return null
  const out = []
  if (r.error && !b.error) return [['red', 'now fails to open']]
  if (r.error || b.error) return out
  const failedNow = new Set((r.rebuilt || []).filter(f => f.error).map(f => f.name))
  const failedThen = new Set((b.rebuilt || []).filter(f => f.error).map(f => f.name))
  for (const n of failedNow) if (!failedThen.has(n)) out.push(['red', `${n} now fails`])
  for (const n of failedThen) if (!failedNow.has(n)) out.push(['green', `${n} now rebuilds`])
  const rb = r.bodies || [], bb = b.bodies || []
  if (rb.length !== bb.length) out.push(['red', `bodies ${bb.length} → ${rb.length}`])
  for (let i = 0; i < Math.min(rb.length, bb.length); i++) {
    const x = rb[i], y = bb[i]
    if (x.error || y.error) continue
    const dv = y.volume ? Math.abs(x.volume - y.volume) / Math.abs(y.volume) : 0
    if (dv > 0.005) out.push(['red', `${x.name}: volume ${Math.round(y.volume)} → ${Math.round(x.volume)} mm³`])
    if (x.solids !== y.solids) out.push(['red', `${x.name}: solids ${y.solids} → ${x.solids}`])
    if (y.valid && !x.valid) out.push(['red', `${x.name}: became invalid`])
    if (!y.valid && x.valid) out.push(['green', `${x.name}: now valid`])
    if (x.faces !== y.faces) out.push([x.faces < y.faces ? 'green' : 'amber', `${x.name}: faces ${y.faces} → ${x.faces}`])
  }
  if (r.totalMs > 2 * b.totalMs && r.totalMs > 1000) out.push(['amber', `slower: ${(b.totalMs / 1000).toFixed(1)} → ${(r.totalMs / 1000).toFixed(1)} s`])
  const kindsThen = new Set((b.fallbacks || []).map(d => d.kind))
  for (const k of new Set((r.fallbacks || []).map(d => d.kind))) if (k !== 'slow step' && !kindsThen.has(k)) out.push(['amber', `new fallback: ${k}`])
  if (b.totalMs > 1.5 * r.totalMs && b.totalMs > 1000) out.push(['green', `faster: ${(b.totalMs / 1000).toFixed(1)} → ${(r.totalMs / 1000).toFixed(1)} s`])
  return out
}

function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const Lines = ({ items }) => items.length
  ? items.map(([c, t], i) => <div key={i} style={{ color: C[c] }}>{c === 'green' ? '✓' : '⚠'} {t}</div>)
  : <div style={{ color: C.green }}>✓ clean</div>

export default function ReplayPanel({ onReplay, onClose }) {
  const [files, setFiles] = useState(() => Object.entries(DEV_FILES).map(([path, load]) =>
    ({ name: path.replace('/replay-projects/', ''), load })))
  const [results, setResults] = useState({})
  const [baseline, setBaseline] = useState(null)
  const [baselineNote, setBaselineNote] = useState('')
  const [running, setRunning] = useState(null)   // file name being replayed
  const [open, setOpen] = useState(null)         // expanded row
  const stopRef = useRef(false)

  // replay-projects/baseline.json, read once on first open
  const triedBaseline = useRef(false)
  if (!triedBaseline.current) {
    triedBaseline.current = true
    const load = Object.values(DEV_BASELINE)[0]
    if (load) load().then(t => { const j = JSON.parse(t); setBaseline(j.results || j); setBaselineNote('replay-projects/baseline.json') })
      .catch(() => setBaselineNote('baseline.json could not be read'))
  }

  function addFiles(list) {
    const added = [...list].filter(f => /\.trc$/i.test(f.name)).map(f => ({ name: f.name, load: () => f.text() }))
    setFiles(prev => [...prev.filter(p => !added.some(a => a.name === p.name)), ...added])
  }
  function loadBaselineFile(f) {
    if (!f) return
    f.text().then(t => { const j = JSON.parse(t); setBaseline(j.results || j); setBaselineNote(f.name) })
      .catch(() => setBaselineNote('that baseline file could not be read'))
  }

  async function runOne(f) {
    setRunning(f.name)
    let rep
    try { rep = await onReplay(await f.load()) }
    catch (err) { rep = { error: err.message || String(err) } }
    setResults(prev => ({ ...prev, [f.name]: rep }))
    setRunning(null)
  }

  async function runAll() {
    stopRef.current = false
    setResults({})
    for (const f of files) {
      if (stopRef.current) break
      setRunning(f.name)
      let rep
      try { rep = await onReplay(await f.load()) }
      catch (err) { rep = { error: err.message || String(err) } }
      setResults(prev => ({ ...prev, [f.name]: rep }))
      await new Promise(r => setTimeout(r, 50))   // let the view paint between projects
    }
    setRunning(null)
  }

  // Dev only: read the results / set a baseline from the browser console.
  if (import.meta.env.DEV) { window.__replayResults = results; window.__setReplayBaseline = (b, note = 'console') => { setBaseline(b.results || b); setBaselineNote(note) } }

  const done = Object.keys(results).length
  const totals = { red: 0, amber: 0, reg: 0 }
  for (const [n, r] of Object.entries(results)) {
    const p = ownProblems(r)
    if (p.some(x => x[0] === 'red')) totals.red++
    else if (p.length) totals.amber++
    if (vsBaseline(r, baseline?.[n])?.some(x => x[0] === 'red')) totals.reg++
  }
  const btn = { background: '#1d1450', color: '#ddd', border: '1px solid #3a2f7a', borderRadius: 4,
    padding: '4px 10px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }

  return (
    <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)', width: 'min(960px, 96vw)',
      maxHeight: '86vh', overflowY: 'auto', zIndex: 10000, background: '#0e0630', border: '1px solid #3a2f7a',
      borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: 11, color: '#ccc',
      boxShadow: '0 8px 30px rgba(0,0,0,0.7)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ color: '#53D3E4', fontWeight: 'bold', fontSize: 13, letterSpacing: '0.05em' }}>PROJECT REPLAY TEST</span>
        <span style={{ color: C.dim }}>rebuilds each project from its recipe and checks the result</span>
        <button onClick={onClose} style={{ ...btn, marginLeft: 'auto', border: 'none', background: 'none' }}>✕</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button style={btn} disabled={!!running || !files.length} onClick={runAll}>▶ Run all ({files.length})</button>
        {running && <button style={btn} onClick={() => { stopRef.current = true }}>■ Stop</button>}
        <label style={btn}>Add files…
          <input type="file" accept=".trc" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />
        </label>
        <label style={btn}>Load baseline…
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={e => loadBaselineFile(e.target.files[0])} />
        </label>
        <button style={btn} disabled={!done} onClick={() => download('replay-report.json', { date: new Date().toISOString(), results })}>Download report</button>
        <button style={btn} disabled={!done || !!running} title="Use this run as the baseline, and download it as baseline.json (put it in replay-projects/)"
          onClick={() => { setBaseline(results); setBaselineNote('this run'); download('baseline.json', { date: new Date().toISOString(), results }) }}>Save as baseline</button>
      </div>
      <div style={{ color: C.dim, marginBottom: 8 }}>
        {files.length ? '' : 'No projects yet — put .trc files in replay-projects/ (dev server) or use Add files…  '}
        Baseline: {baseline ? baselineNote : 'none'}
        {running ? ` · replaying ${running} (${done + 1}/${files.length})…` : done ? ` · ${done} replayed: ${totals.red} with problems, ${totals.amber} with warnings${baseline ? `, ${totals.reg} changed from baseline` : ''}` : ''}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#fff', textAlign: 'left' }}>
            {['Project', 'Features', 'Bodies', 'Time', 'Problems', 'vs baseline'].map(h =>
              <th key={h} style={{ padding: '4px 6px', borderBottom: '1px solid #3a2f7a' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {files.map(f => {
            const r = results[f.name]
            const vb = r ? vsBaseline(r, baseline?.[f.name]) : null
            return [
              <tr key={f.name} onClick={() => r && setOpen(open === f.name ? null : f.name)}
                style={{ cursor: r ? 'pointer' : 'default', verticalAlign: 'top', borderBottom: '1px solid #2a2050',
                  background: running === f.name ? '#1d1450' : 'transparent' }}>
                <td style={{ padding: '4px 6px', color: '#fff' }}>
                  <button title='Replay just this project' disabled={!!running} onClick={e => { e.stopPropagation(); runOne(f) }}
                    style={{ background: 'none', border: 'none', color: '#53D3E4', cursor: 'pointer', padding: '0 4px 0 0', fontFamily: 'monospace' }}>▶</button>
                  {r ? (open === f.name ? '▾ ' : '▸ ') : ''}{f.name}</td>
                <td style={{ padding: '4px 6px' }}>{r?.featureCount ?? ''}</td>
                <td style={{ padding: '4px 6px' }}>{r?.bodies?.length ?? ''}</td>
                <td style={{ padding: '4px 6px' }}>{r?.totalMs != null ? (r.totalMs / 1000).toFixed(1) + ' s' : running === f.name ? '…' : ''}</td>
                <td style={{ padding: '4px 6px' }}>{r ? <Lines items={ownProblems(r)} /> : ''}</td>
                <td style={{ padding: '4px 6px' }}>{vb ? <Lines items={vb} /> : r && baseline ? <span style={{ color: C.dim }}>not in baseline</span> : ''}</td>
              </tr>,
              open === f.name && r && !r.error && (
                <tr key={f.name + ':detail'}>
                  <td colSpan={6} style={{ padding: '4px 6px 10px 22px', color: '#aaa' }}>
                    {(r.rebuilt || []).map((b, i) => <div key={i}>
                      {b.error ? <span style={{ color: C.red }}>✗</span> : '·'} {b.name} ({b.op}{b.featureCount > 1 ? `, ${b.featureCount} features` : ''}) {b.error ? '— ' + b.error : `${b.ms} ms`}
                    </div>)}
                    {(r.bodies || []).map((b, i) => <div key={'b' + i} style={{ color: '#999' }}>
                      ◦ {b.name}: {b.error ? 'could not measure' : `${b.faces} faces · ${b.edges} edges · ${Math.round(b.volume).toLocaleString()} mm³${b.valid ? '' : ' · INVALID'}`}
                    </div>)}
                    {(r.fallbacks || []).map((d, i) => <div key={'d' + i} style={{ color: d.kind === 'slow step' ? C.dim : C.amber }}>{d.kind === 'slow step' ? '⏱' : '↺'} {d.kind}{d.detail ? ` (${d.detail})` : ''}</div>)}
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
