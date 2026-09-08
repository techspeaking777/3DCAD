import { useEffect, useState } from 'react'
import { fetchMyClasses, listCloudProjects, deleteCloudProject } from './cloudSave.js'

// "Open from My Account" modal — same overlay/panel skeleton as
// SaveAsPanel.jsx. Unlike CloudSavePanel (which receives an already-fetched
// class list), this owns its own fetch lifecycle since it also needs the
// project list and re-fetches it whenever the class filter changes.
export default function CloudOpenPanel({ onOpen, onClose }) {
  const [classes, setClasses] = useState([])
  const [classFilter, setClassFilter] = useState('')   // '' = all my projects
  const [projects, setProjects] = useState(null)        // null = still loading
  const [error, setError] = useState(null)

  useEffect(() => { fetchMyClasses().then(setClasses) }, [])

  useEffect(() => {
    let cancelled = false
    setProjects(null)
    setError(null)
    listCloudProjects(classFilter || null)
      .then(list => { if (!cancelled) setProjects(list) })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not reach the server — check your connection') })
    return () => { cancelled = true }
  }, [classFilter])

  const classNameById = new Map(classes.map(c => [c.id, c.name]))

  // Deleting is scoped to whichever project's row triggered it, not the
  // whole panel, so one delete failing (or a confirm being cancelled)
  // never disturbs anything else in the list.
  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!window.confirm('Delete this project? This cannot be undone.')) return
    try {
      await deleteCloudProject(id)
      setProjects(prev => (prev ?? []).filter(p => p.id !== id))
    } catch (err) {
      alert(err.message || "Couldn't delete that project")
    }
  }

  const s = {
    overlay:   { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 },
    panel:     { background:'#1e1e1e',borderRadius:8,padding:24,width:420,maxWidth:'90vw',maxHeight:'80vh',display:'flex',flexDirection:'column',color:'#eee',fontFamily:'monospace',fontSize:13,boxShadow:'0 8px 40px #000a' },
    select:    { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'6px 10px',fontFamily:'monospace',fontSize:12,marginBottom:12},
    list:      { overflowY:'auto',flex:1,display:'flex',flexDirection:'column',gap:6},
    // A row's delete "✕" can't be a <button> nested inside the row's own
    // open <button> (invalid HTML, and the click would bubble into both
    // handlers) -- the row is a div instead, with an "open" button and a
    // separate "delete" button as siblings.
    row:       { background:'#2a2a2a',border:'1px solid #3a3a3a',borderRadius:6,padding:'10px 12px',display:'flex',alignItems:'center',gap:8},
    rowOpen:   { flex:1,minWidth:0,background:'none',border:'none',padding:0,margin:0,textAlign:'left',cursor:'pointer',color:'inherit',font:'inherit'},
    btnDelete: { flexShrink:0,background:'none',border:'none',color:'#888',fontSize:15,cursor:'pointer',padding:'2px 6px'},
    note:      { color:'#888',fontSize:11,lineHeight:1.4 },
    btnGrey:   { background:'#333',border:'none',color:'#aaa',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13,marginTop:16,alignSelf:'flex-end'},
  }

  return (
    <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={s.panel}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:15,fontWeight:'bold',color:'#fff'}}>☁ Open from My Account</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#888',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>

        {classes.length > 0 && (
          <select style={s.select} value={classFilter} onChange={e=>setClassFilter(e.target.value)}>
            <option value="">All my projects</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div style={s.list}>
          {error && <p style={{...s.note, color:'#e57373'}}>{error}</p>}
          {!error && projects === null && <p style={s.note}>Loading…</p>}
          {!error && projects?.length === 0 && <p style={s.note}>You haven't saved anything to your account yet.</p>}
          {!error && projects?.map(p => (
            <div key={p.id} style={s.row}>
              <button style={s.rowOpen} onClick={()=>onOpen(p.id)}>
                <div style={{fontWeight:'bold',color:'#fff'}}>{p.name}</div>
                <div style={{fontSize:11,color:'#888',marginTop:2}}>
                  Updated {new Date(p.updated_at).toLocaleString()}
                  {p.class_id && classNameById.has(p.class_id) ? ` · ${classNameById.get(p.class_id)}` : ''}
                </div>
              </button>
              <button style={s.btnDelete} onClick={e=>handleDelete(e, p.id)} title="Delete project">✕</button>
            </div>
          ))}
        </div>

        <button style={s.btnGrey} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
