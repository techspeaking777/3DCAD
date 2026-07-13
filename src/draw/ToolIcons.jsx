// ToolIcons.jsx — pixel-art sprite icons

import mirrorLoftIconSheet from '../assets/mirror-loft-icon.png'

const P = ({x,y,c,s=3}) => <rect x={x} y={y} width={s} height={s} fill={c}/>

// Crops one cell out of a raster sprite sheet for use INSIDE an <I> icon's own
// 0..48 viewBox — position/scale the full image so only the desired cell
// lands inside the viewBox; SVG clips everything outside it automatically,
// no clipPath needed (same trick App3D.jsx uses via CSS background-position
// for the solid-op/view-op sprite sheets, just done with an <image> element
// here since these icons render inside a shared <svg>, not a plain <div>).
function SpriteIcon({ sheet, sheetW, sheetH, cell, targetH }) {
  const scale = targetH / cell.h
  const dispW = cell.w * scale
  const x = (48 - dispW) / 2 - cell.x * scale
  const y = (48 - targetH) / 2 - cell.y * scale
  return (
    <image href={sheet} x={x} y={y} width={sheetW*scale} height={sheetH*scale}
      style={{imageRendering:'pixelated'}}/>
  )
}

// Pixel-art icon wrapper: 48×48 canvas + 14px label area = 48×62 total
const I = ({children,label,active}) => (
  <svg width="48" height="62" viewBox="0 0 48 62" fill="none"
    style={{imageRendering:'pixelated',display:'block'}}>
    <rect x="0" y="0" width="48" height="48" fill="#0a0020" rx="3"/>
    {active && <rect x="1" y="1" width="46" height="46" fill="none" stroke="#FFFF00" strokeWidth="2" rx="2"/>}
    {children}
    <text x="24" y="59" textAnchor="middle" fontFamily="monospace" fontSize="8"
      fill={active ? '#FFFF00' : '#999999'}>{label}</text>
  </svg>
)

// ── LINE ──────────────────────────────────────────────────────────────────────
// ── LINE ──────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconLine({ active }) {
  return (
    <I label="LINE" active={active}>
      {/* r=0 */}
      <P x={27} y={0} c="#ff0000"/><P x={30} y={0} c="#fb0404"/><P x={33} y={0} c="#ff0000"/>
      {/* r=1 */}
      <P x={24} y={3} c="#f7a1a1"/><P x={27} y={3} c="#f70808"/><P x={30} y={3} c="#ff0000"/><P x={33} y={3} c="#f70808"/><P x={36} y={3} c="#f7a1a1"/>
      {/* r=2 */}
      <P x={3} y={6} c="#ff0000"/><P x={6} y={6} c="#ff0000"/><P x={9} y={6} c="#ff0000"/><P x={12} y={6} c="#ff0000"/><P x={24} y={6} c="#f7a1a1"/><P x={27} y={6} c="#f70808"/><P x={30} y={6} c="#000000"/><P x={33} y={6} c="#f70808"/><P x={36} y={6} c="#f7a1a1"/>
      {/* r=3 */}
      <P x={3} y={9} c="#ff0000"/><P x={12} y={9} c="#ff0000"/><P x={27} y={9} c="#ff0000"/><P x={30} y={9} c="#000000"/><P x={33} y={9} c="#ff0000"/>
      {/* r=4 */}
      <P x={3} y={12} c="#ff0000"/><P x={12} y={12} c="#ff0000"/><P x={27} y={12} c="#ff0000"/><P x={30} y={12} c="#000000"/><P x={33} y={12} c="#ff0000"/>
      {/* r=5 */}
      <P x={3} y={15} c="#ff0000"/><P x={12} y={15} c="#ff0000"/><P x={27} y={15} c="#ff0000"/><P x={30} y={15} c="#000000"/><P x={33} y={15} c="#ff0000"/>
      {/* r=6 */}
      <P x={3} y={18} c="#ff0000"/><P x={12} y={18} c="#ff0000"/><P x={24} y={18} c="#fb8e8e"/><P x={27} y={18} c="#ff0000"/><P x={30} y={18} c="#ff0000"/><P x={33} y={18} c="#ff0000"/><P x={36} y={18} c="#fb8e8e"/>
      {/* r=7 */}
      <P x={3} y={21} c="#ff0000"/><P x={12} y={21} c="#ff0000"/><P x={24} y={21} c="#fb8e8e"/><P x={27} y={21} c="#f70808"/><P x={30} y={21} c="#ff0000"/><P x={33} y={21} c="#f70808"/><P x={36} y={21} c="#fb8e8e"/>
      {/* r=8 */}
      <P x={3} y={24} c="#ff0000"/><P x={12} y={24} c="#ff0000"/>
      {/* r=9 */}
      <P x={3} y={27} c="#ff0000"/><P x={12} y={27} c="#ff0000"/><P x={30} y={27} c="#ff0000"/>
      {/* r=10 */}
      <P x={3} y={30} c="#ff0000"/><P x={12} y={30} c="#ff0000"/><P x={30} y={30} c="#ff0000"/>
      {/* r=11 */}
      <P x={3} y={33} c="#ff0000"/><P x={12} y={33} c="#ff0000"/><P x={30} y={33} c="#ff0000"/>
      {/* r=12 */}
      <P x={3} y={36} c="#ff0000"/><P x={12} y={36} c="#ff0000"/><P x={15} y={36} c="#ff0000"/><P x={18} y={36} c="#ff0000"/><P x={21} y={36} c="#ff0000"/><P x={30} y={36} c="#ff0000"/>
      {/* r=13 */}
      <P x={3} y={39} c="#ff0000"/><P x={21} y={39} c="#ee4444"/><P x={30} y={39} c="#ff0000"/>
      {/* r=14 */}
      <P x={3} y={42} c="#ff0000"/><P x={21} y={42} c="#ff0000"/><P x={30} y={42} c="#ff0000"/>
      {/* r=15 */}
      <P x={3} y={45} c="#ff0000"/><P x={21} y={45} c="#ff0000"/><P x={24} y={45} c="#ff0000"/><P x={27} y={45} c="#ff0000"/><P x={30} y={45} c="#ff0000"/>
    </I>
  )
}

// ── CIRCLE ─────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconCircle({ active }) {
  return (
    <I label="CIRCLE" active={active}>
      {/* r=4 */}
      <P x={18} y={12} c="#4f4f4f"/><P x={21} y={12} c="#4f4f4f"/><P x={24} y={12} c="#4f4f4f"/><P x={27} y={12} c="#4f4f4f"/>
      {/* r=5 */}
      <P x={15} y={15} c="#4f4f4f"/><P x={21} y={15} c="#38c3ff"/><P x={24} y={15} c="#38c3ff"/><P x={27} y={15} c="#38c3ff"/><P x={30} y={15} c="#4f4f4f"/>
      {/* r=6 */}
      <P x={12} y={18} c="#4f4f4f"/><P x={18} y={18} c="#38c3ff"/><P x={21} y={18} c="#056df5"/><P x={24} y={18} c="#056df5"/><P x={27} y={18} c="#38c3ff"/><P x={30} y={18} c="#38c3ff"/><P x={33} y={18} c="#4f4f4f"/>
      {/* r=7 */}
      <P x={12} y={21} c="#4f4f4f"/><P x={15} y={21} c="#38c3ff"/><P x={18} y={21} c="#056df5"/><P x={21} y={21} c="#056df5"/><P x={24} y={21} c="#056df5"/><P x={27} y={21} c="#056df5"/><P x={30} y={21} c="#38c3ff"/><P x={33} y={21} c="#4f4f4f"/>
      {/* r=8 */}
      <P x={9} y={24} c="#4f4f4f"/><P x={12} y={24} c="#4f4f4f"/><P x={15} y={24} c="#4f4f4f"/><P x={18} y={24} c="#4f4f4f"/><P x={21} y={24} c="#4f4f4f"/><P x={24} y={24} c="#4f4f4f"/><P x={27} y={24} c="#4f4f4f"/><P x={30} y={24} c="#4f4f4f"/><P x={33} y={24} c="#4f4f4f"/><P x={36} y={24} c="#4f4f4f"/>
      {/* r=9 */}
      <P x={6} y={27} c="#4f4f4f"/><P x={12} y={27} c="#b0b0b0"/><P x={15} y={27} c="#b0b0b0"/><P x={18} y={27} c="#b0b0b0"/><P x={21} y={27} c="#b0b0b0"/><P x={24} y={27} c="#b0b0b0"/><P x={27} y={27} c="#b0b0b0"/><P x={30} y={27} c="#b0b0b0"/><P x={33} y={27} c="#878787"/><P x={36} y={27} c="#878787"/><P x={39} y={27} c="#4f4f4f"/>
      {/* r=10 */}
      <P x={3} y={30} c="#4f4f4f"/><P x={9} y={30} c="#b0b0b0"/><P x={12} y={30} c="#b0b0b0"/><P x={15} y={30} c="#d4ff00"/><P x={18} y={30} c="#b0b0b0"/><P x={21} y={30} c="#d4ff00"/><P x={24} y={30} c="#b0b0b0"/><P x={27} y={30} c="#d4ff00"/><P x={30} y={30} c="#b0b0b0"/><P x={33} y={30} c="#d4ff00"/><P x={36} y={30} c="#878787"/><P x={39} y={30} c="#878787"/><P x={42} y={30} c="#4f4f4f"/>
      {/* r=11 */}
      <P x={0} y={33} c="#4f4f4f"/><P x={6} y={33} c="#b0b0b0"/><P x={9} y={33} c="#b0b0b0"/><P x={12} y={33} c="#b0b0b0"/><P x={15} y={33} c="#b0b0b0"/><P x={18} y={33} c="#b0b0b0"/><P x={21} y={33} c="#b0b0b0"/><P x={24} y={33} c="#b0b0b0"/><P x={27} y={33} c="#b0b0b0"/><P x={30} y={33} c="#b0b0b0"/><P x={33} y={33} c="#b0b0b0"/><P x={36} y={33} c="#878787"/><P x={39} y={33} c="#878787"/><P x={42} y={33} c="#878787"/><P x={45} y={33} c="#4f4f4f"/>
      {/* r=12 */}
      <P x={0} y={36} c="#4f4f4f"/><P x={3} y={36} c="#4f4f4f"/><P x={6} y={36} c="#4f4f4f"/><P x={9} y={36} c="#4f4f4f"/><P x={12} y={36} c="#4f4f4f"/><P x={15} y={36} c="#4f4f4f"/><P x={18} y={36} c="#4f4f4f"/><P x={21} y={36} c="#4f4f4f"/><P x={24} y={36} c="#4f4f4f"/><P x={27} y={36} c="#4f4f4f"/><P x={30} y={36} c="#4f4f4f"/><P x={33} y={36} c="#4f4f4f"/><P x={36} y={36} c="#4f4f4f"/><P x={39} y={36} c="#4f4f4f"/><P x={42} y={36} c="#4f4f4f"/><P x={45} y={36} c="#4f4f4f"/>
      {/* r=13 */}
      <P x={3} y={39} c="#4f4f4f"/><P x={6} y={39} c="#b0b0b0"/><P x={9} y={39} c="#878787"/><P x={12} y={39} c="#4f4f4f"/><P x={18} y={39} c="#4f4f4f"/><P x={21} y={39} c="#b0b0b0"/><P x={24} y={39} c="#878787"/><P x={27} y={39} c="#4f4f4f"/><P x={33} y={39} c="#4f4f4f"/><P x={36} y={39} c="#b0b0b0"/><P x={39} y={39} c="#878787"/><P x={42} y={39} c="#4f4f4f"/>
      {/* r=14 */}
      <P x={6} y={42} c="#4f4f4f"/><P x={9} y={42} c="#4f4f4f"/><P x={21} y={42} c="#4f4f4f"/><P x={24} y={42} c="#4f4f4f"/><P x={36} y={42} c="#4f4f4f"/><P x={39} y={42} c="#4f4f4f"/>
      {/* r=15 */}
      <P x={3} y={45} c="#f5ed05"/><P x={6} y={45} c="#f50505"/><P x={9} y={45} c="#f50505"/><P x={12} y={45} c="#f5ed05"/><P x={18} y={45} c="#f5ed05"/><P x={21} y={45} c="#f50505"/><P x={24} y={45} c="#f50505"/><P x={27} y={45} c="#f5ed05"/><P x={33} y={45} c="#f5ed05"/><P x={36} y={45} c="#f50505"/><P x={39} y={45} c="#f50505"/><P x={42} y={45} c="#f5ed05"/>
    </I>
  )
}

// ── DELETE ─────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconDelete({ active }) {
  return (
    <I label="DELETE" active={active}>
      {/* r=3 */}
      <P x={0} y={9} c="#080808"/><P x={3} y={9} c="#080808"/><P x={6} y={9} c="#080808"/><P x={9} y={9} c="#080808"/><P x={12} y={9} c="#080808"/><P x={15} y={9} c="#080808"/><P x={18} y={9} c="#080808"/><P x={21} y={9} c="#080808"/>
      {/* r=4 */}
      <P x={0} y={12} c="#080808"/><P x={3} y={12} c="#080808"/><P x={6} y={12} c="#278604"/><P x={9} y={12} c="#278604"/><P x={12} y={12} c="#278604"/><P x={15} y={12} c="#278604"/><P x={18} y={12} c="#278604"/><P x={21} y={12} c="#080808"/>
      {/* r=5 */}
      <P x={0} y={15} c="#080808"/><P x={3} y={15} c="#278604"/><P x={6} y={15} c="#278604"/><P x={9} y={15} c="#080808"/><P x={12} y={15} c="#080808"/><P x={15} y={15} c="#080808"/><P x={18} y={15} c="#080808"/><P x={21} y={15} c="#080808"/><P x={24} y={15} c="#080808"/><P x={27} y={15} c="#080808"/><P x={30} y={15} c="#080808"/><P x={33} y={15} c="#080808"/><P x={36} y={15} c="#080808"/><P x={39} y={15} c="#080808"/><P x={42} y={15} c="#080808"/><P x={45} y={15} c="#080808"/>
      {/* r=6 */}
      <P x={0} y={18} c="#278604"/><P x={3} y={18} c="#050505"/><P x={6} y={18} c="#080808"/><P x={9} y={18} c="#080808"/><P x={12} y={18} c="#080808"/><P x={15} y={18} c="#080808"/><P x={18} y={18} c="#080808"/><P x={21} y={18} c="#080808"/><P x={24} y={18} c="#080808"/><P x={27} y={18} c="#278604"/><P x={30} y={18} c="#278604"/><P x={33} y={18} c="#278604"/><P x={36} y={18} c="#080808"/><P x={39} y={18} c="#278604"/><P x={42} y={18} c="#278604"/><P x={45} y={18} c="#278604"/>
      {/* r=7 */}
      <P x={0} y={21} c="#050505"/><P x={3} y={21} c="#278604"/><P x={6} y={21} c="#278604"/><P x={9} y={21} c="#278604"/><P x={12} y={21} c="#278604"/><P x={15} y={21} c="#278604"/><P x={18} y={21} c="#278604"/><P x={21} y={21} c="#278604"/><P x={24} y={21} c="#278604"/><P x={27} y={21} c="#278604"/><P x={30} y={21} c="#278604"/><P x={33} y={21} c="#050505"/><P x={36} y={21} c="#278604"/><P x={39} y={21} c="#e50606"/><P x={42} y={21} c="#e50606"/><P x={45} y={21} c="#e50606"/>
      {/* r=8 */}
      <P x={0} y={24} c="#278604"/><P x={3} y={24} c="#050505"/><P x={6} y={24} c="#278604"/><P x={9} y={24} c="#050505"/><P x={12} y={24} c="#278604"/><P x={15} y={24} c="#050505"/><P x={18} y={24} c="#278604"/><P x={21} y={24} c="#050505"/><P x={24} y={24} c="#278604"/><P x={27} y={24} c="#07a404"/><P x={30} y={24} c="#278604"/><P x={33} y={24} c="#278604"/><P x={36} y={24} c="#e50606"/><P x={39} y={24} c="#e50606"/><P x={42} y={24} c="#080808"/><P x={45} y={24} c="#080808"/>
      {/* r=9 */}
      <P x={0} y={27} c="#080808"/><P x={3} y={27} c="#278604"/><P x={6} y={27} c="#050505"/><P x={9} y={27} c="#278604"/><P x={12} y={27} c="#050505"/><P x={15} y={27} c="#278604"/><P x={18} y={27} c="#050505"/><P x={21} y={27} c="#278604"/><P x={24} y={27} c="#050505"/><P x={27} y={27} c="#278604"/><P x={30} y={27} c="#278604"/><P x={33} y={27} c="#278604"/><P x={36} y={27} c="#278604"/><P x={39} y={27} c="#278604"/><P x={42} y={27} c="#278604"/><P x={45} y={27} c="#278604"/>
      {/* r=10 */}
      <P x={0} y={30} c="#080808"/><P x={3} y={30} c="#080808"/><P x={6} y={30} c="#278604"/><P x={9} y={30} c="#278604"/><P x={12} y={30} c="#080808"/><P x={15} y={30} c="#080808"/><P x={18} y={30} c="#080808"/><P x={21} y={30} c="#080808"/><P x={24} y={30} c="#080808"/><P x={27} y={30} c="#278604"/><P x={30} y={30} c="#278604"/><P x={33} y={30} c="#278604"/><P x={36} y={30} c="#080808"/><P x={39} y={30} c="#080808"/><P x={42} y={30} c="#080808"/><P x={45} y={30} c="#080808"/>
      {/* r=11 */}
      <P x={0} y={33} c="#080808"/><P x={3} y={33} c="#080808"/><P x={6} y={33} c="#278604"/><P x={9} y={33} c="#278604"/><P x={12} y={33} c="#278604"/><P x={15} y={33} c="#080808"/><P x={24} y={33} c="#080808"/><P x={27} y={33} c="#080808"/><P x={30} y={33} c="#278604"/><P x={33} y={33} c="#278604"/><P x={36} y={33} c="#278604"/><P x={39} y={33} c="#080808"/>
      {/* r=12 */}
      <P x={3} y={36} c="#080808"/><P x={6} y={36} c="#080808"/><P x={9} y={36} c="#080808"/><P x={12} y={36} c="#080808"/><P x={15} y={36} c="#080808"/><P x={27} y={36} c="#080808"/><P x={30} y={36} c="#080808"/><P x={33} y={36} c="#080808"/><P x={36} y={36} c="#080808"/><P x={39} y={36} c="#080808"/>
    </I>
  )
}

// ── TRIM ──────────────────────────────────────────────────────────────────────
export function IconTrim({ active }) {
  return (
    <I label="TRIM" active={active}>
      <P x={3} y={3} c="#046b6c"/><P x={6} y={3} c="#046b6c"/><P x={9} y={3} c="#046b6c"/>
      <P x={3} y={6} c="#046b6c"/><P x={6} y={6} c="#28989a"/><P x={9} y={6} c="#4cc0c2"/><P x={12} y={6} c="#046b6c"/>
      <P x={3} y={9} c="#046b6c"/><P x={6} y={9} c="#4cc0c2"/><P x={9} y={9} c="#339c9e"/><P x={12} y={9} c="#339c9e"/><P x={15} y={9} c="#046b6c"/>
      <P x={6} y={12} c="#046b6c"/><P x={9} y={12} c="#3cc1c3"/><P x={12} y={12} c="#339c9e"/><P x={15} y={12} c="#3cc1c3"/><P x={18} y={12} c="#046b6c"/>
      <P x={9} y={15} c="#046b6c"/><P x={12} y={15} c="#3cc1c3"/><P x={15} y={15} c="#339c9e"/><P x={18} y={15} c="#3cc1c3"/><P x={21} y={15} c="#046b6c"/>
      <P x={12} y={18} c="#046b6c"/><P x={15} y={18} c="#3cc1c3"/><P x={18} y={18} c="#339c9e"/><P x={21} y={18} c="#3cc1c3"/><P x={24} y={18} c="#046b6c"/>
      <P x={15} y={21} c="#046b6c"/><P x={18} y={21} c="#3cc1c3"/><P x={21} y={21} c="#339c9e"/><P x={24} y={21} c="#3cc1c3"/><P x={27} y={21} c="#046b6c"/>
      <P x={18} y={24} c="#046b6c"/><P x={21} y={24} c="#3cc1c3"/><P x={24} y={24} c="#339c9e"/><P x={27} y={24} c="#3cc1c3"/><P x={30} y={24} c="#046b6c"/><P x={36} y={24} c="#046b6c"/><P x={39} y={24} c="#046b6c"/>
      <P x={21} y={27} c="#046b6c"/><P x={24} y={27} c="#3cc1c3"/><P x={27} y={27} c="#339c9e"/><P x={30} y={27} c="#3cc1c3"/><P x={33} y={27} c="#046b6c"/><P x={36} y={27} c="#339c9e"/><P x={39} y={27} c="#046b6c"/>
      <P x={24} y={30} c="#046b6c"/><P x={27} y={30} c="#3cc1c3"/><P x={30} y={30} c="#046b6c"/><P x={33} y={30} c="#339c9e"/><P x={36} y={30} c="#046b6c"/>
      <P x={27} y={33} c="#046b6c"/><P x={30} y={33} c="#339c9e"/><P x={33} y={33} c="#046b6c"/><P x={36} y={33} c="#eb9c2d"/><P x={39} y={33} c="#9e642e"/>
      <P x={24} y={36} c="#046b6c"/><P x={27} y={36} c="#339c9e"/><P x={30} y={36} c="#046b6c"/><P x={33} y={36} c="#7c590e"/><P x={36} y={36} c="#55371b"/><P x={39} y={36} c="#eb9c2d"/><P x={42} y={36} c="#9e642e"/>
      <P x={24} y={39} c="#046b6c"/><P x={27} y={39} c="#046b6c"/><P x={33} y={39} c="#7c590e"/><P x={36} y={39} c="#55371b"/><P x={39} y={39} c="#9e642e"/><P x={42} y={39} c="#046b6c"/>
      <P x={39} y={42} c="#7c590e"/><P x={42} y={42} c="#046b6c"/><P x={45} y={42} c="#3cc1c3"/>
      <P x={42} y={45} c="#046b6c"/><P x={45} y={45} c="#046b6c"/>
    </I>
  )
}

// ── JOIN ──────────────────────────────────────────────────────────────────────
export function IconJoin({ active }) {
  return (
    <I label="JOIN" active={active}>
      <P x={15} y={0} c="#e64141"/><P x={18} y={0} c="#e64141"/><P x={21} y={0} c="#e64141"/><P x={24} y={0} c="#e64141"/><P x={27} y={0} c="#e64141"/><P x={30} y={0} c="#e64141"/>
      <P x={12} y={3} c="#e64141"/><P x={15} y={3} c="#e64141"/><P x={21} y={3} c="#85888e"/><P x={24} y={3} c="#85888e"/><P x={30} y={3} c="#e64141"/><P x={33} y={3} c="#e64141"/>
      <P x={9} y={6} c="#e64141"/><P x={21} y={6} c="#85888e"/><P x={24} y={6} c="#85888e"/><P x={36} y={6} c="#e64141"/>
      <P x={6} y={9} c="#e64141"/><P x={21} y={9} c="#85888e"/><P x={24} y={9} c="#85888e"/><P x={39} y={9} c="#e64141"/>
      <P x={3} y={12} c="#e64141"/><P x={21} y={12} c="#85888e"/><P x={24} y={12} c="#85888e"/><P x={42} y={12} c="#e64141"/>
      <P x={0} y={15} c="#e64141"/><P x={3} y={15} c="#e64141"/><P x={21} y={15} c="#85888e"/><P x={24} y={15} c="#85888e"/><P x={42} y={15} c="#e64141"/><P x={45} y={15} c="#e64141"/>
      <P x={0} y={18} c="#e64141"/><P x={21} y={18} c="#85888e"/><P x={24} y={18} c="#85888e"/><P x={45} y={18} c="#e64141"/>
      <P x={0} y={21} c="#e64141"/><P x={3} y={21} c="#85888e"/><P x={6} y={21} c="#85888e"/><P x={9} y={21} c="#85888e"/><P x={12} y={21} c="#85888e"/><P x={15} y={21} c="#85888e"/><P x={18} y={21} c="#85888e"/><P x={27} y={21} c="#85888e"/><P x={30} y={21} c="#85888e"/><P x={33} y={21} c="#85888e"/><P x={36} y={21} c="#85888e"/><P x={39} y={21} c="#85888e"/><P x={42} y={21} c="#85888e"/><P x={45} y={21} c="#e64141"/>
      <P x={0} y={24} c="#e64141"/><P x={3} y={24} c="#85888e"/><P x={6} y={24} c="#85888e"/><P x={9} y={24} c="#85888e"/><P x={12} y={24} c="#85888e"/><P x={15} y={24} c="#85888e"/><P x={18} y={24} c="#85888e"/><P x={27} y={24} c="#85888e"/><P x={30} y={24} c="#85888e"/><P x={33} y={24} c="#85888e"/><P x={36} y={24} c="#85888e"/><P x={39} y={24} c="#85888e"/><P x={42} y={24} c="#85888e"/><P x={45} y={24} c="#e64141"/>
      <P x={0} y={27} c="#e64141"/><P x={21} y={27} c="#85888e"/><P x={24} y={27} c="#85888e"/><P x={45} y={27} c="#e64141"/>
      <P x={0} y={30} c="#e64141"/><P x={3} y={30} c="#e64141"/><P x={21} y={30} c="#85888e"/><P x={24} y={30} c="#85888e"/><P x={42} y={30} c="#e64141"/><P x={45} y={30} c="#e64141"/>
      <P x={3} y={33} c="#e64141"/><P x={21} y={33} c="#85888e"/><P x={24} y={33} c="#85888e"/><P x={42} y={33} c="#e64141"/>
      <P x={6} y={36} c="#e64141"/><P x={21} y={36} c="#85888e"/><P x={24} y={36} c="#85888e"/><P x={39} y={36} c="#e64141"/>
      <P x={9} y={39} c="#e64141"/><P x={21} y={39} c="#85888e"/><P x={24} y={39} c="#85888e"/><P x={36} y={39} c="#e64141"/>
      <P x={12} y={42} c="#e64141"/><P x={15} y={42} c="#e64141"/><P x={21} y={42} c="#85888e"/><P x={24} y={42} c="#85888e"/><P x={30} y={42} c="#e64141"/><P x={33} y={42} c="#e64141"/>
      <P x={15} y={45} c="#e64141"/><P x={18} y={45} c="#e64141"/><P x={21} y={45} c="#e64141"/><P x={24} y={45} c="#e64141"/><P x={27} y={45} c="#e64141"/><P x={30} y={45} c="#e64141"/>
    </I>
  )
}

// ── INCLUDE FROM FACE ──────────────────────────────────────────────────────
// Plain vector shapes (not the pixel-block style above) — a dashed square
// (the face being sketched on) with an arrow pulling its boundary out into a
// solid closed loop (the imported sketch geometry).
export function IconIncludeFace({ active }) {
  const c = active ? '#FFFF00' : '#4FC3F7'
  return (
    <I label="INCLUDE" active={active}>
      <rect x="4" y="10" width="16" height="16" rx="2" fill="none" stroke={c} strokeWidth="2" strokeDasharray="3 2"/>
      <path d="M22 18 L32 18" stroke={c} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M28 13 L34 18 L28 23" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="37" cy="30" r="7" fill="none" stroke={c} strokeWidth="2.5"/>
    </I>
  )
}

// ── 3D-ENVIRONMENT VECTOR ICONS ─────────────────────────────────────────────
// 80s vector-arcade style (Star Wars/Battlezone) — thin glowing lines, no
// fills, no pixel blocks. Rendered directly inside the 3D solid-op sidebar
// buttons (App3D.jsx), which draw their own label text below, so these
// return only the 70×70 icon graphic (not the 48×62 <I> pixel-art wrapper
// used above — that wrapper is specific to the sketch-tool theme).
function glow(color, blur = 5) {
  return { filter: `drop-shadow(0 0 ${blur}px ${color}) drop-shadow(0 0 ${blur * 2.5}px ${color}66)` }
}

// Isometric cube shared by extrude/cutout/fillet — same vertex layout as the
// original solid-icons.png sprite sheet's badge art (top rhombus + two side
// faces, front-top vertex at F), just redrawn as glowing vector lines with a
// tri-tone fill (top brightest, right mid, left darkest) standing in for the
// sprite's flat-shaded gradient faces. Vertices: T(35,16) R(57,28) F(35,40)
// L(13,28), dropping down to F2(35,64)/R2(57,52)/L2(13,52).
function IsoCube({ color }) {
  return (
    <>
      <path d="M35 16 L57 28 L35 40 L13 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L57 28 L57 52 L35 64 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L13 28 L13 52 L35 64 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.75"/>
    </>
  )
}

// Dotted ground-shadow ellipse, same motif under every solid-icon cube in the
// original sprite sheet.
function GroundShadow({ color, cy = 66 }) {
  return <ellipse cx="35" cy={cy} rx="24" ry="4" stroke={color} strokeWidth="1" strokeDasharray="1 3" opacity="0.4"/>
}

export function IconExtrude3D({ color = '#FBDA2D' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      <IsoCube color={color}/>
      {/* dashed link + arrow rising straight off the top face, same as the
          original badge art's yellow up-arrow */}
      <line x1="35" y1="16" x2="35" y2="10" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
      <line x1="35" y1="9" x2="35" y2="1" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 6 L35 0 L40 6" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconCutout3D({ color = '#53D3E4' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      {/* right/left faces solid; top face becomes a hollow frame (looking
          down into the cavity) instead of a filled cap */}
      <path d="M35 40 L57 28 L57 52 L35 64 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L13 28 L13 52 L35 64 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.75"/>
      <path d="M35 16 L57 28 L35 40 L13 28 Z" fill="none" stroke={color} strokeWidth="1.75"/>
      <path d="M35 22 L46 28 L35 34 L24 28 Z" fill="#000" fillOpacity="0.55" stroke={color} strokeWidth="1.25"/>
      <line x1="35" y1="16" x2="35" y2="22" stroke={color} strokeWidth="1"/>
      <line x1="57" y1="28" x2="46" y2="28" stroke={color} strokeWidth="1"/>
      <line x1="35" y1="40" x2="35" y2="34" stroke={color} strokeWidth="1"/>
      <line x1="13" y1="28" x2="24" y2="28" stroke={color} strokeWidth="1"/>
      {/* arrow plunging down into the hole */}
      <line x1="35" y1="1" x2="35" y2="15" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 9 L35 15 L40 9" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconFillet3D({ color = '#A470F2' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      <IsoCube color={color}/>
      {/* rounded-edge highlight replacing the cube's sharp front corner */}
      <path d="M35 40 Q42 52 35 64" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      {/* floating "pick an edge to fillet" affordance, top right */}
      <path d="M50 10 A9 9 0 0 1 59 17" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
      <path d="M59 11 L59 23 M53 17 L65 17" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export function IconMirror3D({ color = '#8E65F3' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <line x1="35" y1="8" x2="35" y2="60" stroke={color} strokeWidth="1.5" strokeDasharray="3 3"/>
      <path d="M31 16 L25 19 L31 22" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M39 16 L45 19 L39 22" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      {/* a smaller cube on each side of the mirror line */}
      <path d="M18 22 L29 28 L18 34 L7 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M18 34 L29 28 L29 40 L18 46 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      <path d="M18 34 L7 28 L7 40 L18 46 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
      <path d="M52 22 L41 28 L52 34 L63 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M52 34 L41 28 L41 40 L52 46 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      <path d="M52 34 L63 28 L63 40 L52 46 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
      <ellipse cx="18" cy="48" rx="13" ry="2.5" stroke={color} strokeWidth="1" strokeDasharray="1 2" opacity="0.4"/>
      <ellipse cx="52" cy="48" rx="13" ry="2.5" stroke={color} strokeWidth="1" strokeDasharray="1 2" opacity="0.4"/>
    </svg>
  )
}

export function IconLoft3D({ color = '#33D5EC' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      {/* small top profile, dashed extension flaring out to the lofted body's
          wide top opening */}
      <path d="M35 4 L41 8 L35 12 L29 8 Z" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
      <line x1="29" y1="8" x2="16" y2="30" stroke={color} strokeWidth="1.25" strokeDasharray="2 2"/>
      <line x1="41" y1="8" x2="54" y2="30" stroke={color} strokeWidth="1.25" strokeDasharray="2 2"/>
      {/* tapered 3-face body (wide top opening narrowing to a smaller base) —
          same top/right/left tri-tone shading convention as IsoCube, just
          tapered, instead of a single flat-toned trapezoid */}
      <path d="M35 20 L54 30 L35 40 L16 30 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L54 30 L47 52 L35 58 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L16 30 L23 52 L35 58 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.75"/>
      {/* dashed extension converging to the small bottom profile */}
      <line x1="23" y1="52" x2="29" y2="64" stroke={color} strokeWidth="1.25" strokeDasharray="2 2"/>
      <line x1="47" y1="52" x2="41" y2="64" stroke={color} strokeWidth="1.25" strokeDasharray="2 2"/>
      <path d="M35 60 L41 64 L35 68 L29 64 Z" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
    </svg>
  )
}

export function IconJoin3D({ color = '#FFEE88' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color} cy="48"/>
      {/* two cubes interlocked at a shared seam, x=35 */}
      <path d="M24 22 L35 28 L24 34 L13 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M24 34 L35 28 L35 40 L24 46 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      <path d="M24 34 L13 28 L13 40 L24 46 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
      <path d="M46 22 L57 28 L46 34 L35 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M46 34 L57 28 L57 40 L46 46 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      <path d="M46 34 L35 28 L35 40 L46 46 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
      {/* glowing spark at the seam where they join */}
      <path d="M35 12 L35 24 M29 18 L41 18" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M31 12 L33 15 M39 12 L37 15 M31 24 L33 21 M39 24 L37 21" stroke={color} strokeWidth="1.25" strokeLinecap="round" opacity="0.7"/>
    </svg>
  )
}

export function IconMeasure3D({ color = '#4FC3F7' }) {
  return (
    <svg width="70" height="70" viewBox="0 0 70 70" fill="none" style={glow(color)}>
      {/* extension lines */}
      <line x1="16" y1="14" x2="16" y2="48" stroke={color} strokeWidth="1.5" opacity="0.6"/>
      <line x1="54" y1="14" x2="54" y2="48" stroke={color} strokeWidth="1.5" opacity="0.6"/>
      {/* dimension line + double arrowhead — length/distance */}
      <line x1="16" y1="30" x2="54" y2="30" stroke={color} strokeWidth="2.5"/>
      <path d="M23 24 L16 30 L23 36" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M47 24 L54 30 L47 36" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* diameter glyph */}
      <circle cx="35" cy="53" r="7" stroke={color} strokeWidth="2"/>
      <line x1="30.5" y1="57.5" x2="39.5" y2="48.5" stroke={color} strokeWidth="1.5"/>
    </svg>
  )
}

// ── MOVE ──────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconMove({ active }) {
  return (
    <I label="MOVE" active={active}>
      {/* r=1 */}
      <P x={21} y={3} c="#78d21e"/><P x={27} y={3} c="#b5f575"/><P x={30} y={3} c="#59e859"/><P x={33} y={3} c="#59e859"/><P x={36} y={3} c="#b5f575"/>
      {/* r=2 */}
      <P x={21} y={6} c="#59e859"/><P x={27} y={6} c="#d21e1e"/><P x={30} y={6} c="#65fb65"/><P x={33} y={6} c="#65fb65"/><P x={36} y={6} c="#d21e1e"/><P x={42} y={6} c="#59e859"/><P x={45} y={6} c="#78d21e"/>
      {/* r=3 */}
      <P x={21} y={9} c="#59e859"/><P x={24} y={9} c="#59e859"/><P x={27} y={9} c="#59e859"/><P x={30} y={9} c="#65fb65"/><P x={33} y={9} c="#65fb65"/><P x={36} y={9} c="#59e859"/><P x={39} y={9} c="#59e859"/><P x={42} y={9} c="#59e859"/>
      {/* r=4 */}
      <P x={27} y={12} c="#65fb65"/><P x={30} y={12} c="#b5f575"/><P x={33} y={12} c="#b5f575"/><P x={36} y={12} c="#59e859"/>
      {/* r=5 */}
      <P x={24} y={15} c="#59e859"/><P x={27} y={15} c="#59e859"/><P x={30} y={15} c="#59e859"/><P x={33} y={15} c="#b5f575"/><P x={36} y={15} c="#59e859"/><P x={39} y={15} c="#59e859"/>
      {/* r=6 */}
      <P x={24} y={18} c="#59e859"/><P x={30} y={18} c="#59e859"/><P x={33} y={18} c="#59e859"/><P x={39} y={18} c="#59e859"/>
      {/* r=7 */}
      <P x={21} y={21} c="#9ef24a"/><P x={24} y={21} c="#59e859"/><P x={39} y={21} c="#59e859"/><P x={42} y={21} c="#9ef24a"/>
      {/* r=9 */}
      <P x={0} y={27} c="#59e859"/><P x={6} y={27} c="#b5f575"/><P x={9} y={27} c="#49fb09"/><P x={12} y={27} c="#49fb09"/><P x={15} y={27} c="#b5f575"/>
      {/* r=10 */}
      <P x={0} y={30} c="#49fb09"/><P x={6} y={30} c="#d21e1e"/><P x={9} y={30} c="#59e859"/><P x={12} y={30} c="#49fb09"/><P x={15} y={30} c="#d21e1e"/><P x={21} y={30} c="#49fb09"/><P x={24} y={30} c="#59e859"/>
      {/* r=11 */}
      <P x={0} y={33} c="#49fb09"/><P x={3} y={33} c="#49fb09"/><P x={6} y={33} c="#49fb09"/><P x={9} y={33} c="#49fb09"/><P x={12} y={33} c="#49fb09"/><P x={15} y={33} c="#49fb09"/><P x={18} y={33} c="#49fb09"/><P x={21} y={33} c="#49fb09"/>
      {/* r=12 */}
      <P x={6} y={36} c="#49fb09"/><P x={9} y={36} c="#b5f575"/><P x={12} y={36} c="#b5f575"/><P x={15} y={36} c="#49fb09"/>
      {/* r=13 */}
      <P x={3} y={39} c="#49fb09"/><P x={6} y={39} c="#49fb09"/><P x={9} y={39} c="#49fb09"/><P x={12} y={39} c="#b5f575"/><P x={15} y={39} c="#49fb09"/><P x={18} y={39} c="#49fb09"/>
      {/* r=14 */}
      <P x={3} y={42} c="#49fb09"/><P x={9} y={42} c="#49fb09"/><P x={12} y={42} c="#49fb09"/><P x={18} y={42} c="#49fb09"/>
      {/* r=15 */}
      <P x={0} y={45} c="#49fb09"/><P x={3} y={45} c="#49fb09"/><P x={18} y={45} c="#49fb09"/><P x={21} y={45} c="#49fb09"/>
    </I>
  )
}

// ── MIRROR ────────────────────────────────────────────────────────────────────
const MIRROR_LOFT_SHEET_W = 1536, MIRROR_LOFT_SHEET_H = 1024
const MIRROR_CELL = { x:146, y:283, w:535, h:519 }

export function IconMirror({ active }) {
  return (
    <I label="MIRROR" active={active}>
      <SpriteIcon sheet={mirrorLoftIconSheet} sheetW={MIRROR_LOFT_SHEET_W} sheetH={MIRROR_LOFT_SHEET_H}
        cell={MIRROR_CELL} targetH={44}/>
    </I>
  )
}

// ── CENTRE ────────────────────────────────────────────────────────────────────
export function IconCenter({ active }) {
  return (
    <I label="CENTRE" active={active}>
      {/* octagonal ring */}
      <P x={33} y={24} c="#7ef7fb"/>
      <P x={30} y={15} c="#7ef7fb"/>
      <P x={24} y={12} c="#7ef7fb"/>
      <P x={18} y={15} c="#7ef7fb"/>
      <P x={15} y={24} c="#7ef7fb"/>
      <P x={18} y={33} c="#7ef7fb"/>
      <P x={24} y={36} c="#7ef7fb"/>
      <P x={30} y={33} c="#7ef7fb"/>
      {/* crosshair ticks, one step outside the ring */}
      <P x={24} y={9}  c="#ffd500"/>
      <P x={24} y={39} c="#ffd500"/>
      <P x={36} y={24} c="#ffd500"/>
      <P x={12} y={24} c="#ffd500"/>
      {/* center dot */}
      <P x={24} y={24} c="#ffd500"/>
    </I>
  )
}

// ── SCALE ─────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconScale({ active }) {
  return (
    <I label="SCALE" active={active}>
      {/* r=2 */}
      <P x={30} y={6} c="#f60404"/><P x={33} y={6} c="#f60404"/><P x={36} y={6} c="#f60404"/>
      {/* r=3 */}
      <P x={27} y={9} c="#f60404"/><P x={30} y={9} c="#f67904"/><P x={33} y={9} c="#f67904"/><P x={36} y={9} c="#f67904"/><P x={39} y={9} c="#f60404"/>
      {/* r=4 */}
      <P x={24} y={12} c="#f60404"/><P x={27} y={12} c="#f67904"/><P x={30} y={12} c="#f67904"/><P x={33} y={12} c="#f2f604"/><P x={36} y={12} c="#f2f604"/><P x={39} y={12} c="#f67904"/><P x={42} y={12} c="#f60404"/>
      {/* r=5 */}
      <P x={24} y={15} c="#f60404"/><P x={27} y={15} c="#f67904"/><P x={30} y={15} c="#f2f604"/><P x={33} y={15} c="#f2f604"/><P x={36} y={15} c="#f2f604"/><P x={39} y={15} c="#f67904"/><P x={42} y={15} c="#f60404"/>
      {/* r=6 */}
      <P x={24} y={18} c="#f60404"/><P x={27} y={18} c="#f67904"/><P x={30} y={18} c="#f2f604"/><P x={33} y={18} c="#f2f604"/><P x={36} y={18} c="#f2f604"/><P x={39} y={18} c="#f67904"/><P x={42} y={18} c="#f60404"/>
      {/* r=7 */}
      <P x={27} y={21} c="#f60404"/><P x={30} y={21} c="#f67904"/><P x={33} y={21} c="#f67904"/><P x={36} y={21} c="#f67904"/><P x={39} y={21} c="#f60404"/>
      {/* r=8 */}
      <P x={18} y={24} c="#f60404"/><P x={21} y={24} c="#f60404"/><P x={30} y={24} c="#f60404"/><P x={33} y={24} c="#f60404"/><P x={36} y={24} c="#f60404"/>
      {/* r=9 */}
      <P x={15} y={27} c="#f60404"/><P x={18} y={27} c="#f69104"/><P x={21} y={27} c="#f69104"/><P x={24} y={27} c="#f60404"/>
      {/* r=10 */}
      <P x={15} y={30} c="#f60404"/><P x={18} y={30} c="#f69104"/><P x={21} y={30} c="#f69104"/><P x={24} y={30} c="#f60404"/>
      {/* r=11 */}
      <P x={6} y={33} c="#f60404"/><P x={18} y={33} c="#f60404"/><P x={21} y={33} c="#f60404"/>
      {/* r=12 */}
      <P x={3} y={36} c="#f60404"/><P x={6} y={36} c="#f69104"/><P x={9} y={36} c="#f60404"/>
      {/* r=13 */}
      <P x={6} y={39} c="#f60404"/>
    </I>
  )
}

// ── ROTATE ────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconRotate({ active }) {
  return (
    <I label="ROTATE" active={active}>
      {/* r=0 */}
      <P x={18} y={0} c="#788991"/><P x={21} y={0} c="#788991"/><P x={24} y={0} c="#788991"/><P x={27} y={0} c="#788991"/>
      {/* r=1 */}
      <P x={21} y={3} c="#03d843"/><P x={24} y={3} c="#03d843"/><P x={27} y={3} c="#03d843"/><P x={30} y={3} c="#788991"/>
      {/* r=2 */}
      <P x={18} y={6} c="#fff700"/><P x={24} y={6} c="#03d843"/><P x={27} y={6} c="#03d843"/><P x={30} y={6} c="#03d843"/><P x={33} y={6} c="#788991"/><P x={36} y={6} c="#788991"/><P x={39} y={6} c="#788991"/>
      {/* r=3 */}
      <P x={18} y={9} c="#ff0000"/><P x={21} y={9} c="#03d843"/><P x={24} y={9} c="#03d843"/><P x={27} y={9} c="#8bbcda"/><P x={30} y={9} c="#8bbcda"/><P x={33} y={9} c="#8bbcda"/><P x={36} y={9} c="#8bbcda"/><P x={39} y={9} c="#788991"/><P x={42} y={9} c="#788991"/><P x={45} y={9} c="#788991"/>
      {/* r=4 */}
      <P x={18} y={12} c="#fff700"/><P x={24} y={12} c="#03d843"/><P x={27} y={12} c="#03d843"/><P x={30} y={12} c="#03d843"/><P x={33} y={12} c="#788991"/><P x={36} y={12} c="#788991"/><P x={39} y={12} c="#788991"/>
      {/* r=5 */}
      <P x={21} y={15} c="#03d843"/><P x={24} y={15} c="#03d843"/><P x={27} y={15} c="#03d843"/><P x={30} y={15} c="#788991"/>
      {/* r=6 */}
      <P x={9} y={18} c="#788991"/><P x={18} y={18} c="#788991"/><P x={21} y={18} c="#788991"/><P x={24} y={18} c="#788991"/><P x={27} y={18} c="#788991"/>
      {/* r=7 */}
      <P x={9} y={21} c="#788991"/>
      {/* r=8 */}
      <P x={6} y={24} c="#788991"/><P x={9} y={24} c="#788991"/><P x={12} y={24} c="#788991"/>
      {/* r=9 */}
      <P x={6} y={27} c="#788991"/><P x={9} y={27} c="#8bbcda"/><P x={12} y={27} c="#788991"/>
      {/* r=10 */}
      <P x={6} y={30} c="#788991"/><P x={9} y={30} c="#8bbcda"/><P x={12} y={30} c="#788991"/>
      {/* r=11 */}
      <P x={3} y={33} c="#788991"/><P x={6} y={33} c="#03d843"/><P x={9} y={33} c="#8bbcda"/><P x={12} y={33} c="#03d843"/><P x={15} y={33} c="#788991"/>
      {/* r=12 */}
      <P x={0} y={36} c="#788991"/><P x={3} y={36} c="#03d843"/><P x={6} y={36} c="#03d843"/><P x={9} y={36} c="#8bbcda"/><P x={12} y={36} c="#03d843"/><P x={15} y={36} c="#03d843"/><P x={18} y={36} c="#788991"/>
      {/* r=13 */}
      <P x={0} y={39} c="#788991"/><P x={3} y={39} c="#03d843"/><P x={6} y={39} c="#03d843"/><P x={9} y={39} c="#03d843"/><P x={12} y={39} c="#03d843"/><P x={15} y={39} c="#03d843"/><P x={18} y={39} c="#788991"/>
      {/* r=14 */}
      <P x={0} y={42} c="#788991"/><P x={3} y={42} c="#03d843"/><P x={9} y={42} c="#03d843"/><P x={15} y={42} c="#03d843"/><P x={18} y={42} c="#788991"/>
      {/* r=15 */}
      <P x={0} y={45} c="#788991"/><P x={6} y={45} c="#fff700"/><P x={9} y={45} c="#ff0000"/><P x={12} y={45} c="#fff700"/><P x={18} y={45} c="#788991"/>
    </I>
  )
}

// ── FILLET ────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconFillet({ active }) {
  return (
    <I label="FILLET" active={active}>
      {/* r=0 */}
      <P x={15} y={0} c="#03dffc"/><P x={18} y={0} c="#000000"/><P x={21} y={0} c="#03dffc"/>
      {/* r=1 */}
      <P x={15} y={3} c="#03dffc"/><P x={18} y={3} c="#000000"/><P x={21} y={3} c="#03dffc"/>
      {/* r=2 */}
      <P x={15} y={6} c="#03dffc"/><P x={18} y={6} c="#000000"/><P x={21} y={6} c="#03dffc"/><P x={30} y={6} c="#f70820"/><P x={33} y={6} c="#f70820"/><P x={36} y={6} c="#f70820"/>
      {/* r=3 */}
      <P x={15} y={9} c="#03dffc"/><P x={18} y={9} c="#000000"/><P x={21} y={9} c="#03dffc"/><P x={27} y={9} c="#f70820"/><P x={30} y={9} c="#f70820"/><P x={33} y={9} c="#f70820"/><P x={36} y={9} c="#f70820"/><P x={39} y={9} c="#f70820"/>
      {/* r=4 */}
      <P x={15} y={12} c="#03dffc"/><P x={18} y={12} c="#000000"/><P x={21} y={12} c="#03dffc"/><P x={27} y={12} c="#f70820"/><P x={30} y={12} c="#ffffff"/><P x={33} y={12} c="#f70820"/><P x={36} y={12} c="#ffffff"/><P x={39} y={12} c="#f70820"/>
      {/* r=5 */}
      <P x={15} y={15} c="#03dffc"/><P x={18} y={15} c="#000000"/><P x={21} y={15} c="#03dffc"/><P x={27} y={15} c="#f70820"/><P x={30} y={15} c="#f70820"/><P x={33} y={15} c="#f70820"/><P x={36} y={15} c="#f70820"/><P x={39} y={15} c="#f70820"/>
      {/* r=6 */}
      <P x={15} y={18} c="#03dffc"/><P x={18} y={18} c="#000000"/><P x={21} y={18} c="#03dffc"/><P x={27} y={18} c="#f70820"/><P x={30} y={18} c="#f70820"/><P x={33} y={18} c="#f70820"/><P x={36} y={18} c="#f70820"/><P x={39} y={18} c="#f70820"/>
      {/* r=7 */}
      <P x={15} y={21} c="#03dffc"/><P x={18} y={21} c="#000000"/><P x={21} y={21} c="#03dffc"/><P x={27} y={21} c="#f70820"/><P x={33} y={21} c="#f70820"/><P x={39} y={21} c="#f70820"/>
      {/* r=8 */}
      <P x={15} y={24} c="#03dffc"/><P x={18} y={24} c="#000000"/><P x={21} y={24} c="#03dffc"/>
      {/* r=9 */}
      <P x={15} y={27} c="#03dffc"/><P x={18} y={27} c="#0d0d0d"/><P x={21} y={27} c="#03dffc"/><P x={24} y={27} c="#00e1ff"/>
      {/* r=10 */}
      <P x={15} y={30} c="#03dffc"/><P x={18} y={30} c="#0d0d0d"/><P x={21} y={30} c="#0d0d0d"/><P x={24} y={30} c="#03dffc"/><P x={27} y={30} c="#00e1ff"/>
      {/* r=11 */}
      <P x={15} y={33} c="#03dffc"/><P x={18} y={33} c="#03dffc"/><P x={21} y={33} c="#0d0d0d"/><P x={24} y={33} c="#000000"/><P x={27} y={33} c="#03dffc"/><P x={30} y={33} c="#03dffc"/><P x={33} y={33} c="#03dffc"/><P x={36} y={33} c="#03dffc"/><P x={39} y={33} c="#03dffc"/><P x={42} y={33} c="#03dffc"/><P x={45} y={33} c="#03dffc"/>
      {/* r=12 */}
      <P x={18} y={36} c="#03dffc"/><P x={21} y={36} c="#03dffc"/><P x={24} y={36} c="#0d0d0d"/><P x={27} y={36} c="#000000"/><P x={30} y={36} c="#000000"/><P x={33} y={36} c="#000000"/><P x={36} y={36} c="#000000"/><P x={39} y={36} c="#000000"/><P x={42} y={36} c="#000000"/><P x={45} y={36} c="#000000"/>
      {/* r=13 */}
      <P x={21} y={39} c="#03dffc"/><P x={24} y={39} c="#03dffc"/><P x={27} y={39} c="#03dffc"/><P x={30} y={39} c="#03dffc"/><P x={33} y={39} c="#03dffc"/><P x={36} y={39} c="#03dffc"/><P x={39} y={39} c="#03dffc"/><P x={42} y={39} c="#03dffc"/><P x={45} y={39} c="#03dffc"/>
    </I>
  )
}

// ── EXTEND ────────────────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconExtend({ active }) {
  return (
    <I label="EXTEND" active={active}>
      {/* r=0 */}
      <P x={6} y={0} c="#f02828"/><P x={21} y={0} c="#ff0000"/><P x={36} y={0} c="#f02828"/>
      {/* r=1 */}
      <P x={3} y={3} c="#ff0000"/><P x={9} y={3} c="#ff0000"/><P x={18} y={3} c="#ff0000"/><P x={24} y={3} c="#ff0000"/><P x={33} y={3} c="#ff0000"/><P x={39} y={3} c="#ff0000"/>
      {/* r=2 */}
      <P x={6} y={6} c="#ff0000"/><P x={21} y={6} c="#ff0000"/><P x={36} y={6} c="#f02828"/>
      {/* r=3 */}
      <P x={6} y={9} c="#ff0000"/><P x={36} y={9} c="#ff0000"/>
      {/* r=4 */}
      <P x={6} y={12} c="#ff0000"/><P x={21} y={12} c="#a6a6a6"/><P x={36} y={12} c="#f02828"/>
      {/* r=5 */}
      <P x={21} y={15} c="#a6a6a6"/>
      {/* r=6 */}
      <P x={6} y={18} c="#f90b96"/><P x={18} y={18} c="#f90b96"/><P x={21} y={18} c="#a6a6a6"/><P x={24} y={18} c="#f90b96"/><P x={36} y={18} c="#f90b96"/>
      {/* r=7 */}
      <P x={6} y={21} c="#a6a6a6"/><P x={15} y={21} c="#a6a6a6"/><P x={18} y={21} c="#a6a6a6"/><P x={21} y={21} c="#174be8"/><P x={24} y={21} c="#a6a6a6"/><P x={27} y={21} c="#a6a6a6"/><P x={36} y={21} c="#a6a6a6"/>
      {/* r=8 */}
      <P x={6} y={24} c="#a6a6a6"/><P x={12} y={24} c="#d6d6d6"/><P x={15} y={24} c="#a6a6a6"/><P x={18} y={24} c="#174be8"/><P x={21} y={24} c="#174be8"/><P x={24} y={24} c="#174be8"/><P x={27} y={24} c="#a6a6a6"/><P x={30} y={24} c="#d6d6d6"/><P x={36} y={24} c="#a6a6a6"/>
      {/* r=9 */}
      <P x={6} y={27} c="#a6a6a6"/><P x={9} y={27} c="#d6d6d6"/><P x={12} y={27} c="#d6d6d6"/><P x={15} y={27} c="#a6a6a6"/><P x={18} y={27} c="#707275"/><P x={21} y={27} c="#707275"/><P x={24} y={27} c="#707275"/><P x={27} y={27} c="#a6a6a6"/><P x={30} y={27} c="#d6d6d6"/><P x={33} y={27} c="#d6d6d6"/><P x={36} y={27} c="#a6a6a6"/>
      {/* r=10 */}
      <P x={6} y={30} c="#a6a6a6"/><P x={9} y={30} c="#d6d6d6"/><P x={12} y={30} c="#d6d6d6"/><P x={15} y={30} c="#a6a6a6"/><P x={18} y={30} c="#a6a6a6"/><P x={21} y={30} c="#707275"/><P x={24} y={30} c="#a6a6a6"/><P x={27} y={30} c="#a6a6a6"/><P x={30} y={30} c="#d6d6d6"/><P x={33} y={30} c="#d6d6d6"/><P x={36} y={30} c="#a6a6a6"/>
      {/* r=11 */}
      <P x={6} y={33} c="#a6a6a6"/><P x={9} y={33} c="#d6d6d6"/><P x={12} y={33} c="#a6a6a6"/><P x={15} y={33} c="#a6a6a6"/><P x={18} y={33} c="#707275"/><P x={21} y={33} c="#8d8b8b"/><P x={24} y={33} c="#707275"/><P x={27} y={33} c="#a6a6a6"/><P x={30} y={33} c="#a6a6a6"/><P x={33} y={33} c="#d6d6d6"/><P x={36} y={33} c="#a6a6a6"/>
      {/* r=12 */}
      <P x={6} y={36} c="#a6a6a6"/><P x={9} y={36} c="#a6a6a6"/><P x={12} y={36} c="#a6a6a6"/><P x={18} y={36} c="#8d8b8b"/><P x={21} y={36} c="#8d8b8b"/><P x={24} y={36} c="#8d8b8b"/><P x={30} y={36} c="#a6a6a6"/><P x={33} y={36} c="#a6a6a6"/><P x={36} y={36} c="#a6a6a6"/>
      {/* r=13 */}
      <P x={6} y={39} c="#a6a6a6"/><P x={18} y={39} c="#e9f90b"/><P x={21} y={39} c="#ff4d00"/><P x={24} y={39} c="#e9f90b"/><P x={36} y={39} c="#a6a6a6"/>
      {/* r=14 */}
      <P x={18} y={42} c="#e9f90b"/><P x={21} y={42} c="#ff4d00"/><P x={24} y={42} c="#e9f90b"/>
      {/* r=15 */}
      <P x={18} y={45} c="#e9f90b"/><P x={21} y={45} c="#f1f50a"/><P x={24} y={45} c="#e9f90b"/>
    </I>
  )
}

// ── OFFSET (pixel art) ────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconOffset({ active }) {
  return (
    <I label="OFFSET" active={active}>
      {/* r=2 */}
      <P x={18} y={6} c="#f5ed05"/><P x={21} y={6} c="#f5ed05"/><P x={24} y={6} c="#f5ed05"/>
      {/* r=3 */}
      <P x={15} y={9} c="#f5ed05"/><P x={27} y={9} c="#f5ed05"/><P x={33} y={9} c="#f5ed05"/><P x={36} y={9} c="#f5ed05"/>
      {/* r=4 */}
      <P x={3} y={12} c="#f5ed05"/><P x={6} y={12} c="#f5ed05"/><P x={9} y={12} c="#f5ed05"/><P x={12} y={12} c="#f5ed05"/><P x={30} y={12} c="#f5ed05"/><P x={39} y={12} c="#f5ed05"/>
      {/* r=5 */}
      <P x={3} y={15} c="#f5ed05"/><P x={18} y={15} c="#3981f3"/><P x={21} y={15} c="#3981f3"/><P x={24} y={15} c="#3981f3"/><P x={39} y={15} c="#f5ed05"/>
      {/* r=6 */}
      <P x={3} y={18} c="#f5ed05"/><P x={15} y={18} c="#3981f3"/><P x={18} y={18} c="#3981f3"/><P x={21} y={18} c="#3981f3"/><P x={24} y={18} c="#3981f3"/><P x={27} y={18} c="#3981f3"/><P x={33} y={18} c="#3981f3"/><P x={39} y={18} c="#f5ed05"/>
      {/* r=7 */}
      <P x={3} y={21} c="#f5ed05"/><P x={9} y={21} c="#3981f3"/><P x={12} y={21} c="#3981f3"/><P x={15} y={21} c="#3981f3"/><P x={21} y={21} c="#3981f3"/><P x={27} y={21} c="#3981f3"/><P x={30} y={21} c="#3981f3"/><P x={33} y={21} c="#3981f3"/><P x={39} y={21} c="#f5ed05"/>
      {/* r=8 */}
      <P x={3} y={24} c="#f5ed05"/><P x={9} y={24} c="#3981f3"/><P x={15} y={24} c="#3981f3"/><P x={18} y={24} c="#3981f3"/><P x={21} y={24} c="#3981f3"/><P x={24} y={24} c="#3981f3"/><P x={27} y={24} c="#3981f3"/><P x={39} y={24} c="#f5ed05"/>
      {/* r=9 */}
      <P x={3} y={27} c="#f5ed05"/><P x={18} y={27} c="#3981f3"/><P x={24} y={27} c="#3981f3"/><P x={36} y={27} c="#f5ed05"/><P x={39} y={27} c="#f5ed05"/>
      {/* r=10 */}
      <P x={3} y={30} c="#f5ed05"/><P x={6} y={30} c="#f5ed05"/><P x={15} y={30} c="#3981f3"/><P x={18} y={30} c="#3981f3"/><P x={24} y={30} c="#3981f3"/><P x={27} y={30} c="#3981f3"/><P x={33} y={30} c="#f5ed05"/>
      {/* r=11 */}
      <P x={9} y={33} c="#f5ed05"/><P x={33} y={33} c="#f5ed05"/>
      {/* r=12 */}
      <P x={9} y={36} c="#f5ed05"/><P x={21} y={36} c="#f5ed05"/><P x={33} y={36} c="#f5ed05"/>
      {/* r=13 */}
      <P x={9} y={39} c="#f5ed05"/><P x={12} y={39} c="#f5ed05"/><P x={15} y={39} c="#f5ed05"/><P x={18} y={39} c="#f5ed05"/><P x={24} y={39} c="#f5ed05"/><P x={27} y={39} c="#f5ed05"/><P x={30} y={39} c="#f5ed05"/>
    </I>
  )
}

// ── GUIDE ─────────────────────────────────────────────────────────────────────
export function IconGuide({ active }) {
  return (
    <I label="GUIDE" active={active}>
      {/* r=1 */}
      <P x={15} y={3} c="#f7fb04"/><P x={18} y={3} c="#f7fb04"/><P x={21} y={3} c="#f7fb04"/><P x={24} y={3} c="#f7fb04"/><P x={27} y={3} c="#f7fb04"/>
      {/* r=2 */}
      <P x={15} y={6} c="#f7fb04"/><P x={18} y={6} c="#f7fb04"/><P x={21} y={6} c="#f7fb04"/><P x={24} y={6} c="#f7fb04"/><P x={27} y={6} c="#f7fb04"/><P x={30} y={6} c="#f7fb04"/>
      {/* r=3 */}
      <P x={12} y={9} c="#f7fb04"/><P x={15} y={9} c="#f7fb04"/><P x={30} y={9} c="#f7fb04"/><P x={33} y={9} c="#f7fb04"/>
      {/* r=4 */}
      <P x={12} y={12} c="#f7fb04"/><P x={15} y={12} c="#f7fb04"/><P x={30} y={12} c="#f7fb04"/><P x={33} y={12} c="#f7fb04"/>
      {/* r=5 */}
      <P x={12} y={15} c="#f7fb04"/><P x={15} y={15} c="#f7fb04"/><P x={30} y={15} c="#f7fb04"/><P x={33} y={15} c="#f7fb04"/>
      {/* r=6 */}
      <P x={12} y={18} c="#f7fb04"/><P x={15} y={18} c="#f7fb04"/><P x={30} y={18} c="#f7fb04"/><P x={33} y={18} c="#f7fb04"/>
      {/* r=7 */}
      <P x={27} y={21} c="#f7fb04"/><P x={30} y={21} c="#f7fb04"/>
      {/* r=8 */}
      <P x={21} y={24} c="#f7fb04"/><P x={24} y={24} c="#f7fb04"/><P x={27} y={24} c="#f7fb04"/><P x={30} y={24} c="#f7fb04"/>
      {/* r=9 */}
      <P x={21} y={27} c="#f7fb04"/><P x={24} y={27} c="#f7fb04"/>
      {/* r=10 */}
      <P x={21} y={30} c="#f7fb04"/><P x={24} y={30} c="#f7fb04"/>
      {/* r=11 */}
      <P x={21} y={33} c="#f7fb04"/><P x={24} y={33} c="#f7fb04"/>
      {/* r=12 */}
      <P x={21} y={36} c="#f7fb04"/><P x={24} y={36} c="#f7fb04"/>
      {/* r=14 */}
      <P x={21} y={42} c="#f7fb04"/><P x={24} y={42} c="#f7fb04"/>
      {/* r=15 */}
      <P x={21} y={45} c="#f7fb04"/><P x={24} y={45} c="#f7fb04"/>
    </I>
  )
}

// ── ALIASES for App.jsx which uses old names ──────────────────────────────────
// These let App.jsx keep its existing imports without changes
export const IconMoveCopy    = IconMove
export const IconRotateCopy  = IconRotate
export const IconResize      = IconScale

// ── Utility / vector icons (kept at 28×28 for bottom toolbar) ─────────────────
const V = (props) => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}/>
)

// ── TRACE (pixel art) ─────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconTrace({ active }) {
  return (
    <I label="TRACE" active={active}>
      {/* r=2 */}
      <P x={9} y={6} c="#f50000"/><P x={12} y={6} c="#f50000"/><P x={15} y={6} c="#f50000"/><P x={18} y={6} c="#f50000"/><P x={21} y={6} c="#f50000"/><P x={24} y={6} c="#f50000"/><P x={27} y={6} c="#f50000"/><P x={30} y={6} c="#f50000"/><P x={33} y={6} c="#f50000"/><P x={36} y={6} c="#f50000"/>
      {/* r=3 */}
      <P x={6} y={9} c="#f50000"/><P x={9} y={9} c="#f50000"/><P x={12} y={9} c="#e4f500"/><P x={15} y={9} c="#e4f500"/><P x={18} y={9} c="#e4f500"/><P x={21} y={9} c="#e4f500"/><P x={24} y={9} c="#e4f500"/><P x={27} y={9} c="#e4f500"/><P x={30} y={9} c="#e4f500"/><P x={33} y={9} c="#e4f500"/><P x={36} y={9} c="#f50000"/><P x={39} y={9} c="#f50000"/>
      {/* r=4 */}
      <P x={3} y={12} c="#f50000"/><P x={6} y={12} c="#f50000"/><P x={9} y={12} c="#e4f500"/><P x={12} y={12} c="#e4f500"/><P x={15} y={12} c="#007ef5"/><P x={18} y={12} c="#007ef5"/><P x={21} y={12} c="#007ef5"/><P x={24} y={12} c="#007ef5"/><P x={27} y={12} c="#007ef5"/><P x={30} y={12} c="#007ef5"/><P x={33} y={12} c="#e4f500"/><P x={36} y={12} c="#e4f500"/><P x={39} y={12} c="#f50000"/><P x={42} y={12} c="#f50000"/>
      {/* r=5 */}
      <P x={3} y={15} c="#f50000"/><P x={6} y={15} c="#e4f500"/><P x={9} y={15} c="#e4f500"/><P x={12} y={15} c="#007ef5"/><P x={15} y={15} c="#007ef5"/><P x={18} y={15} c="#00fa32"/><P x={21} y={15} c="#00fa32"/><P x={24} y={15} c="#00fa32"/><P x={27} y={15} c="#00fa32"/><P x={30} y={15} c="#007ef5"/><P x={33} y={15} c="#007ef5"/><P x={36} y={15} c="#e4f500"/><P x={39} y={15} c="#e4f500"/><P x={42} y={15} c="#f50000"/>
      {/* r=6 */}
      <P x={3} y={18} c="#f50000"/><P x={6} y={18} c="#e4f500"/><P x={9} y={18} c="#007ef5"/><P x={12} y={18} c="#007ef5"/><P x={15} y={18} c="#10f500"/><P x={18} y={18} c="#00fa32"/><P x={21} y={18} c="#00fa32"/><P x={24} y={18} c="#00fa32"/><P x={27} y={18} c="#00fa32"/><P x={30} y={18} c="#00fa32"/><P x={33} y={18} c="#007ef5"/><P x={36} y={18} c="#007ef5"/><P x={39} y={18} c="#e4f500"/><P x={42} y={18} c="#f50000"/>
      {/* r=7 */}
      <P x={3} y={21} c="#f50000"/><P x={6} y={21} c="#e4f500"/><P x={9} y={21} c="#007ef5"/><P x={12} y={21} c="#00fa32"/><P x={15} y={21} c="#00fa32"/><P x={18} y={21} c="#007ef5"/><P x={21} y={21} c="#00fa32"/><P x={24} y={21} c="#00fa32"/><P x={27} y={21} c="#007ef5"/><P x={30} y={21} c="#00fa32"/><P x={33} y={21} c="#00fa32"/><P x={36} y={21} c="#007ef5"/><P x={39} y={21} c="#e4f500"/><P x={42} y={21} c="#f50000"/>
      {/* r=8 */}
      <P x={0} y={24} c="#f50000"/><P x={3} y={24} c="#f50000"/><P x={6} y={24} c="#e4f500"/><P x={9} y={24} c="#007ef5"/><P x={12} y={24} c="#00fa32"/><P x={15} y={24} c="#00fa32"/><P x={18} y={24} c="#00fa32"/><P x={21} y={24} c="#00fa32"/><P x={24} y={24} c="#00fa32"/><P x={27} y={24} c="#00fa32"/><P x={30} y={24} c="#00fa32"/><P x={33} y={24} c="#00fa32"/><P x={36} y={24} c="#007ef5"/><P x={39} y={24} c="#e4f500"/><P x={42} y={24} c="#f50000"/><P x={45} y={24} c="#f50000"/>
      {/* r=9 */}
      <P x={0} y={27} c="#f50000"/><P x={3} y={27} c="#e4f500"/><P x={6} y={27} c="#e4f500"/><P x={9} y={27} c="#007ef5"/><P x={12} y={27} c="#007ef5"/><P x={15} y={27} c="#00fa32"/><P x={18} y={27} c="#007ef5"/><P x={21} y={27} c="#00fa32"/><P x={24} y={27} c="#00fa32"/><P x={27} y={27} c="#007ef5"/><P x={30} y={27} c="#00fa32"/><P x={33} y={27} c="#007ef5"/><P x={36} y={27} c="#007ef5"/><P x={39} y={27} c="#e4f500"/><P x={42} y={27} c="#e4f500"/><P x={45} y={27} c="#f50000"/>
      {/* r=10 */}
      <P x={0} y={30} c="#f50000"/><P x={3} y={30} c="#e4f500"/><P x={6} y={30} c="#007ef5"/><P x={9} y={30} c="#007ef5"/><P x={12} y={30} c="#00fa32"/><P x={15} y={30} c="#007ef5"/><P x={18} y={30} c="#007ef5"/><P x={21} y={30} c="#007ef5"/><P x={24} y={30} c="#007ef5"/><P x={27} y={30} c="#007ef5"/><P x={30} y={30} c="#007ef5"/><P x={33} y={30} c="#00fa32"/><P x={36} y={30} c="#007ef5"/><P x={39} y={30} c="#007ef5"/><P x={42} y={30} c="#e4f500"/><P x={45} y={30} c="#f50000"/>
      {/* r=11 */}
      <P x={0} y={33} c="#f50000"/><P x={3} y={33} c="#e4f500"/><P x={6} y={33} c="#007ef5"/><P x={9} y={33} c="#00fa32"/><P x={12} y={33} c="#00fa32"/><P x={15} y={33} c="#007ef5"/><P x={18} y={33} c="#e4f500"/><P x={21} y={33} c="#e4f500"/><P x={24} y={33} c="#e4f500"/><P x={27} y={33} c="#e4f500"/><P x={30} y={33} c="#007ef5"/><P x={33} y={33} c="#00fa32"/><P x={36} y={33} c="#00fa32"/><P x={39} y={33} c="#007ef5"/><P x={42} y={33} c="#e4f500"/><P x={45} y={33} c="#f50000"/>
      {/* r=12 */}
      <P x={0} y={36} c="#f50000"/><P x={3} y={36} c="#e4f500"/><P x={6} y={36} c="#007ef5"/><P x={9} y={36} c="#007ef5"/><P x={12} y={36} c="#007ef5"/><P x={15} y={36} c="#007ef5"/><P x={18} y={36} c="#e4f500"/><P x={21} y={36} c="#f50000"/><P x={24} y={36} c="#f50000"/><P x={27} y={36} c="#e4f500"/><P x={30} y={36} c="#007ef5"/><P x={33} y={36} c="#007ef5"/><P x={36} y={36} c="#007ef5"/><P x={39} y={36} c="#007ef5"/><P x={42} y={36} c="#e4f500"/><P x={45} y={36} c="#f50000"/>
      {/* r=13 */}
      <P x={0} y={39} c="#f50000"/><P x={3} y={39} c="#e4f500"/><P x={6} y={39} c="#e4f500"/><P x={9} y={39} c="#e4f500"/><P x={12} y={39} c="#e4f500"/><P x={15} y={39} c="#e4f500"/><P x={18} y={39} c="#e4f500"/><P x={21} y={39} c="#f50000"/><P x={24} y={39} c="#f50000"/><P x={27} y={39} c="#e4f500"/><P x={30} y={39} c="#e4f500"/><P x={33} y={39} c="#e4f500"/><P x={36} y={39} c="#e4f500"/><P x={39} y={39} c="#e4f500"/><P x={42} y={39} c="#e4f500"/><P x={45} y={39} c="#f50000"/>
      {/* r=14 */}
      <P x={0} y={42} c="#f50000"/><P x={3} y={42} c="#f50000"/><P x={6} y={42} c="#f50000"/><P x={9} y={42} c="#f50000"/><P x={12} y={42} c="#f50000"/><P x={15} y={42} c="#f50000"/><P x={18} y={42} c="#f50000"/><P x={21} y={42} c="#f50000"/><P x={24} y={42} c="#f50000"/><P x={27} y={42} c="#f50000"/><P x={30} y={42} c="#f50000"/><P x={33} y={42} c="#f50000"/><P x={36} y={42} c="#f50000"/><P x={39} y={42} c="#f50000"/><P x={42} y={42} c="#f50000"/><P x={45} y={42} c="#f50000"/>
    </I>
  )
}

export function IconUndo({ active }) {
  const c = active ? '#fff' : '#888'
  return (
    <V>
      <path d="M7 14 A7 7 0 1 1 14 21" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <polygon points="4,9 4,16 11,12" fill={c}/>
    </V>
  )
}

export function IconRedo({ active }) {
  const c = active ? '#fff' : '#888'
  return (
    <V>
      <path d="M21 14 A7 7 0 1 0 14 21" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <polygon points="24,9 24,16 17,12" fill={c}/>
    </V>
  )
}

export function IconFitView() {
  return (
    <V>
      <polyline points="3,10 3,3 10,3" stroke="#ccc" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="18,3 25,3 25,10" stroke="#ccc" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="3,18 3,25 10,25" stroke="#ccc" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points="18,25 25,25 25,18" stroke="#ccc" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="9" y="9" width="10" height="10" rx="1.5" stroke="#3b82f6" strokeWidth="1.5" fill="none"/>
    </V>
  )
}

export function IconSave() {
  return (
    <V>
      <rect x="4" y="3" width="20" height="22" rx="2" fill="#374151" stroke="#4ade80" strokeWidth="1.5"/>
      <rect x="7" y="3" width="11" height="9" rx="1" fill="#6b7280"/>
      <rect x="13" y="4" width="3" height="6" rx="0.5" fill="#374151"/>
      <rect x="7" y="15" width="14" height="8" rx="1" fill="#4b5563"/>
    </V>
  )
}

export function IconLoad() {
  return (
    <V>
      <rect x="2" y="8" width="24" height="17" rx="2" fill="#2563eb"/>
      <rect x="2" y="5" width="10" height="6" rx="2" fill="#3b82f6"/>
      <rect x="2" y="11" width="24" height="14" rx="1.5" fill="#3b82f6"/>
      <line x1="14" y1="23" x2="14" y2="14" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"/>
      <polygon points="10,17 14,13 18,17" fill="#fbbf24"/>
    </V>
  )
}

export function IconDXF() {
  return (
    <V>
      <rect x="4" y="2" width="16" height="20" rx="2" fill="#374151" stroke="#fbbf24" strokeWidth="1.5"/>
      <path d="M16 2 L20 6 L16 6 Z" fill="#fbbf24"/>
      <text x="12" y="17" fontSize="7" fill="#fbbf24" fontFamily="monospace" fontWeight="bold" textAnchor="middle">DXF</text>
      <line x1="21" y1="18" x2="26" y2="18" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round"/>
      <polygon points="23,15 27,18 23,21" fill="#fbbf24"/>
    </V>
  )
}

export function IconSpline({ active }) {
  return (
    <I label="SPLINE" active={active}>
      {/* r=2 */}
      <P x={12} y={6} c="#eaed45"/><P x={15} y={6} c="#eaed45"/><P x={18} y={6} c="#eaed45"/><P x={21} y={6} c="#eaed45"/><P x={24} y={6} c="#eaed45"/><P x={27} y={6} c="#eaed45"/>
      <P x={42} y={6} c="#45be19"/>
      {/* r=3 */}
      <P x={9} y={9} c="#eaed45"/><P x={12} y={9} c="#45be19"/><P x={15} y={9} c="#45be19"/><P x={18} y={9} c="#45be19"/><P x={21} y={9} c="#45be19"/><P x={24} y={9} c="#45be19"/><P x={27} y={9} c="#45be19"/><P x={30} y={9} c="#eaed45"/><P x={39} y={9} c="#eaed45"/><P x={42} y={9} c="#45be19"/>
      {/* r=4 */}
      <P x={3} y={12} c="#eaed45"/><P x={6} y={12} c="#eaed45"/><P x={9} y={12} c="#45be19"/><P x={30} y={12} c="#45be19"/><P x={33} y={12} c="#eaed45"/><P x={39} y={12} c="#45be19"/>
      {/* r=5 */}
      <P x={0} y={15} c="#eaed45"/><P x={3} y={15} c="#45be19"/><P x={6} y={15} c="#45be19"/><P x={30} y={15} c="#45be19"/><P x={33} y={15} c="#45be19"/><P x={36} y={15} c="#eaed45"/><P x={39} y={15} c="#45be19"/>
      {/* r=6 */}
      <P x={0} y={18} c="#eaed45"/><P x={3} y={18} c="#45be19"/><P x={12} y={18} c="#45be19"/><P x={15} y={18} c="#45be19"/><P x={18} y={18} c="#45be19"/><P x={21} y={18} c="#45be19"/><P x={24} y={18} c="#45be19"/><P x={36} y={18} c="#45be19"/><P x={39} y={18} c="#45be19"/>
      {/* r=7 */}
      <P x={3} y={21} c="#eaed45"/><P x={6} y={21} c="#45be19"/><P x={9} y={21} c="#45be19"/><P x={12} y={21} c="#45be19"/><P x={15} y={21} c="#eaed45"/><P x={18} y={21} c="#eaed45"/><P x={21} y={21} c="#eaed45"/><P x={24} y={21} c="#45be19"/><P x={27} y={21} c="#45be19"/>
      {/* r=8 */}
      <P x={6} y={24} c="#eaed45"/><P x={9} y={24} c="#eaed45"/><P x={12} y={24} c="#eaed45"/><P x={24} y={24} c="#eaed45"/><P x={27} y={24} c="#45be19"/><P x={30} y={24} c="#45be19"/><P x={33} y={24} c="#45be19"/>
      {/* r=9 */}
      <P x={24} y={27} c="#eaed45"/><P x={27} y={27} c="#eaed45"/><P x={30} y={27} c="#eaed45"/><P x={33} y={27} c="#45be19"/><P x={36} y={27} c="#45be19"/>
      {/* r=10 */}
      <P x={3} y={30} c="#eaed45"/><P x={6} y={30} c="#45be19"/><P x={9} y={30} c="#45be19"/><P x={12} y={30} c="#45be19"/><P x={15} y={30} c="#eaed45"/><P x={33} y={30} c="#eaed45"/><P x={36} y={30} c="#45be19"/>
      {/* r=11 */}
      <P x={0} y={33} c="#000000"/><P x={3} y={33} c="#45be19"/><P x={6} y={33} c="#eaed45"/><P x={9} y={33} c="#eaed45"/><P x={12} y={33} c="#45be19"/><P x={15} y={33} c="#eaed45"/><P x={33} y={33} c="#eaed45"/><P x={36} y={33} c="#45be19"/>
      {/* r=12 */}
      <P x={0} y={36} c="#2ec230"/><P x={3} y={36} c="#2ec230"/><P x={6} y={36} c="#2ec230"/><P x={12} y={36} c="#45be19"/><P x={15} y={36} c="#45be19"/><P x={27} y={36} c="#eaed45"/><P x={30} y={36} c="#eaed45"/><P x={33} y={36} c="#eaed45"/><P x={36} y={36} c="#45be19"/>
      {/* r=13 */}
      <P x={0} y={39} c="#2ec230"/><P x={3} y={39} c="#2ec230"/><P x={6} y={39} c="#000000"/><P x={12} y={39} c="#45be19"/><P x={15} y={39} c="#45be19"/><P x={18} y={39} c="#eaed45"/><P x={21} y={39} c="#eaed45"/><P x={24} y={39} c="#eaed45"/><P x={27} y={39} c="#45be19"/><P x={30} y={39} c="#45be19"/><P x={33} y={39} c="#45be19"/>
      {/* r=14 */}
      <P x={12} y={42} c="#45be19"/><P x={15} y={42} c="#45be19"/><P x={18} y={42} c="#45be19"/><P x={21} y={42} c="#45be19"/><P x={24} y={42} c="#45be19"/>
    </I>
  )
}

// ── TEXT (pixel art) ──────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconText({ active }) {
  return (
    <I label="TEXT" active={active}>
      {/* r=2 */}
      <P x={9} y={6} c="#f7f255"/><P x={12} y={6} c="#f7f255"/><P x={15} y={6} c="#f7f255"/><P x={18} y={6} c="#f7f255"/><P x={21} y={6} c="#f7f255"/><P x={24} y={6} c="#f7f255"/><P x={27} y={6} c="#f7f255"/><P x={30} y={6} c="#f7f255"/><P x={33} y={6} c="#f7f255"/>
      {/* r=3 */}
      <P x={9} y={9} c="#f7f255"/><P x={12} y={9} c="#f7f255"/><P x={15} y={9} c="#f7f255"/><P x={18} y={9} c="#f7f255"/><P x={21} y={9} c="#f7f255"/><P x={24} y={9} c="#f7f255"/><P x={27} y={9} c="#f7f255"/><P x={30} y={9} c="#f7f255"/><P x={33} y={9} c="#f7f255"/><P x={36} y={9} c="#f75555"/>
      {/* r=4 */}
      <P x={9} y={12} c="#f7f255"/><P x={12} y={12} c="#f7f255"/><P x={15} y={12} c="#f7f255"/><P x={18} y={12} c="#f7f255"/><P x={21} y={12} c="#f7f255"/><P x={24} y={12} c="#f7f255"/><P x={27} y={12} c="#f7f255"/><P x={30} y={12} c="#f7f255"/><P x={33} y={12} c="#f7f255"/><P x={36} y={12} c="#f75555"/>
      {/* r=5 */}
      <P x={12} y={15} c="#f75555"/><P x={15} y={15} c="#f75555"/><P x={18} y={15} c="#f7f255"/><P x={21} y={15} c="#f7f255"/><P x={24} y={15} c="#f7f255"/><P x={27} y={15} c="#f75555"/><P x={30} y={15} c="#f75555"/><P x={33} y={15} c="#f75555"/><P x={36} y={15} c="#f75555"/>
      {/* r=6 */}
      <P x={18} y={18} c="#f7f255"/><P x={21} y={18} c="#f7f255"/><P x={24} y={18} c="#f7f255"/><P x={27} y={18} c="#f75555"/>
      {/* r=7 */}
      <P x={18} y={21} c="#f7f255"/><P x={21} y={21} c="#f7f255"/><P x={24} y={21} c="#f7f255"/><P x={27} y={21} c="#f75555"/>
      {/* r=8 */}
      <P x={18} y={24} c="#f7f255"/><P x={21} y={24} c="#f7f255"/><P x={24} y={24} c="#f7f255"/><P x={27} y={24} c="#f75555"/>
      {/* r=9 */}
      <P x={18} y={27} c="#f7f255"/><P x={21} y={27} c="#f7f255"/><P x={24} y={27} c="#f7f255"/><P x={27} y={27} c="#f75555"/>
      {/* r=10 */}
      <P x={18} y={30} c="#f7f255"/><P x={21} y={30} c="#f7f255"/><P x={24} y={30} c="#f7f255"/><P x={27} y={30} c="#f75555"/>
      {/* r=11 */}
      <P x={18} y={33} c="#f7f255"/><P x={21} y={33} c="#f7f255"/><P x={24} y={33} c="#f7f255"/><P x={27} y={33} c="#f75555"/>
      {/* r=12 */}
      <P x={18} y={36} c="#f7f255"/><P x={21} y={36} c="#f7f255"/><P x={24} y={36} c="#f7f255"/><P x={27} y={36} c="#f75555"/>
      {/* r=13 */}
      <P x={18} y={39} c="#f7f255"/><P x={21} y={39} c="#f7f255"/><P x={24} y={39} c="#f7f255"/><P x={27} y={39} c="#f75555"/>
      {/* r=14 */}
      <P x={21} y={42} c="#f75555"/><P x={24} y={42} c="#f75555"/><P x={27} y={42} c="#f75555"/>
    </I>
  )
}

// ── SELECT (pixel art) ────────────────────────────────────────────────────────
// x=c*3, y=r*3 from original raw pixel array
export function IconSelect({ active }) {
  return (
    <I label="SELECT" active={active}>
      {/* r=1 */}
      <P x={3} y={3} c="#1c00f0"/><P x={6} y={3} c="#f03000"/><P x={9} y={3} c="#f03000"/><P x={12} y={3} c="#f03000"/><P x={15} y={3} c="#f03000"/><P x={18} y={3} c="#f03000"/><P x={21} y={3} c="#1c00f0"/><P x={24} y={3} c="#f03000"/><P x={27} y={3} c="#f03000"/><P x={30} y={3} c="#f03000"/><P x={33} y={3} c="#f03000"/><P x={36} y={3} c="#f03000"/><P x={39} y={3} c="#f03000"/><P x={42} y={3} c="#1c00f0"/>
      {/* r=2 */}
      <P x={3} y={6} c="#f03000"/><P x={42} y={6} c="#f03000"/>
      {/* r=3 */}
      <P x={3} y={9} c="#f03000"/><P x={42} y={9} c="#f03000"/>
      {/* r=4 */}
      <P x={3} y={12} c="#f03000"/><P x={42} y={12} c="#f03000"/>
      {/* r=5 */}
      <P x={3} y={15} c="#f03000"/><P x={18} y={15} c="#00fa32"/><P x={21} y={15} c="#00fa32"/><P x={24} y={15} c="#00fa32"/><P x={27} y={15} c="#00fa32"/><P x={42} y={15} c="#f03000"/>
      {/* r=6 */}
      <P x={3} y={18} c="#f03000"/><P x={15} y={18} c="#00fa32"/><P x={18} y={18} c="#00fa32"/><P x={21} y={18} c="#00fa32"/><P x={24} y={18} c="#00fa32"/><P x={27} y={18} c="#00fa32"/><P x={30} y={18} c="#00fa32"/><P x={42} y={18} c="#f03000"/>
      {/* r=7 */}
      <P x={3} y={21} c="#fa0000"/><P x={12} y={21} c="#00fa32"/><P x={15} y={21} c="#00fa32"/><P x={21} y={21} c="#00fa32"/><P x={24} y={21} c="#00fa32"/><P x={30} y={21} c="#00fa32"/><P x={33} y={21} c="#00fa32"/><P x={42} y={21} c="#fa0000"/>
      {/* r=8 */}
      <P x={3} y={24} c="#1c00f0"/><P x={12} y={24} c="#00fa32"/><P x={15} y={24} c="#00fa32"/><P x={18} y={24} c="#00fa32"/><P x={21} y={24} c="#00fa32"/><P x={24} y={24} c="#00fa32"/><P x={27} y={24} c="#00fa32"/><P x={30} y={24} c="#00fa32"/><P x={33} y={24} c="#00fa32"/><P x={42} y={24} c="#1c00f0"/>
      {/* r=9 */}
      <P x={3} y={27} c="#f03000"/><P x={15} y={27} c="#00fa32"/><P x={21} y={27} c="#00fa32"/><P x={24} y={27} c="#00fa32"/><P x={30} y={27} c="#00fa32"/><P x={42} y={27} c="#f03000"/>
      {/* r=10 */}
      <P x={3} y={30} c="#f03000"/><P x={12} y={30} c="#00fa32"/><P x={33} y={30} c="#00fa32"/><P x={42} y={30} c="#f03000"/>
      {/* r=11 */}
      <P x={3} y={33} c="#f03000"/><P x={9} y={33} c="#00fa32"/><P x={12} y={33} c="#00fa32"/><P x={33} y={33} c="#00fa32"/><P x={36} y={33} c="#00fa32"/><P x={42} y={33} c="#f03000"/>
      {/* r=12 */}
      <P x={3} y={36} c="#f03000"/><P x={42} y={36} c="#f03000"/>
      {/* r=13 */}
      <P x={3} y={39} c="#f03000"/><P x={42} y={39} c="#f03000"/>
      {/* r=14 */}
      <P x={3} y={42} c="#1c00f0"/><P x={6} y={42} c="#f03000"/><P x={9} y={42} c="#f03000"/><P x={12} y={42} c="#f03000"/><P x={15} y={42} c="#f03000"/><P x={18} y={42} c="#f03000"/><P x={21} y={42} c="#1c00f0"/><P x={24} y={42} c="#f03000"/><P x={27} y={42} c="#f03000"/><P x={30} y={42} c="#f03000"/><P x={33} y={42} c="#f03000"/><P x={36} y={42} c="#f03000"/><P x={39} y={42} c="#f03000"/><P x={42} y={42} c="#1c00f0"/>
    </I>
  )
}

export function IconDim({ active }) {
  return (
    <I label="DIM" active={active}>
      {/* r=1 */}
      <P x={36} y={3} c="#f50000"/><P x={39} y={3} c="#f50000"/><P x={42} y={3} c="#f50000"/>
      {/* r=2 */}
      <P x={39} y={6} c="#f50000"/><P x={42} y={6} c="#f50000"/>
      {/* r=3 */}
      <P x={36} y={9} c="#f50000"/><P x={42} y={9} c="#f50000"/>
      {/* r=4 */}
      <P x={33} y={12} c="#f50000"/>
      {/* r=5 */}
      <P x={30} y={15} c="#f50000"/>
      {/* r=6 */}
      <P x={27} y={18} c="#f50000"/>
      {/* r=7 */}
      <P x={24} y={21} c="#f50000"/>
      {/* r=8 */}
      <P x={21} y={24} c="#f50000"/>
      {/* r=9 */}
      <P x={18} y={27} c="#f50000"/>
      {/* r=10 */}
      <P x={15} y={30} c="#f50000"/>
      {/* r=11 */}
      <P x={12} y={33} c="#f50000"/>
      {/* r=12 */}
      <P x={3} y={36} c="#f50000"/><P x={9} y={36} c="#f50000"/>
      {/* r=13 */}
      <P x={3} y={39} c="#f50000"/><P x={6} y={39} c="#f50000"/>
      {/* r=14 */}
      <P x={3} y={42} c="#f50000"/><P x={6} y={42} c="#f50000"/><P x={9} y={42} c="#f50000"/>
    </I>
  )
}

// ── AXIS (revolve axis) ─────────────────────────────────────────────────────
// A diagonal dash-dot line — the standard CAD convention for a centerline/axis.
export function IconAxis({ active }) {
  const cells = []
  // Diagonal from top-left to bottom-right, dash-dot-dash-dot pattern (period of 4 cells).
  for (let i = 0; i < 15; i++) {
    const pattern = i % 4
    if (pattern === 3) continue   // gap
    const isDot = pattern === 2
    const x = 3 + i*3, y = 3 + i*3
    // Light neutral gray, not #333333 — that was nearly invisible against the
    // icon's own dark navy background despite being the "right" CAD color.
    cells.push(<P key={i} x={x} y={y} c="#E0E0E0" s={isDot ? 2 : 3}/>)
  }
  return (
    <I label="REV AXIS" active={active}>
      {cells}
    </I>
  )
}
