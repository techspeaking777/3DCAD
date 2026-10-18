import { useEffect, useState } from 'react'

// Arcade attract-screen title, shown once on load. "1 PLAYER"/"2 PLAYER" are
// pure theming (this app has no multiplayer concept) but each maps to a real
// action via its subtitle, so the joke doesn't cost the user anything real —
// arrow keys move the selector like a real cabinet, Enter/click/tap confirms.
const PIXEL_FONT = "'Press Start 2P', monospace"

const OPTIONS = [
  { id: 'new',  label: '1 PLAYER', sub: 'New Project' },
  { id: 'open', label: '2 PLAYER', sub: 'Open Project' },
]

// One-line tips cycled under the menu, arcade-attract-screen style. Each one
// describes something a first-time student would otherwise have to discover.
const TIPS = [
  'Right-click and drag to orbit. Middle-click and drag to pan. Scroll to zoom.',
  'Press Esc at any time to cancel the tool you are using.',
  'Hover a face and press Tab to turn which way your sketch will face.',
  'The yellow dot marks the bottom-left corner your sketch starts from.',
  'Click Extrude, Revolve, Loft, Sweep or Spring, then pick Add (+) or Cut (−).',
  'The ViewCube jumps to any side. Its house button returns to the isometric view.',
  'Switch Complex to Simple to hide the advanced tools until you need them.',
  'Type a number into a distance box to lock it exactly, then move the mouse freely.',
  'Click the pattern button on a Cutout in the Feature Tree to repeat it in a grid.',
  'Press Fit to zoom out and see your whole model.',
]

export default function SplashScreen({ onChoose }) {
  const [sel, setSel] = useState(0)
  // Start on a random tip so repeat visitors don't always see the same one.
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const t = setInterval(() => setTip(i => (i + 1) % TIPS.length), 6000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSel(s => (s + 1) % OPTIONS.length)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onChoose(OPTIONS[sel].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sel, onChoose])

  return (
    <div
      onClick={() => onChoose(OPTIONS[sel].id)}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: '#0a0e1a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 48, cursor: 'pointer', userSelect: 'none',
      }}>

      <div style={{ fontFamily: PIXEL_FONT, fontSize: 32, lineHeight: 1.6, textAlign: 'center' }}>
        <div style={{ color: '#FF9800', textShadow: '0 0 10px #FF9800' }}>Retro</div>
        <div style={{ color: '#3ad6ff', textShadow: '0 0 12px #3ad6ff, 0 0 24px #3ad6ff88' }}>CAD</div>
      </div>

      <div style={{
        fontFamily: PIXEL_FONT, fontSize: 16, color: '#eaeaf0',
        marginTop: -24, animation: 'splashBlink 0.8s step-start infinite',
      }}>
        PRESS START
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {OPTIONS.map((opt, i) => (
          <div key={opt.id}
            onClick={e => { e.stopPropagation(); onChoose(opt.id) }}
            onMouseEnter={() => setSel(i)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              fontFamily: PIXEL_FONT, fontSize: 18,
              color: sel === i ? '#FBDA2D' : '#4a4a5a',
              textShadow: sel === i ? '0 0 8px #FBDA2D' : 'none',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'color 0.15s',
            }}>
              <span style={{ opacity: sel === i ? 1 : 0, animation: sel === i ? 'splashBlink 1s step-start infinite' : 'none' }}>▶</span>
              {opt.label}
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.05em',
              color: sel === i ? '#3ad6ff' : '#3a3a4a',
            }}>
              {opt.sub}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        fontFamily: 'monospace', fontSize: 12, color: '#555',
        letterSpacing: '0.05em', animation: 'splashBlink 1.2s step-start infinite',
      }}>
        click, tap, or press enter
      </div>

      {/* Tip line — pinned near the bottom, ignores clicks so tapping anywhere
          still starts. The key remounts it on each change to replay the fade. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 28, padding: '0 24px',
        textAlign: 'center', pointerEvents: 'none',
      }}>
        <div key={tip} style={{ animation: 'splashFade 0.5s ease-out' }}>
          <span style={{ fontFamily: PIXEL_FONT, fontSize: 10, color: '#FBDA2D', marginRight: 10 }}>TIP</span>
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#8fa0b8', letterSpacing: '0.03em' }}>
            {TIPS[tip]}
          </span>
        </div>
      </div>

      <style>{`@keyframes splashBlink { 50% { opacity: 0; } }
        @keyframes splashFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  )
}
