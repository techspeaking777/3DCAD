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

export default function SplashScreen({ onChoose }) {
  const [sel, setSel] = useState(0)

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
        <div>
          <span style={{ color: '#eaeaf0' }}>CAD </span>
          <span style={{ color: '#3ad6ff', textShadow: '0 0 12px #3ad6ff, 0 0 24px #3ad6ff88' }}>3D</span>
        </div>
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

      <style>{`@keyframes splashBlink { 50% { opacity: 0; } }`}</style>
    </div>
  )
}
