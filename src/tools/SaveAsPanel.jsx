import { useState } from 'react'

// Fallback "Save As" modal for browsers without the File System Access API
// (Firefox, Safari). They can't pick a folder, but they can at least pick a name
// instead of always getting a generic "drawing.json" in Downloads.
export default function SaveAsPanel({ defaultName='drawing', extension='.json', onSave, onClose }) {
  const [name, setName] = useState(defaultName)

  const s = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 },
    panel:   { background:'#1e1e1e',borderRadius:8,padding:24,minWidth:320,maxWidth:400,color:'#eee',fontFamily:'monospace',fontSize:13,boxShadow:'0 8px 40px #000a' },
    label:   { color:'#aaa',display:'block',marginBottom:8 },
    row:     { display:'flex',alignItems:'center',gap:8,marginBottom:16 },
    input:   { background:'#2a2a2a',border:'1px solid #444',color:'#eee',borderRadius:4,padding:'8px 10px',flex:1,fontFamily:'monospace',fontSize:14 },
    suffix:  { color:'#666' },
    btn:     { background:'#2196F3',border:'none',color:'#fff',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13,fontWeight:'bold' },
    btnGrey: { background:'#333',border:'none',color:'#aaa',borderRadius:6,padding:'8px 18px',cursor:'pointer',fontFamily:'monospace',fontSize:13 },
    note:    { color:'#888',fontSize:11,marginBottom:16,lineHeight:1.4 },
  }

  const submit = () => {
    const clean = (name||'drawing').trim() || 'drawing'
    onSave(clean.toLowerCase().endsWith(extension) ? clean : clean+extension)
  }

  return (
    <div style={s.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={s.panel}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <span style={{fontSize:15,fontWeight:'bold',color:'#fff'}}>💾 Name Your File</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#888',fontSize:18,cursor:'pointer'}}>✕</button>
        </div>

        <p style={s.note}>Your browser can't ask which folder to use — it'll go to your usual Downloads folder. But you can give it a name!</p>

        <label style={s.label}>File name</label>
        <div style={s.row}>
          <input
            style={s.input}
            value={name}
            autoFocus
            onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); if(e.key==='Escape') onClose() }}
          />
          <span style={s.suffix}>{extension}</span>
        </div>

        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button style={s.btnGrey} onClick={onClose}>Cancel</button>
          <button style={s.btn} onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}
