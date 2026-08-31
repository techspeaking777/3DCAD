import { useState } from 'react'

// "Save to My Account" modal — same overlay/panel skeleton as SaveAsPanel.jsx.
// `classes` is the caller's already-fetched [{id,name,role}] list (see
// cloudSave.js's fetchMyClasses) — this component makes no requests itself.
//
// Class association UX depends on how many classes the user belongs to:
//   0 classes — no class UI at all, always saves personal (classId: null).
//   1 class   — defaults TO that class (the common case: a student in one
//               class saving their work should need zero extra clicks to
//               have their teacher see it), with an opt-out checkbox.
//   2+ classes — an explicit picker, defaulting to "Personal" rather than
//               guessing which class is intended.
export default function CloudSavePanel({ classes, defaultName='Untitled project', onSave, onClose }) {
  const [name, setName] = useState(defaultName)
  const [savePersonally, setSavePersonally] = useState(false)   // only meaningful when classes.length === 1
  const [selectedClassId, setSelectedClassId] = useState('')     // only meaningful when classes.length >= 2 — '' = personal

  const s = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 },
    panel:   { background:'#1e1e1e',borderRadius:8,padding:24,minWidth:320,maxWidth:400,color:'#eee',fontFamily:'monospace',fontSize:13,boxShadow:'0 8px 40px #000a' },
    label:   { color:'#aaa',display:'block',marginBottom:8 },
    row:     { display:'flex',alignItems:'center',gap:8,marginBottom:16 },
    input:   { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'8px 10px',flex:1,fontFamily:'monospace',fontSize:14 },
    select:  { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'8px 10px',flex:1,fontFamily:'monospace',fontSize:13 },
    btn:     { background:'#2196F3',border:'none',color:'#fff',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13,fontWeight:'bold' },
    btnGrey: { background:'#333',border:'none',color:'#aaa',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13 },
    note:    { color:'#888',fontSize:11,marginBottom:16,lineHeight:1.4 },
  }

  const submit = () => {
    const clean = (name || '').trim() || 'Untitled project'
    let classId = null
    if (classes.length === 1) classId = savePersonally ? null : classes[0].id
    else if (classes.length >= 2) classId = selectedClassId || null
    onSave(clean, classId)
  }

  return (
    <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={s.panel}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:15,fontWeight:'bold',color:'#fff'}}>☁ Save to My Account</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#888',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>

        <label style={s.label}>Project name</label>
        <div style={s.row}>
          <input
            style={s.input}
            value={name}
            autoFocus
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); if(e.key==='Escape') onClose() }}
          />
        </div>

        {classes.length === 1 && (
          <label style={{...s.row, cursor:'pointer'}}>
            <input type="checkbox" checked={savePersonally} onChange={e=>setSavePersonally(e.target.checked)}/>
            <span style={{color:'#aaa'}}>
              {savePersonally
                ? <>Saving as a personal project (not shared with <strong style={{color:'#eee'}}>{classes[0].name}</strong>)</>
                : <>Will be saved to <strong style={{color:'#eee'}}>{classes[0].name}</strong> — check to save personally instead</>}
            </span>
          </label>
        )}

        {classes.length >= 2 && (
          <>
            <label style={s.label}>Save to</label>
            <div style={s.row}>
              <select style={s.select} value={selectedClassId} onChange={e=>setSelectedClassId(e.target.value)}>
                <option value="">Personal (not in a class)</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </>
        )}

        {classes.length === 0 && (
          <p style={s.note}>Saved as a personal project — you're not enrolled in or teaching any classes yet.</p>
        )}

        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button style={s.btnGrey} onClick={onClose}>Cancel</button>
          <button style={s.btn} onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}
