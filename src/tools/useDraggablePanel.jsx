// useDraggablePanel.js — shared drag behavior for the flyout panels.
// Position resets to the anchored default every time the panel remounts
// (i.e. whenever the flyout closes and reopens), rather than persisting —
// a panel dragged out of the way once per session is the common case, and
// resetting avoids one getting stranded somewhere a student forgot about.
// Pointer Events (not mouse+touch separately) so dragging works with a
// finger on a touchscreen the same as with a mouse.
import { useRef, useState, useCallback } from 'react'

const MARGIN = 40 // px of the panel that must stay on-screen on every edge

export function useDraggablePanel(){
  const [offset, setOffset] = useState({ dx: 0, dy: 0 })
  const panelRef = useRef(null)
  const dragRef = useRef(null)

  const onPointerDown = useCallback(e => {
    if (e.button != null && e.button !== 0) return
    const panel = panelRef.current
    if (!panel) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const rect = panel.getBoundingClientRect()
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseDx: offset.dx, baseDy: offset.dy,
      baseLeft: rect.left - offset.dx, baseTop: rect.top - offset.dy,
      w: rect.width, h: rect.height,
    }
  }, [offset])

  const onPointerMove = useCallback(e => {
    const d = dragRef.current; if (!d) return
    let dx = d.baseDx + (e.clientX - d.startX)
    let dy = d.baseDy + (e.clientY - d.startY)
    dx = Math.max(MARGIN - d.w - d.baseLeft, Math.min(window.innerWidth - MARGIN - d.baseLeft, dx))
    dy = Math.max(MARGIN - d.h - d.baseTop, Math.min(window.innerHeight - MARGIN - d.baseTop, dy))
    setOffset({ dx, dy })
  }, [])

  const onPointerUp = useCallback(e => {
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch {}
  }, [])

  return {
    panelRef,
    panelStyle: { transform: `translate(${offset.dx}px, ${offset.dy}px)` },
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

function GripDots(){
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" style={{ flexShrink: 0, opacity: 0.6 }}>
      {[0, 1, 2].map(row => [0, 1].map(col => (
        <circle key={`${row}-${col}`} cx={2 + col * 4} cy={1 + row * 4} r="1" fill="#888" />
      )))}
    </svg>
  )
}

// Drop-in replacement for a flyout panel's title row — same look, but doubles
// as the drag handle (grip dots on each side so it reads as grabbable, not
// just a label). Spread the hook's `handleProps` onto it.
export function DragHandle({ children, ...handleProps }){
  return (
    <div {...handleProps} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      color: '#888', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
      marginBottom: 8, cursor: 'grab', pointerEvents: 'auto', userSelect: 'none', touchAction: 'none',
    }}>
      <GripDots/>
      <span>{children}</span>
      <GripDots/>
    </div>
  )
}
