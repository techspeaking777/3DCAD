// ToolIcons.jsx — tool icons.
//
// Sketch tools: 80s vector-arcade style to match the 3D tool buttons — thin
// glowing lines, standard CAD pictures (Trim = a line with a cut-off dashed
// piece, Fillet = a rounded corner …) so what students learn here carries over
// to Fusion / Onshape / Solid Edge. Each group of tools has one colour:
const SK = {
  select:    '#7ED957',   // Select
  draw:      '#53D3E4',   // Line, Circle, Spline, Text, Axis, Trace, Edge
  edit:      '#FF9F1C',   // Trim, Delete, Extend, Join, Fillet, Offset
  transform: '#B48CFF',   // Move, Rotate, Scale, Mirror, Centre
  annotate:  '#FBDA2D',   // Dim
}
const SW = 2, SWG = 1.25, DASH = '3 2.5'

// 48×62 button face (48×48 picture + label) — the same footprint the old
// pixel-art sprites had, so the toolbars didn't change. `draw` gets the colours:
// c = the main geometry, g = reference geometry (faded).
const SketchIcon = ({ label, color, active, children }) => (
  <svg width="48" height="62" viewBox="0 0 48 62" fill="none" style={{ display: 'block' }}>
    <rect x="0" y="0" width="48" height="48" fill="#0a0020" rx="3"/>
    {active && <rect x="1" y="1" width="46" height="46" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="2" rx="2"/>}
    <g transform="translate(4 4) scale(0.833)" style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
      {/* faded reference geometry; Move/Rotate/Scale/Mirror/Centre's "before"
          shape is stronger (user asked — it was too faint to see) */}
      {children({ c: color, g: color + (color === SK.transform ? 'C0' : '66') })}
    </g>
    <text x="24" y="59" textAnchor="middle" fontFamily="monospace" fontSize="8"
      fill={active ? color : '#999999'}>{label}</text>
  </svg>
)

// An end point (hollow square, the usual CAD point mark).
const Pt = ({ x, y, c }) => <rect x={x - 2} y={y - 2} width="4" height="4" fill="#0a0020" stroke={c} strokeWidth="1.2"/>

// Filled arrowhead with its tip at (x, y), pointing along (dx, dy).
function Arrow({ x, y, dx, dy, c, len = 5, w = 2.6 }) {
  const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L
  const bx = x - ux * len, by = y - uy * len
  return <path d={`M${x} ${y} L${bx - uy * w} ${by + ux * w} L${bx + uy * w} ${by - ux * w} Z`} fill={c}/>
}

// ── Select ───────────────────────────────────────────────────────────────────
export function IconSelect({ active }) {
  return <SketchIcon label="SELECT" color={SK.select} active={active}>{({ c }) => <>
    <rect x="5" y="5" width="26" height="20" stroke={c} strokeWidth={SWG} strokeDasharray={DASH}/>
    <path d="M18 14 L18 40 L24 34 L28 43 L32 41 L28 33 L36 33 Z" stroke={c} strokeWidth={SW}
      strokeLinejoin="round" fill={c} fillOpacity="0.12"/>
  </>}</SketchIcon>
}

// ── Draw ─────────────────────────────────────────────────────────────────────
export function IconLine({ active }) {
  return <SketchIcon label="LINE" color={SK.draw} active={active}>{({ c }) => <>
    <line x1="9" y1="39" x2="39" y2="9" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <Pt x={9} y={39} c={c}/><Pt x={39} y={9} c={c}/>
  </>}</SketchIcon>
}

export function IconCircle({ active }) {
  return <SketchIcon label="CIRCLE" color={SK.draw} active={active}>{({ c }) => <>
    <circle cx="24" cy="24" r="15" stroke={c} strokeWidth={SW}/>
    <line x1="24" y1="24" x2="34.6" y2="13.4" stroke={c} strokeWidth={SWG} strokeDasharray={DASH}/>
    <path d="M20 24 H28 M24 20 V28" stroke={c} strokeWidth="1.5"/>
    <Pt x={34.6} y={13.4} c={c}/>
  </>}</SketchIcon>
}

export function IconSpline({ active }) {
  return <SketchIcon label="SPLINE" color={SK.draw} active={active}>{({ c, g }) => <>
    <path d="M6 36 L16 12 L28 30 L42 10" stroke={g} strokeWidth="1" strokeDasharray="2 2"/>
    <path d="M6 36 C9 24 12 12 16 12 C21 12 23 30 28 30 C33 30 38 18 42 10" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <Pt x={6} y={36} c={c}/><Pt x={16} y={12} c={c}/><Pt x={28} y={30} c={c}/><Pt x={42} y={10} c={c}/>
  </>}</SketchIcon>
}

export function IconText({ active }) {
  return <SketchIcon label="TEXT" color={SK.draw} active={active}>{({ c, g }) => <>
    <path d="M8 40 L19 9 L30 40 M12.5 29 H25.5" stroke={c} strokeWidth={SW + 0.5} strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M37 10 V40 M34 10 H40 M34 40 H40" stroke={c} strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="6" y1="43.5" x2="32" y2="43.5" stroke={g} strokeWidth="1" strokeDasharray="2 2"/>
  </>}</SketchIcon>
}

export function IconAxis({ active }) {
  return <SketchIcon label="REV AXIS" color={SK.draw} active={active}>{({ c, g }) => <>
    <line x1="24" y1="4" x2="24" y2="44" stroke={c} strokeWidth={SW} strokeDasharray="7 2.5 2 2.5"/>
    <ellipse cx="24" cy="26" rx="13" ry="5" stroke={g} strokeWidth="1.2"/>
    <path d="M11 26 A13 5 0 0 0 37 26" stroke={c} strokeWidth="1.6"/>
    <Arrow x={37} y={22.5} dx={0} dy={-1} c={c} len={4.5}/>
  </>}</SketchIcon>
}

export function IconTrace({ active }) {
  return <SketchIcon label="TRACE" color={SK.draw} active={active}>{({ c, g }) => <>
    {/* the photo: frame, sun, solid hills */}
    <rect x="4" y="5" width="36" height="30" rx="2" stroke={g} strokeWidth={SWG}/>
    <circle cx="31" cy="13" r="3" fill={g}/>
    <path d="M4 33 L15 18 L22 27 L28 20 L40 33 Z" fill={g} fillOpacity="0.5"/>
    {/* the traced outline drawn over it, and the pencil drawing it */}
    <path d="M6 31 L15 18 L22 27 L28 20" stroke={c} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round"/>
    <path d="M28 20 L35 28.5" stroke={c} strokeWidth="1.2" strokeDasharray="2 2"/>
    <path d="M37 31 L44 41 L41 43 L34 33 Z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" fill="#0a0020"/>
    <path d="M37 31 L34 33 L35 28.5 Z" fill={c}/>
  </>}</SketchIcon>
}

export function IconIncludeEdge({ active }) {
  return <SketchIcon label="EDGE" color={SK.draw} active={active}>{({ c, g }) => <>
    {/* a block with its front-top edge picked */}
    <path d="M8 16 L28 16 L38 9 L18 9 Z M8 16 V34 H28 V16 M28 34 L38 27 V9" stroke={g} strokeWidth={SWG} strokeLinejoin="round"/>
    <line x1="8" y1="16" x2="28" y2="16" stroke={c} strokeWidth={SW + 0.5} strokeLinecap="round"/>
    <Pt x={8} y={16} c={c}/><Pt x={28} y={16} c={c}/>
    {/* … copied down into the sketch */}
    <line x1="18" y1="20" x2="18" y2="37" stroke={c} strokeWidth="1"/>
    <Arrow x={18} y={40} dx={0} dy={1} c={c}/>
    <line x1="6" y1="43.5" x2="42" y2="43.5" stroke={c} strokeWidth={SW} strokeDasharray={DASH}/>
  </>}</SketchIcon>
}

// ── Edit ─────────────────────────────────────────────────────────────────────
export function IconTrim({ active }) {
  return <SketchIcon label="TRIM" color={SK.edit} active={active}>{({ c, g }) => <>
    <line x1="28" y1="6" x2="28" y2="42" stroke={g} strokeWidth={SW}/>
    <line x1="6" y1="24" x2="28" y2="24" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="28" y1="24" x2="43" y2="24" stroke={c} strokeWidth={SW} strokeDasharray={DASH} opacity="0.7"/>
    <path d="M32 18 L40 30 M40 18 L32 30" stroke={c} strokeWidth="2" strokeLinecap="round"/>
  </>}</SketchIcon>
}

export function IconDelete({ active }) {
  return <SketchIcon label="DELETE" color={SK.edit} active={active}>{({ c }) => <>
    <circle cx="24" cy="24" r="17" stroke={c} strokeWidth={SW} fill={c} fillOpacity="0.1"/>
    <path d="M16 16 L32 32 M32 16 L16 32" stroke={c} strokeWidth="3" strokeLinecap="round"/>
  </>}</SketchIcon>
}

export function IconExtend({ active }) {
  return <SketchIcon label="EXTEND" color={SK.edit} active={active}>{({ c, g }) => <>
    <line x1="40" y1="6" x2="40" y2="42" stroke={g} strokeWidth={SW}/>
    <line x1="6" y1="24" x2="21" y2="24" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="21" y1="24" x2="34" y2="24" stroke={c} strokeWidth={SW} strokeDasharray={DASH}/>
    <Arrow x={39} y={24} dx={1} dy={0} c={c}/>
  </>}</SketchIcon>
}

// Trim Corner: one line stretched (dashed + arrow), the other's overshoot cut
// off (faded, dashed), meeting at the corner point.
export function IconCorner({ active }) {
  return <SketchIcon label="CORNER" color={SK.edit} active={active}>{({ c, g }) => <>
    <line x1="6" y1="14" x2="21" y2="14" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="21" y1="14" x2="29" y2="14" stroke={c} strokeWidth={SW} strokeDasharray={DASH}/>
    <Arrow x={33} y={14} dx={1} dy={0} c={c} len={4.5}/>
    <line x1="34" y1="42" x2="34" y2="14" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="34" y1="14" x2="34" y2="4" stroke={g} strokeWidth={SW} strokeDasharray={DASH}/>
    <path d="M39 5 L45 11 M45 5 L39 11" stroke={c} strokeWidth="1.8" strokeLinecap="round"/>
    <Pt x={34} y={14} c={c}/>
  </>}</SketchIcon>
}

export function IconJoin({ active }) {
  return <SketchIcon label="JOIN" color={SK.edit} active={active}>{({ c }) => <>
    <line x1="5" y1="34" x2="19" y2="34" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="29" y1="14" x2="43" y2="14" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <line x1="19" y1="34" x2="29" y2="14" stroke={c} strokeWidth={SW} strokeDasharray={DASH}/>
    <Pt x={19} y={34} c={c}/><Pt x={29} y={14} c={c}/>
  </>}</SketchIcon>
}

export function IconFillet({ active }) {
  return <SketchIcon label="FILLET" color={SK.edit} active={active}>{({ c, g }) => <>
    <path d="M10 24 L10 10 L24 10" stroke={g} strokeWidth={SWG} strokeDasharray={DASH}/>
    <path d="M10 42 L10 24 M24 10 L40 10" stroke={c} strokeWidth={SW} strokeLinecap="round"/>
    <path d="M10 24 A14 14 0 0 1 24 10" stroke={c} strokeWidth={SW + 0.5} strokeLinecap="round"/>
    <line x1="24" y1="24" x2="15" y2="15" stroke={g} strokeWidth="1"/>
    <Arrow x={14.3} y={14.3} dx={-1} dy={-1} c={g}/>
    <text x="27" y="34" fill={c} fontSize="9" fontFamily="monospace" fontWeight="bold">R</text>
  </>}</SketchIcon>
}

export function IconOffset({ active }) {
  return <SketchIcon label="OFFSET" color={SK.edit} active={active}>{({ c }) => <>
    <rect x="16" y="16" width="16" height="16" stroke={c} strokeWidth={SW}/>
    <rect x="8" y="8" width="32" height="32" rx="8" stroke={c} strokeWidth={SW}/>
    <line x1="34" y1="24" x2="38" y2="24" stroke={c} strokeWidth="1"/>
    <Arrow x={39} y={24} dx={1} dy={0} c={c}/><Arrow x={33} y={24} dx={-1} dy={0} c={c}/>
  </>}</SketchIcon>
}

// ── Move / rotate / scale / mirror ───────────────────────────────────────────
export function IconMove({ active }) {
  return <SketchIcon label="MOVE" color={SK.transform} active={active}>{({ c, g }) => <>
    <rect x="5" y="25" width="16" height="16" stroke={g} strokeWidth="1.7" strokeDasharray={DASH}/>
    <rect x="27" y="7" width="16" height="16" stroke={c} strokeWidth={SW} fill={c} fillOpacity="0.1"/>
    <line x1="15" y1="31" x2="29" y2="19" stroke={c} strokeWidth="1.5"/>
    <Arrow x={31.5} y={17} dx={1} dy={-0.86} c={c}/>
  </>}</SketchIcon>
}

export function IconRotate({ active }) {
  return <SketchIcon label="ROTATE" color={SK.transform} active={active}>{({ c, g }) => <>
    <rect x="10" y="32" width="24" height="7" stroke={g} strokeWidth="1.7" strokeDasharray={DASH}/>
    <rect x="10" y="32" width="24" height="7" stroke={c} strokeWidth={SW} fill={c} fillOpacity="0.1" transform="rotate(-40 10 39)"/>
    <path d="M40 39 A30 30 0 0 0 33 19.7" stroke={c} strokeWidth="1.5"/>
    <Arrow x={32} y={18.5} dx={-0.64} dy={-0.77} c={c}/>
    <Pt x={10} y={39} c={c}/>
  </>}</SketchIcon>
}

export function IconScale({ active }) {
  return <SketchIcon label="SCALE" color={SK.transform} active={active}>{({ c, g }) => <>
    <rect x="7" y="27" width="13" height="13" stroke={g} strokeWidth="1.7" strokeDasharray={DASH}/>
    <rect x="7" y="9" width="31" height="31" stroke={c} strokeWidth={SW} fill={c} fillOpacity="0.08"/>
    <line x1="20" y1="27" x2="32" y2="15" stroke={c} strokeWidth="1.5"/>
    <Arrow x={34} y={13} dx={1} dy={-1} c={c}/>
    <Pt x={7} y={40} c={c}/>
  </>}</SketchIcon>
}

export function IconMirror({ active }) {
  return <SketchIcon label="MIRROR" color={SK.transform} active={active}>{({ c, g }) => <>
    <line x1="24" y1="4" x2="24" y2="44" stroke={g} strokeWidth="1.7" strokeDasharray="6 2 1.5 2"/>
    <path d="M7 36 L20 36 L20 13 Z" stroke={c} strokeWidth={SW} strokeLinejoin="round"/>
    <path d="M41 36 L28 36 L28 13 Z" stroke={c} strokeWidth={SW} strokeLinejoin="round" fill={c} fillOpacity="0.12"/>
  </>}</SketchIcon>
}

export function IconCenter({ active }) {
  return <SketchIcon label="CENTRE" color={SK.transform} active={active}>{({ c, g }) => <>
    <path d="M24 3 V45 M3 24 H45" stroke={g} strokeWidth="1" strokeDasharray="6 2 1.5 2"/>
    <rect x="31" y="3" width="13" height="13" stroke={g} strokeWidth="1.7" strokeDasharray={DASH}/>
    <rect x="15" y="15" width="18" height="18" stroke={c} strokeWidth={SW} fill={c} fillOpacity="0.1"/>
    <line x1="35" y1="13" x2="31" y2="17" stroke={c} strokeWidth="1.5"/>
    <Arrow x={29.5} y={18.5} dx={-1} dy={1} c={c} len={4} w={2.2}/>
    <circle cx="24" cy="24" r="2" fill={c}/>
  </>}</SketchIcon>
}

// ── Dimension / help ─────────────────────────────────────────────────────────
export function IconDim({ active }) {
  return <SketchIcon label="DIM" color={SK.annotate} active={active}>{({ c, g }) => <>
    <line x1="6" y1="40" x2="42" y2="40" stroke={g} strokeWidth={SW}/>
    <path d="M10 37 V15 M38 37 V15" stroke={c} strokeWidth="1.2"/>
    <line x1="10" y1="22" x2="38" y2="22" stroke={c} strokeWidth="1.3"/>
    <Arrow x={10} y={22} dx={-1} dy={0} c={c}/><Arrow x={38} y={22} dx={1} dy={0} c={c}/>
    <text x="24" y="17" textAnchor="middle" fill={c} fontSize="10" fontFamily="monospace" fontWeight="bold">25</text>
  </>}</SketchIcon>
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

export function IconExtrude3D({ color = '#FBDA2D', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconCutout3D({ color = '#53D3E4', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconFillet3D({ color = '#A470F2', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconMirror3D({ color = '#8E65F3', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconLoft3D({ color = '#FBDA2D', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconJoin3D({ color = '#FFEE88', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

export function IconSubtract3D({ color = '#53D3E4', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color} cy="56"/>
      {/* the solid being cut */}
      <path d="M32 24 L50 33 L32 42 L14 33 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.5"/>
      <path d="M14 33 L32 42 L32 60 L14 51 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
      <path d="M32 42 L50 33 L50 51 L32 60 Z" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5"/>
      {/* the hole body, dashed, biting into the top corner */}
      <path d="M46 10 L60 17 L46 24 L32 17 Z" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 2"/>
      <path d="M32 17 L46 24 L46 38 L32 31 Z" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 2"/>
      <path d="M46 24 L60 17 L60 31 L46 38 Z" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 2"/>
      {/* minus sign */}
      <path d="M6 12 L18 12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

export function IconMoveCopy3D({ color = '#FF9800', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      <IsoCube color={color}/>
      {/* 3 bold straight arrows radiating out from the cube's front-top
          vertex — up, left, and down-right — echoing the tool's own
          on-model gizmo (3 draggable translate handles) without literally
          redrawing it. */}
      <line x1="35" y1="38" x2="35" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M31.5 18 L35 12 L38.5 18" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

      <line x1="34" y1="43" x2="10" y2="54" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M17 54 L10 54 L14 48" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>

      <line x1="38" y1="43" x2="60" y2="56" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M57 50 L60 56 L53 56" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconMeasure3D({ color = '#4FC3F7', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
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

// X-ray toggle — a skull over crossed bones. Dim when off, glowing cyan when on.
export function IconXray3D({ color = '#7DF9FF', size = 70, active = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={active ? glow(color) : undefined}>
      {/* crossed bones behind the skull, knobbed at each end */}
      <line x1="12" y1="52" x2="58" y2="66" stroke={color} strokeWidth="3.5" strokeLinecap="round" opacity="0.7"/>
      <line x1="58" y1="52" x2="12" y2="66" stroke={color} strokeWidth="3.5" strokeLinecap="round" opacity="0.7"/>
      {[[12,52],[58,52],[12,66],[58,66]].map(([x,y]) => <circle key={x+'-'+y} cx={x} cy={y} r="3" fill={color} opacity="0.7"/>)}
      {/* cranium + jaw */}
      <path d="M35 5 C20 5 12 15 12 27 C12 34 15 38 20 41 L20 48 L50 48 L50 41 C55 38 58 34 58 27 C58 15 50 5 35 5 Z"
        fill="#0d0d1a" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      {/* eye sockets */}
      <ellipse cx="26" cy="28" rx="6" ry="7" fill={color}/>
      <ellipse cx="44" cy="28" rx="6" ry="7" fill={color}/>
      {/* nose */}
      <path d="M35 34 L31.5 41 L38.5 41 Z" fill={color}/>
      {/* teeth */}
      <line x1="27.5" y1="43" x2="27.5" y2="48" stroke={color} strokeWidth="2"/>
      <line x1="35" y1="43" x2="35" y2="48" stroke={color} strokeWidth="2"/>
      <line x1="42.5" y1="43" x2="42.5" y2="48" stroke={color} strokeWidth="2"/>
    </svg>
  )
}

export function IconSweep3D({ color = '#7ED957', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      {/* swept tube — a thickened translucent band following the path */}
      <path d="M10 52 Q10 28 35 22 Q52 18 52 8" fill="none" stroke={color} strokeWidth="7" strokeOpacity="0.3" strokeLinecap="round"/>
      {/* dashed guide path the profile travels along */}
      <path d="M14 52 Q14 30 35 26 Q56 22 56 8" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 3"/>
      {/* profile — the closed cross-section shape being swept, at the path's start */}
      <ellipse cx="14" cy="52" rx="8" ry="5" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.75"/>
      {/* arrowhead at the path's far end, showing sweep direction */}
      <path d="M50 4 L56 8 L50 12" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconRevolve3D({ color = '#FBDA2D', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      {/* revolve axis — dashed vertical line the profile spins around */}
      <line x1="35" y1="4" x2="35" y2="64" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"/>
      {/* solid of revolution — a lathe-turned vase silhouette, symmetric about the axis */}
      <path d="M23 10 Q17 24 25 34 Q31 40 25 50 Q21 58 27 64 L43 64 Q49 58 45 50 Q39 40 45 34 Q53 24 47 10 Z"
        fill={color} fillOpacity="0.25" stroke={color} strokeWidth="1.75"/>
      {/* top rim ellipse — the circular cross-section the profile sweeps out */}
      <ellipse cx="35" cy="10" rx="12" ry="4" fill="none" stroke={color} strokeWidth="1.5"/>
      {/* curved arrow around the rim, showing the spin direction */}
      <path d="M47 10 A12 4 0 0 1 40 13.7" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"/>
      <path d="M38 15.5 L40 13.7 L42.5 16.3" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Spring — a wire coil seen from the side. The FRONT half of every turn is
// drawn bold and the BACK half thin and faint, with a soft translucent band
// behind the wire (the same "swept tube" cue IconSweep3D uses). That front/
// back contrast is what keeps it reading as a coiled spring instead of a
// chain of linked rings (an earlier version stacked full ellipses and did).
export function IconSpring3D({ color = '#F06292', size = 70 }) {
  const cx = 35, rx = 18, ry = 3.5, y0 = 8, pitch = 13.5, turns = 4
  const L = cx - rx, R = cx + rx
  let front = '', back = ''
  for (let i = 0; i < turns; i++) {
    const y = y0 + pitch * i
    front += `M${L} ${y} A${rx} ${ry} 0 0 0 ${R} ${y + pitch / 2} `
    back  += `M${R} ${y + pitch / 2} A${rx} ${ry} 0 0 0 ${L} ${y + pitch} `
  }
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <path d={front + back} stroke={color} strokeWidth="5.5" strokeOpacity="0.18" strokeLinecap="round"/>
      <path d={back} stroke={color} strokeWidth="1.25" strokeOpacity="0.4" strokeLinecap="round"/>
      <path d={front} stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}

export function IconShell3D({ color = '#4DB6AC', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      {/* Top + left faces solid, same tri-tone convention as IsoCube — only
          the picked face (the right side, here) opens up. Reuses
          Cutout3D's own "hollow frame + dark inset window" treatment
          verbatim, just moved off the top face onto a SIDE face (Shell
          hollows out through a picked face on the body, not down through
          the top) and with no plunge arrow — Shell doesn't drill through,
          it opens one face and empties what's behind it. */}
      <path d="M35 16 L57 28 L35 40 L13 28 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L13 28 L13 52 L35 64 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.75"/>
      <path d="M35 40 L57 28 L57 52 L35 64 Z" fill="none" stroke={color} strokeWidth="1.75"/>
      <path d="M40 43 L52 37 L52 49 L40 55 Z" fill="#000" fillOpacity="0.55" stroke={color} strokeWidth="1.25"/>
      <line x1="35" y1="40" x2="40" y2="43" stroke={color} strokeWidth="1"/>
      <line x1="57" y1="28" x2="52" y2="37" stroke={color} strokeWidth="1"/>
      <line x1="57" y1="52" x2="52" y2="49" stroke={color} strokeWidth="1"/>
      <line x1="35" y1="64" x2="40" y2="55" stroke={color} strokeWidth="1"/>
    </svg>
  )
}

export function IconSoften3D({ color = '#A470F2', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color}/>
      {/* A slab with every edge rounded off: a pillowy top, soft sides, and a
          flat base line (the face that stays sharp). */}
      <path d="M35 14 Q57 20 57 30 Q57 36 35 44 Q13 36 13 30 Q13 20 35 14 Z" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M13 30 Q13 36 35 44 Q57 36 57 30 L57 48 Q57 54 35 62 Q13 54 13 48 Z" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.75" strokeLinejoin="round"/>
      <path d="M35 44 L35 62" stroke={color} strokeWidth="1" strokeDasharray="2 2"/>
    </svg>
  )
}

export function IconPattern3D({ color = '#4DB6AC', size = 70 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" fill="none" style={glow(color)}>
      <GroundShadow color={color} cy={62}/>
      {/* Circular-pattern-specific glyph (replacing the earlier generic
          repeated-cube array icon once Pattern narrowed to Circular only):
          an isometric drum/cylinder — same top-ellipse-plus-vertical-sides
          language as Revolve/Spring's own icons — with 4 X marks ringing
          the rim where copies land, echoing the actual crosshair this tool
          shows live when picking the pivot+axis on a circular edge. */}
      <ellipse cx="35" cy="20" rx="20" ry="9" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.75"/>
      <line x1="15" y1="20" x2="15" y2="46" stroke={color} strokeWidth="1.75"/>
      <line x1="55" y1="20" x2="55" y2="46" stroke={color} strokeWidth="1.75"/>
      <path d="M15 46 A20 9 0 0 0 55 46" fill="none" stroke={color} strokeWidth="1.75"/>
      <g stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <path d="M50 25 L58 33 M58 25 L50 33"/>
        <path d="M12 25 L20 33 M20 25 L12 33"/>
        <path d="M12 7 L20 15 M20 7 L12 15"/>
        <path d="M50 7 L58 15 M58 7 L50 15"/>
      </g>
    </svg>
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

export function IconReframe() {
  return (
    <V>
      {/* Reset arc — same three-quarter-circle-plus-arrowhead language as
          Undo/Redo, reused here for "snap the camera back", wrapping around
          a plane viewed edge-on (flat, no tilt) to read as "back to flat"
          rather than a generic undo. */}
      <path d="M22.5 8.3A9.3 9.3 0 1 0 24.4 15" stroke="#4fc3f7" strokeWidth="2.3" fill="none" strokeLinecap="round"/>
      <polygon points="25.3,3.6 25.5,10.2 19.6,7.5" fill="#4fc3f7"/>
      <ellipse cx="13" cy="20" rx="9" ry="3" fill="#0d2635" stroke="#7dd8ff" strokeWidth="1.5"/>
      <line x1="5.5" y1="20" x2="20.5" y2="20" stroke="#7dd8ff" strokeWidth="1" opacity="0.5"/>
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

export function IconNew() {
  return (
    <V>
      <rect x="4" y="3" width="20" height="22" rx="2" fill="#374151" stroke="#f59e0b" strokeWidth="1.5"/>
      <path d="M14 8v10M9 13h10" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"/>
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

export function IconCloudSave() {
  return (
    <V>
      <path d="M9 20a4.5 4.5 0 01-.5-8.98A5.5 5.5 0 0119 9.5a4 4 0 011 7.9V20H9z" fill="#374151" stroke="#4ade80" strokeWidth="1.5"/>
      <path d="M14 21v-7M11 17l3-3 3 3" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </V>
  )
}

export function IconCloudLoad() {
  return (
    <V>
      <path d="M9 20a4.5 4.5 0 01-.5-8.98A5.5 5.5 0 0119 9.5a4 4 0 011 7.9V20H9z" fill="#374151" stroke="#3b82f6" strokeWidth="1.5"/>
      <path d="M14 14v7M11 18l3 3 3-3" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
