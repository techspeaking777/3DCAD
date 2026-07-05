import { useState, useCallback } from 'react'

export function useHistory() {
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])

  // Call this BEFORE any action that changes geometry
  const commit = useCallback((snapshot) => {
    setPast(p => [...p.slice(-50), snapshot])  // keep last 50 steps
    setFuture([])
  }, [])

  const undo = useCallback((current, restore) => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setFuture(f => [current, ...f])
    setPast(p => p.slice(0, -1))
    restore(prev)
  }, [past])

  const redo = useCallback((current, restore) => {
    if (!future.length) return
    const next = future[0]
    setPast(p => [...p, current])
    setFuture(f => f.slice(1))
    restore(next)
  }, [future])

  return {
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0
  }
}