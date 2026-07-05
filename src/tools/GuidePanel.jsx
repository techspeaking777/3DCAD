// GuidePanel.jsx — Step-by-step guided mode panel
import React from 'react'

// ── SVG Diagrams ──────────────────────────────────────────────────────────────
// Small inline SVG sketches shown alongside each step

const Diagrams = {
  line: [
    // Step 1 — click a start point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="50" cy="30" r="5" fill="#64B5F6"/>
      <text x="50" y="52" textAnchor="middle" fill="#64B5F6" fontSize="9" fontFamily="monospace">click here</text>
    </svg>,
    // Step 2 — preview line follows mouse
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="40" cy="30" r="5" fill="#64B5F6"/>
      <line x1="40" y1="30" x2="130" y2="20" stroke="#64B5F6" strokeWidth="1.5" strokeDasharray="5 3"/>
      <circle cx="130" cy="20" r="4" fill="none" stroke="#64B5F6" strokeWidth="1.5"/>
      <text x="140" y="24" fill="#64B5F6" fontSize="9" fontFamily="monospace">cursor</text>
    </svg>,
    // Step 3 — click end point, line drawn
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="40" cy="30" r="5" fill="#64B5F6"/>
      <line x1="40" y1="30" x2="140" y2="20" stroke="#64B5F6" strokeWidth="2"/>
      <circle cx="140" cy="20" r="5" fill="#64B5F6"/>
      <text x="90" y="50" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ line drawn</text>
    </svg>,
    // Continue — chain lines
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="20" cy="40" r="4" fill="#64B5F6"/>
      <line x1="20" y1="40" x2="70" y2="20" stroke="#64B5F6" strokeWidth="2"/>
      <circle cx="70" cy="20" r="4" fill="#64B5F6"/>
      <line x1="70" y1="20" x2="130" y2="35" stroke="#64B5F6" strokeWidth="2"/>
      <circle cx="130" cy="35" r="4" fill="#64B5F6"/>
      <line x1="130" y1="35" x2="165" y2="15" stroke="#64B5F6" strokeWidth="1.5" strokeDasharray="4 3"/>
      <circle cx="165" cy="15" r="3" fill="none" stroke="#64B5F6" strokeWidth="1.5"/>
    </svg>,
  ],
  circle: [
    // Step 1 — click centre
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="90" cy="30" r="5" fill="#2196F3"/>
      <line x1="82" y1="30" x2="98" y2="30" stroke="#2196F3" strokeWidth="1.5"/>
      <line x1="90" y1="22" x2="90" y2="38" stroke="#2196F3" strokeWidth="1.5"/>
      <text x="90" y="52" textAnchor="middle" fill="#2196F3" fontSize="9" fontFamily="monospace">click centre</text>
    </svg>,
    // Step 2 — drag outward
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="90" cy="32" r="24" fill="none" stroke="#2196F3" strokeWidth="1.5" strokeDasharray="4 3"/>
      <circle cx="90" cy="32" r="4" fill="#2196F3"/>
      <line x1="90" y1="32" x2="114" y2="32" stroke="#2196F3" strokeWidth="1.5"/>
      <text x="102" y="28" fill="#64B5F6" fontSize="9" fontFamily="monospace">R</text>
      <circle cx="114" cy="32" r="3" fill="none" stroke="#2196F3" strokeWidth="1.5"/>
    </svg>,
    // Step 3 — click to set radius
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="90" cy="30" r="22" fill="none" stroke="#2196F3" strokeWidth="2"/>
      <circle cx="90" cy="30" r="4" fill="#2196F3"/>
      <text x="90" y="54" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ circle drawn</text>
    </svg>,
  ],
  trim: [
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="10" y1="30" x2="170" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="5" x2="90" y2="55" stroke="#aaa" strokeWidth="2"/>
      <text x="90" y="52" textAnchor="middle" fill="#FF5722" fontSize="9" fontFamily="monospace">hover segment</text>
    </svg>,
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="10" y1="30" x2="170" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="5" x2="90" y2="55" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="30" x2="170" y2="30" stroke="#FF5722" strokeWidth="3"/>
      <text x="130" y="22" fill="#FF5722" fontSize="9" fontFamily="monospace">red = trim</text>
    </svg>,
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="10" y1="30" x2="90" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="5" x2="90" y2="55" stroke="#aaa" strokeWidth="2"/>
      <text x="90" y="52" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ trimmed</text>
    </svg>,
  ],
  offset: [
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="35" x2="160" y2="35" stroke="#aaa" strokeWidth="2"/>
      <text x="90" y="52" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">click this line</text>
    </svg>,
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="40" x2="160" y2="40" stroke="#aaa" strokeWidth="2"/>
      <line x1="20" y1="22" x2="160" y2="22" stroke="#4CAF50" strokeWidth="1.5" strokeDasharray="4 3"/>
      <line x1="90" y1="22" x2="90" y2="40" stroke="#4CAF50" strokeWidth="1" strokeDasharray="3 2"/>
      <text x="100" y="33" fill="#4CAF50" fontSize="9" fontFamily="monospace">offset</text>
    </svg>,
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="40" x2="160" y2="40" stroke="#aaa" strokeWidth="2"/>
      <line x1="20" y1="22" x2="160" y2="22" stroke="#4CAF50" strokeWidth="2"/>
      <text x="90" y="54" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ offset drawn</text>
    </svg>,
  ],
  fillet: [
    // Step 1 — click first line
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="50" x2="90" y2="50" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="50" x2="90" y2="10" stroke="#26A69A" strokeWidth="2.5"/>
      <text x="55" y="44" fill="#26A69A" fontSize="9" fontFamily="monospace">click line 1</text>
    </svg>,
    // Step 2 — click second line then Tab/right-click
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="50" x2="90" y2="50" stroke="#26A69A" strokeWidth="2.5"/>
      <line x1="90" y1="50" x2="90" y2="10" stroke="#26A69A" strokeWidth="2.5"/>
      <rect x="108" y="18" width="62" height="16" rx="3" fill="#26A69A33" stroke="#26A69A" strokeWidth="1"/>
      <text x="139" y="29" textAnchor="middle" fill="#26A69A" fontSize="8" fontFamily="monospace">Tab / R-click</text>
    </svg>,
    // Step 3 — type radius
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="50" x2="90" y2="50" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="50" x2="90" y2="10" stroke="#aaa" strokeWidth="2"/>
      <rect x="100" y="20" width="60" height="16" rx="3" fill="#0d0d1a" stroke="#26A69A" strokeWidth="1.5"/>
      <text x="130" y="31" textAnchor="middle" fill="#26A69A" fontSize="9" fontFamily="monospace">10 mm</text>
      <text x="90" y="10" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">type radius + Enter</text>
    </svg>,
    // Step 4 — result
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="50" x2="65" y2="50" stroke="#aaa" strokeWidth="2"/>
      <line x1="90" y1="25" x2="90" y2="10" stroke="#aaa" strokeWidth="2"/>
      <path d="M65,50 Q90,50 90,25" fill="none" stroke="#26A69A" strokeWidth="2"/>
      <text x="90" y="58" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ filleted</text>
    </svg>,
  ],
  spline: [
    // Step 1 — click first point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="30" cy="45" r="5" fill="#FF6F00"/>
      <text x="30" y="18" textAnchor="middle" fill="#FF6F00" fontSize="9" fontFamily="monospace">click 1st point</text>
    </svg>,
    // Step 2 — keep clicking points
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="30" cy="45" r="4" fill="#FF6F00"/>
      <circle cx="70" cy="20" r="4" fill="#FF6F00"/>
      <circle cx="120" cy="35" r="4" fill="#FF6F00"/>
      <path d="M30,45 C45,20 55,20 70,20 C95,20 100,35 120,35" fill="none" stroke="#FF6F00" strokeWidth="2" strokeDasharray="4 2"/>
      <text x="90" y="55" textAnchor="middle" fill="#FF6F00" fontSize="9" fontFamily="monospace">keep clicking...</text>
    </svg>,
    // Step 3 — double click to finish
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="30" cy="45" r="4" fill="#FF6F00"/>
      <circle cx="70" cy="20" r="4" fill="#FF6F00"/>
      <circle cx="120" cy="35" r="4" fill="#FF6F00"/>
      <circle cx="155" cy="15" r="4" fill="#FF6F00"/>
      <path d="M30,45 C45,20 55,20 70,20 C95,20 100,35 120,35 C140,35 145,15 155,15" fill="none" stroke="#FF6F00" strokeWidth="2"/>
      <text x="90" y="55" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">double-click to finish</text>
    </svg>,
  ],
  extend: [
    // Step 1 — hover near end of line
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="100" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="120" y1="10" x2="120" y2="55" stroke="#aaa" strokeWidth="2"/>
      <circle cx="100" cy="30" r="5" fill="none" stroke="#00ACC1" strokeWidth="2"/>
      <text x="90" y="52" textAnchor="middle" fill="#00ACC1" fontSize="9" fontFamily="monospace">hover near end</text>
    </svg>,
    // Step 2 — dashed preview appears
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="100" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="120" y1="10" x2="120" y2="55" stroke="#aaa" strokeWidth="2"/>
      <line x1="100" y1="30" x2="120" y2="30" stroke="#00ACC1" strokeWidth="2" strokeDasharray="4 3"/>
      <text x="90" y="52" textAnchor="middle" fill="#00ACC1" fontSize="9" fontFamily="monospace">preview appears</text>
    </svg>,
    // Step 3 — click to extend
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="120" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="120" y1="10" x2="120" y2="55" stroke="#aaa" strokeWidth="2"/>
      <circle cx="120" cy="30" r="4" fill="#00ACC1"/>
      <text x="90" y="52" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ extended</text>
    </svg>,
  ],
  join: [
    // Step 1 — gap between lines
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="80" y2="30" stroke="#aaa" strokeWidth="2"/>
      <line x1="95" y1="30" x2="160" y2="30" stroke="#aaa" strokeWidth="2"/>
      <circle cx="80" cy="30" r="5" fill="none" stroke="#76FF03" strokeWidth="2"/>
      <text x="88" y="18" textAnchor="middle" fill="#76FF03" fontSize="9" fontFamily="monospace">click endpoint</text>
    </svg>,
    // Step 2 — click target
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="80" y2="30" stroke="#76FF03" strokeWidth="2"/>
      <line x1="95" y1="30" x2="160" y2="30" stroke="#aaa" strokeWidth="2"/>
      <circle cx="95" cy="30" r="5" fill="none" stroke="#76FF03" strokeWidth="2"/>
      <line x1="80" y1="30" x2="95" y2="30" stroke="#76FF03" strokeWidth="1.5" strokeDasharray="3 2"/>
      <text x="88" y="50" textAnchor="middle" fill="#76FF03" fontSize="9" fontFamily="monospace">click target</text>
    </svg>,
    // Result — joined
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="20" y1="30" x2="160" y2="30" stroke="#aaa" strokeWidth="2"/>
      <circle cx="90" cy="30" r="4" fill="#76FF03"/>
      <text x="90" y="50" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ joined</text>
    </svg>,
  ],
  delete: [
    // Step 1 — hover over shape
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="90" cy="30" r="22" fill="none" stroke="#aaa" strokeWidth="2"/>
      <circle cx="90" cy="30" r="22" fill="none" stroke="#F44336" strokeWidth="2" strokeDasharray="4 2" opacity="0.6"/>
      <text x="90" y="56" textAnchor="middle" fill="#F44336" fontSize="9" fontFamily="monospace">hover = red highlight</text>
    </svg>,
    // Step 2 — click to delete
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="65" y1="10" x2="115" y2="50" stroke="#F44336" strokeWidth="2"/>
      <line x1="115" y1="10" x2="65" y2="50" stroke="#F44336" strokeWidth="2"/>
      <text x="90" y="58" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">click = deleted</text>
    </svg>,
  ],
  movecopy: [
    // Step 1 — select shapes
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="30" y="15" width="50" height="35" fill="none" stroke="#aaa" strokeWidth="2"/>
      <rect x="28" y="13" width="54" height="39" fill="none" stroke="#FF9800" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x="55" y="56" textAnchor="middle" fill="#FF9800" fontSize="9" fontFamily="monospace">drag to select</text>
    </svg>,
    // Step 2 — Tab to confirm
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="30" y="15" width="50" height="35" fill="#FF980022" stroke="#FF9800" strokeWidth="2"/>
      <rect x="100" y="22" width="60" height="16" rx="3" fill="#FF980033" stroke="#FF9800" strokeWidth="1"/>
      <text x="130" y="33" textAnchor="middle" fill="#FF9800" fontSize="8" fontFamily="monospace">Tab / R-click</text>
    </svg>,
    // Step 3 — press C for copies
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="20" y="15" width="50" height="35" fill="#FF980022" stroke="#FF9800" strokeWidth="2"/>
      <rect x="95" y="20" width="22" height="22" rx="4" fill="#FF980033" stroke="#FF9800" strokeWidth="1.5"/>
      <text x="106" y="35" textAnchor="middle" fill="#FF9800" fontSize="12" fontFamily="monospace" fontWeight="bold">C</text>
      <text x="130" y="28" fill="#FF9800" fontSize="8" fontFamily="monospace">press C</text>
      <text x="130" y="40" fill="#FF9800" fontSize="8" fontFamily="monospace">type copies</text>
    </svg>,
    // Step 4 — click base point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="30" y="15" width="50" height="35" fill="none" stroke="#FF9800" strokeWidth="2"/>
      <circle cx="30" cy="50" r="5" fill="#FF9800"/>
      <text x="75" y="56" textAnchor="middle" fill="#FF9800" fontSize="9" fontFamily="monospace">click base pt</text>
    </svg>,
    // Step 5 — click destination
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="20" y="15" width="40" height="30" fill="none" stroke="#555" strokeWidth="1.5" strokeDasharray="3 2"/>
      <rect x="80" y="15" width="40" height="30" fill="none" stroke="#FF9800" strokeWidth="2"/>
      <line x1="20" y1="45" x2="80" y2="45" stroke="#FF9800" strokeWidth="1.5" strokeDasharray="4 2"/>
      <circle cx="80" cy="45" r="4" fill="#FF9800"/>
      <text x="90" y="58" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ placed</text>
    </svg>,
  ],
  rotatecopy: [
    // Step 1 — select shapes
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="60" y="15" width="50" height="30" fill="none" stroke="#aaa" strokeWidth="2"/>
      <rect x="58" y="13" width="54" height="34" fill="none" stroke="#00BCD4" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x="85" y="56" textAnchor="middle" fill="#00BCD4" fontSize="9" fontFamily="monospace">drag to select</text>
    </svg>,
    // Step 2 — Tab to confirm
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="60" y="15" width="50" height="30" fill="#00BCD422" stroke="#00BCD4" strokeWidth="2"/>
      <rect x="95" y="25" width="60" height="16" rx="3" fill="#00BCD433" stroke="#00BCD4" strokeWidth="1"/>
      <text x="125" y="36" textAnchor="middle" fill="#00BCD4" fontSize="8" fontFamily="monospace">Tab / R-click</text>
    </svg>,
    // Step 3 — press C for copies
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="20" y="15" width="50" height="30" fill="#00BCD422" stroke="#00BCD4" strokeWidth="2"/>
      <rect x="95" y="20" width="22" height="22" rx="4" fill="#00BCD433" stroke="#00BCD4" strokeWidth="1.5"/>
      <text x="106" y="35" textAnchor="middle" fill="#00BCD4" fontSize="12" fontFamily="monospace" fontWeight="bold">C</text>
      <text x="130" y="28" fill="#00BCD4" fontSize="8" fontFamily="monospace">press C</text>
      <text x="130" y="40" fill="#00BCD4" fontSize="8" fontFamily="monospace">type copies</text>
    </svg>,
    // Step 4 — click centre point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="60" y="15" width="50" height="30" fill="none" stroke="#00BCD4" strokeWidth="2"/>
      <circle cx="85" cy="30" r="5" fill="#00BCD4"/>
      <line x1="78" y1="30" x2="92" y2="30" stroke="#0d0d1a" strokeWidth="1.5"/>
      <line x1="85" y1="23" x2="85" y2="37" stroke="#0d0d1a" strokeWidth="1.5"/>
      <text x="85" y="54" textAnchor="middle" fill="#00BCD4" fontSize="9" fontFamily="monospace">click centre</text>
    </svg>,
    // Step 5 — type angle
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="20" y="20" width="40" height="25" fill="none" stroke="#555" strokeWidth="1" strokeDasharray="3 2"/>
      <rect x="75" y="15" width="40" height="25" fill="none" stroke="#00BCD4" strokeWidth="2" transform="rotate(45 95 27)"/>
      <circle cx="60" cy="35" r="3" fill="#00BCD4"/>
      <path d="M 75 35 A 15 15 0 0 1 68 22" fill="none" stroke="#00BCD4" strokeWidth="1.5"/>
      <text x="130" y="28" fill="#00BCD4" fontSize="9" fontFamily="monospace">90°</text>
      <text x="90" y="56" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">✓ rotated</text>
    </svg>,
  ],
  resize: [
    // Step 1 — select shapes
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="65" y="20" width="40" height="28" fill="none" stroke="#aaa" strokeWidth="2"/>
      <rect x="63" y="18" width="44" height="32" fill="none" stroke="#E91E63" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x="85" y="56" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">drag to select</text>
    </svg>,
    // Step 2 — Tab to confirm
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="65" y="20" width="40" height="28" fill="#E91E6322" stroke="#E91E63" strokeWidth="2"/>
      <rect x="95" y="25" width="60" height="16" rx="3" fill="#E91E6333" stroke="#E91E63" strokeWidth="1"/>
      <text x="125" y="36" textAnchor="middle" fill="#E91E63" fontSize="8" fontFamily="monospace">Tab / R-click</text>
    </svg>,
    // Step 3 — click base point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="65" y="20" width="40" height="28" fill="none" stroke="#E91E63" strokeWidth="2"/>
      <circle cx="65" cy="48" r="5" fill="#E91E63"/>
      <text x="85" y="12" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">click base point</text>
    </svg>,
    // Step 4 — type scale factor, result
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <rect x="55" y="25" width="25" height="18" fill="none" stroke="#555" strokeWidth="1" strokeDasharray="3 2"/>
      <rect x="55" y="10" width="70" height="42" fill="none" stroke="#E91E63" strokeWidth="2"/>
      <circle cx="55" cy="52" r="4" fill="#E91E63"/>
      <text x="115" y="30" fill="#E91E63" fontSize="9" fontFamily="monospace">×2</text>
      <text x="90" y="58" textAnchor="middle" fill="#4CAF50" fontSize="8" fontFamily="monospace">✓ scaled up</text>
    </svg>,
  ],
  mirror: [
    // Step 1 — select shapes
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <path d="M 30 45 L 55 15 L 70 45 Z" fill="none" stroke="#aaa" strokeWidth="2"/>
      <path d="M 28 47 L 53 13 L 72 47 Z" fill="none" stroke="#9C27B0" strokeWidth="1.5" strokeDasharray="4 2"/>
      <text x="50" y="56" textAnchor="middle" fill="#9C27B0" fontSize="9" fontFamily="monospace">drag to select</text>
    </svg>,
    // Step 2 — Tab to confirm
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <path d="M 30 45 L 55 15 L 70 45 Z" fill="#9C27B022" stroke="#9C27B0" strokeWidth="2"/>
      <rect x="80" y="22" width="60" height="16" rx="3" fill="#9C27B033" stroke="#9C27B0" strokeWidth="1"/>
      <text x="110" y="33" textAnchor="middle" fill="#9C27B0" fontSize="8" fontFamily="monospace">Tab / R-click</text>
    </svg>,
    // Step 3 — click mirror line pt 1
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <path d="M 20 45 L 45 15 L 60 45 Z" fill="none" stroke="#9C27B0" strokeWidth="2"/>
      <line x1="90" y1="5" x2="90" y2="55" stroke="#9C27B0" strokeWidth="1.5" strokeDasharray="4 3"/>
      <circle cx="90" cy="5" r="4" fill="#9C27B0"/>
      <text x="90" y="58" textAnchor="middle" fill="#9C27B0" fontSize="9" fontFamily="monospace">click pt 1</text>
    </svg>,
    // Step 4 — result mirrored
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <path d="M 20 45 L 45 15 L 60 45 Z" fill="none" stroke="#9C27B0" strokeWidth="2"/>
      <line x1="90" y1="5" x2="90" y2="55" stroke="#9C27B0" strokeWidth="1.5" strokeDasharray="4 3"/>
      <path d="M 160 45 L 135 15 L 120 45 Z" fill="none" stroke="#9C27B0" strokeWidth="2"/>
      <text x="90" y="58" textAnchor="middle" fill="#4CAF50" fontSize="8" fontFamily="monospace">✓ mirrored</text>
    </svg>,
  ],
  select: [
    // Step 1 — click or drag-window to select
    <svg width="100%" height="68" viewBox="0 0 180 68">
      <rect width="180" height="68" fill="#0d0d1a" rx="4"/>
      {/* single click */}
      <line x1="15" y1="28" x2="75" y2="28" stroke="#64B5F6" strokeWidth="2.5"/>
      <circle cx="15" cy="28" r="4" fill="#64B5F6"/>
      <circle cx="75" cy="28" r="4" fill="#64B5F6"/>
      {/* drag box */}
      <line x1="95" y1="22" x2="160" y2="22" stroke="#aaa" strokeWidth="1.5"/>
      <circle cx="127" cy="40" r="10" fill="none" stroke="#aaa" strokeWidth="1.5"/>
      <rect x="88" y="14" width="78" height="40" fill="none" stroke="#64B5F655" strokeWidth="1.2" strokeDasharray="4 2"/>
      {/* shift badge */}
      <rect x="2" y="46" width="38" height="14" rx="3" fill="#64B5F622" stroke="#64B5F6" strokeWidth="0.8"/>
      <text x="21" y="56" textAnchor="middle" fill="#64B5F6" fontSize="7.5" fontFamily="monospace">⇧ Shift</text>
      <text x="115" y="64" textAnchor="middle" fill="#64B5F6" fontSize="8" fontFamily="monospace">click · shift · drag box</text>
    </svg>,
    // Step 2 — drag handle OR press Tab
    <svg width="100%" height="68" viewBox="0 0 180 68">
      <rect width="180" height="68" fill="#0d0d1a" rx="4"/>
      {/* selected shape */}
      <rect x="30" y="16" width="80" height="36" fill="none" stroke="#64B5F6" strokeWidth="1.5" strokeDasharray="4 2"/>
      {/* corner handle being dragged */}
      <rect x="104" y="9" width="10" height="10" rx="2" fill="#64B5F6"/>
      <line x1="109" y1="14" x2="122" y2="4" stroke="#64B5F6" strokeWidth="1.2" strokeDasharray="3 2"/>
      <circle cx="124" cy="3" r="3" fill="#FFD600"/>
      {/* OR divider */}
      <text x="90" y="62" textAnchor="middle" fill="#888" fontSize="8" fontFamily="monospace">drag handle  ·  or press Tab</text>
      {/* Tab key */}
      <rect x="134" y="18" width="36" height="18" rx="4" fill="#FF980022" stroke="#FF9800" strokeWidth="1"/>
      <text x="152" y="31" textAnchor="middle" fill="#FF9800" fontSize="9" fontFamily="monospace">Tab</text>
    </svg>,
    // Step 3 — type value, pick anchor dot, Enter
    <svg width="100%" height="68" viewBox="0 0 180 68">
      <rect width="180" height="68" fill="#0d0d1a" rx="4"/>
      {/* dim label being edited */}
      <rect x="44" y="6" width="60" height="16" rx="3" fill="#FF980033" stroke="#FF9800" strokeWidth="1"/>
      <text x="74" y="18" textAnchor="middle" fill="#FF9800" fontSize="9" fontFamily="monospace">✏ 51.33 mm</text>
      {/* anchor grid 3x3 */}
      <rect x="10" y="26" width="34" height="34" rx="3" fill="#00000055"/>
      {['tl','tc','tr','ml','mc','mr','bl','bc','br'].map((id,i)=>{
        const ci=i%3, ri=Math.floor(i/3)
        const px=21+ci*11, py=37+ri*11
        const isAnchor=id==='ml'
        return <circle key={id} cx={px} cy={py} r={isAnchor?4.5:2.5} fill={isAnchor?'#FFD600':'#90CAF9'}/>
      })}
      <text x="27" y="66" textAnchor="middle" fill="#FFD600" fontSize="7.5" fontFamily="monospace">pick anchor</text>
      {/* Enter key */}
      <rect x="120" y="26" width="48" height="20" rx="4" fill="#4CAF5022" stroke="#4CAF50" strokeWidth="1"/>
      <text x="144" y="40" textAnchor="middle" fill="#4CAF50" fontSize="9" fontFamily="monospace">Enter ↵</text>
      <text x="144" y="62" textAnchor="middle" fill="#4CAF50" fontSize="7.5" fontFamily="monospace">apply changes</text>
    </svg>,
  ],
  dim: [
    // Auto — hover circle
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="90" cy="28" r="20" fill="none" stroke="#aaa" strokeWidth="2"/>
      <circle cx="90" cy="28" r="20" fill="none" stroke="#E91E63" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.7"/>
      <text x="90" y="56" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">hover = auto radius dim</text>
    </svg>,
    // Manual step 1 — click first point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="40" cy="35" r="5" fill="#E91E63"/>
      <text x="40" y="18" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">click pt 1</text>
    </svg>,
    // Manual step 2 — click second point
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <circle cx="40" cy="35" r="4" fill="#E91E63"/>
      <circle cx="140" cy="35" r="5" fill="#E91E63"/>
      <line x1="40" y1="35" x2="140" y2="35" stroke="#E91E63" strokeWidth="1" strokeDasharray="4 2"/>
      <text x="140" y="18" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">click pt 2</text>
    </svg>,
    // Manual step 3 — click to position dim line
    <svg width="100%" height="60" viewBox="0 0 180 60">
      <rect width="180" height="60" fill="#0d0d1a" rx="4"/>
      <line x1="40" y1="40" x2="140" y2="40" stroke="#aaa" strokeWidth="1.5"/>
      <line x1="40" y1="20" x2="140" y2="20" stroke="#E91E63" strokeWidth="1.5"/>
      <line x1="40" y1="20" x2="40" y2="40" stroke="#E91E63" strokeWidth="1"/>
      <line x1="140" y1="20" x2="140" y2="40" stroke="#E91E63" strokeWidth="1"/>
      <polygon points="45,20 40,14 35,20" fill="#E91E63"/>
      <polygon points="135,20 140,14 145,20" fill="#E91E63"/>
      <text x="90" y="17" textAnchor="middle" fill="#E91E63" fontSize="8" fontFamily="monospace">100mm</text>
      <text x="90" y="54" textAnchor="middle" fill="#E91E63" fontSize="9" fontFamily="monospace">click to place dim line</text>
    </svg>,
  ],
}

// ── Guide content ─────────────────────────────────────────────────────────────
const GUIDES = {
  select: {
    title: 'SELECT',
    icon: '🔍',
    color: '#64B5F6',
    steps: [
      { label: 'Step 1 — Select', text: 'Click a shape to select it. Hold Shift and click to add more. Or click and drag on empty space to select everything inside the box.' },
      { label: 'Step 2 — Reshape', text: 'Drag any handle on the bounding box to resize manually. Press Tab to switch to precise number entry instead.' },
      { label: 'Step 3 — Precise edit', text: 'Tab toggles between the length and angle fields. Type your value. Click a dot in the anchor grid to choose which point stays fixed. Press Enter to apply.' },
    ],
    tips: ['Click empty space to deselect all.', 'Press Delete to remove selected shapes.', 'Shift+click to add or remove individual shapes from the selection.'],
  },
  line: {
    title: 'LINE',
    icon: '📏',
    color: '#64B5F6',
    steps: [
      { label: 'Step 1 — Start', text: 'Click anywhere on the canvas to place your first point.' },
      { label: 'Step 2 — End point', text: 'Move your mouse — a preview follows. Click to place the end point, or type a length and press Enter to lock it in. Press Tab to switch to the angle field and type an angle, then Enter to draw.' },
      { label: 'Step 3 — Continue or stop', text: 'Keep clicking to chain more lines from the last point. Press Escape or right-click to finish.' },
    ],
    tips: [
      'Type a length and press Enter, or Tab to angle then Enter.',
      'Coloured dots are snap points — hover near them to lock on.',
      'Press T to toggle tangent snap — draws a line tangent to a circle or arc.',
      'Press P to toggle perpendicular snap — draws a line perpendicular to another line.',
    ],
  },
  circle: {
    title: 'CIRCLE',
    icon: '⭕',
    color: '#2196F3',
    steps: [
      { label: 'Step 1 — Centre', text: 'Click to place the centre of the circle.' },
      { label: 'Step 2 — Radius', text: 'Move your mouse out — a preview circle follows. Click to set the radius, or type a radius value and press Enter to draw an exact circle.' },
    ],
    tips: [
      'Type a radius and press Enter for an exact size.',
      'The live radius shows in the bottom bar.',
      'Press T after placing the centre to snap the radius tangent to a nearby line, circle or arc.',
    ],
  },
  spline: {
    title: 'SPLINE',
    icon: '〜',
    color: '#FF6F00',
    steps: [
      { label: 'Step 1', text: 'Click to place your first control point.' },
      { label: 'Step 2', text: 'Keep clicking to add more points — the curve updates live.' },
      { label: 'Step 3', text: 'Double-click or press Enter to finish.' },
    ],
    tips: [
      'Press C to toggle a closed loop.',
      'Press Escape to cancel without drawing.',
    ],
  },
  text: {
    title: 'TEXT',
    icon: '🔤',
    color: '#FF9800',
    steps: [
      { label: 'Step 1', text: 'Click on the canvas where you want the text.' },
      { label: 'Step 2', text: 'A panel opens — type your text and choose a size.' },
      { label: 'Step 3', text: 'Click OK to place the text on the drawing.' },
    ],
    tips: ['Text is placed as a vector shape — it scales with your drawing.'],
  },
  trim: {
    title: 'TRIM',
    icon: '✂',
    color: '#FF5722',
    steps: [
      { label: 'Step 1', text: 'Hover over a line or arc you want to shorten.' },
      { label: 'Step 2', text: 'The part to be removed highlights in red.' },
      { label: 'Step 3', text: 'Click to trim that segment off.' },
    ],
    tips: [
      'Trim only works where lines cross or meet.',
      'Press Escape to exit.',
    ],
  },
  delete: {
    title: 'DELETE',
    icon: '🗑',
    color: '#F44336',
    steps: [
      { label: 'Step 1', text: 'Hover over any shape — it highlights red.' },
      { label: 'Step 2', text: 'Click to delete it.' },
    ],
    tips: [
      'Ctrl+Z to undo.',
      'To delete many at once — use Select tool then press Delete.',
    ],
  },
  extend: {
    title: 'EXTEND',
    icon: '↔',
    color: '#00ACC1',
    steps: [
      { label: 'Step 1', text: 'Hover near the end of a line you want to make longer.' },
      { label: 'Step 2', text: 'A dashed preview shows where it will extend to.' },
      { label: 'Step 3', text: 'Click to extend the line to the nearest boundary.' },
    ],
    tips: ['Lines extend to meet the nearest other line or circle.'],
  },
  offset: {
    title: 'OFFSET',
    icon: '⟹',
    color: '#4CAF50',
    steps: [
      { label: 'Step 1', text: 'Click on the line or shape you want to copy parallel.' },
      { label: 'Step 2', text: 'Type the distance in mm and press Enter.' },
      { label: 'Step 3', text: 'Click on the side where the offset should appear.' },
    ],
    tips: ['Creates a new line parallel to the original at a set distance.'],
  },
  dim: {
    title: 'DIMENSION',
    icon: '📐',
    color: '#E91E63',
    steps: [
      { label: 'Auto', text: 'Hover over a circle or arc to dimension it automatically.' },
      { label: 'Manual 1', text: 'Or click a first point to start a linear dimension.' },
      { label: 'Manual 2', text: 'Click the second point.' },
      { label: 'Manual 3', text: 'Click to position the dimension line.' },
    ],
    tips: [
      'Click a dimension with the Select tool to edit its value.',
      'Press Escape to cancel.',
    ],
  },
  join: {
    title: 'JOIN',
    icon: '🔗',
    color: '#76FF03',
    steps: [
      { label: 'Step 1', text: 'Click on the endpoint of a line you want to move.' },
      { label: 'Step 2', text: 'Click the target point where it should snap to.' },
    ],
    tips: ['Use Join to close small gaps between lines that almost meet.'],
  },
  fillet: {
    title: 'FILLET',
    icon: '⌒',
    color: '#26A69A',
    steps: [
      { label: 'Step 1', text: 'Click the first line at the corner you want to round.' },
      { label: 'Step 2', text: 'Click the second line that meets it, then press Tab or right-click to confirm.' },
      { label: 'Step 3', text: 'Type the corner radius in mm and press Enter.' },
      { label: 'Result', text: 'The sharp corner becomes a smooth rounded curve!' },
    ],
    tips: [
      'Fillet rounds a sharp corner between two lines.',
      'Radius 0 = sharp corner trim with no curve.',
    ],
  },
  movecopy: {
    title: 'MOVE / COPY',
    icon: '🐸',
    color: '#FF9800',
    steps: [
      { label: 'Step 1 — Select', text: 'Click or drag a window to select the shapes to move or copy.' },
      { label: 'Step 2 — Confirm', text: 'Press Tab or right-click to confirm the selection.' },
      { label: 'Step 3 — Copy mode (optional)', text: 'To copy instead of move: press C, then type the number of copies (1–100) and press Enter. Skip this step to just move.' },
      { label: 'Step 4 — Base point', text: 'Click the point you are picking up from — this is your reference point.' },
      { label: 'Step 5 — Place', text: 'Click the destination point to drop the shape. For copies, each copy is spaced by the same distance from the last.' },
    ],
    tips: [
      'Press C then a number to set copy count before picking base point.',
      'Type a distance in mm after picking the base point for precise placement.',
    ],
  },
  rotatecopy: {
    title: 'ROTATE / COPY',
    icon: '🚁',
    color: '#00BCD4',
    steps: [
      { label: 'Step 1 — Select', text: 'Click or drag a window to select the shapes to rotate or copy.' },
      { label: 'Step 2 — Confirm', text: 'Press Tab or right-click to confirm the selection.' },
      { label: 'Step 3 — Copy mode (optional)', text: 'To make copies instead of rotating: press C, then type the number of copies (1–100) and press Enter. Each copy is placed at the rotation angle apart. Skip this step to just rotate.' },
      { label: 'Step 4 — Centre point', text: 'Click the point to rotate around. All copies will be evenly distributed around this centre.' },
      { label: 'Step 5 — Angle', text: 'Type the angle in degrees and press Enter. Or press Tab to lock the length, then click on screen to set the angle visually.' },
    ],
    tips: [
      'Press C then a number to set copy count — e.g. C then 6 = 6 evenly spaced copies.',
      'Positive angle = counter-clockwise. Negative = clockwise.',
      'Example: C + 4 copies + 90° = one copy every 90°, filling a full circle.',
    ],
  },
  resize: {
    title: 'SCALE',
    icon: '🔥',
    color: '#E91E63',
    steps: [
      { label: 'Step 1', text: 'Click or drag to select the shapes to scale.' },
      { label: 'Step 2', text: 'Press Tab or right-click to confirm.' },
      { label: 'Step 3', text: 'Click the base point (stays fixed during scaling).' },
      { label: 'Step 4', text: 'Type the scale factor and press Enter.' },
    ],
    tips: ['2 = double size. 0.5 = half size. 1 = no change.'],
  },
  mirror: {
    title: 'MIRROR',
    icon: '🔮',
    color: '#9C27B0',
    steps: [
      { label: 'Step 1', text: 'Click or drag to select the shapes to mirror.' },
      { label: 'Step 2', text: 'Press Tab or right-click to confirm selection.' },
      { label: 'Step 3', text: 'Click the first point of the mirror line.' },
      { label: 'Step 4', text: 'Click the second point — the shape mirrors across the line.' },
    ],
    tips: [
      'The mirror line can be at any angle.',
      'The original shape is replaced by its mirror image.',
    ],
  },
  trace: {
    title: 'TRACE IMAGE',
    icon: '🖼',
    color: '#607D8B',
    steps: [
      { label: 'Step 1', text: 'Click on the canvas to set the insert point for your image.' },
      { label: 'Step 2', text: 'Upload the image you want to trace over.' },
      { label: 'Step 3', text: 'Set the scale so the image matches your drawing size.' },
      { label: 'Step 4', text: 'Use the Line and Circle tools to draw over the image.' },
    ],
    tips: ['The image is only a guide — it won\'t appear in your exported PDF.'],
  },
}

// ── Active step resolver ─────────────────────────────────────────────────────
// Returns the 0-based index of the step the user is currently on, or -1.
function getActiveStep(tool, s) {
  if (!s) return -1
  switch (tool) {
    case 'mirror':
      if (!s.mirrorAccepted) return s.mirrorSel.length === 0 ? 0 : 1
      if (!s.mirrorP1) return 2
      return 3
    case 'movecopy':
      if (!s.moveCopyAccepted) return s.moveCopySel.length === 0 ? 0 : 1
      if (s.moveCopyMode === 'copy' && !s.startPoint) return 2
      if (!s.startPoint) return [2, 3]
      return 4
    case 'rotatecopy':
      if (!s.rotateCopyAccepted) return s.rotateCopySel.length === 0 ? 0 : 1
      if (s.rotateCopyMode === 'copy' && !s.startPoint) return 2
      if (!s.startPoint) return [2, 3]
      return 4
    case 'resize':
      if (!s.resizeAccepted) return s.resizeSel.length === 0 ? 0 : 1
      if (!s.startPoint) return 2
      return 3
    case 'fillet':
      if (!s.filletAccepted) {
        if (s.filletSel.length === 0) return 0
        return 1
      }
      return s.filletRadiusInput ? 3 : 2
    case 'offset':
      if (!s.offsetEntity) return 0
      return [1, 2]
    case 'trim':
      return s.trimPreview ? 1 : 0
    case 'extend':
      return s.extendPreview ? 1 : 0
    case 'delete':
      return s.deletePreview ? 1 : 0
    case 'join':
      return s.joinFirstPt ? 1 : 0
    case 'line':
      if (!s.startPoint) return 0
      return [1, 2]
    case 'circle':
      if (!s.circleCenter) return 0
      return 1
    case 'spline':
      if (s.splinePoints.length === 0) return 0
      if (s.splinePoints.length < 3) return 1
      return 2
    case 'dim':
      return s.dimToolStep === 0 ? [0, 1] : s.dimToolStep
    case 'select':
      if (s.selection.length === 0) return 0
      if (!s.selectDimField) return 1
      return 2
    case 'text':
      return [0, 1, 2]
    case 'trace':
      return [0, 1, 2, 3]
    default:
      return -1
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GuidePanel({ tool, toolState }) {
  const guide = GUIDES[tool]
  const diagrams = Diagrams[tool] || []
  const activeStep = getActiveStep(tool, toolState)

  return (
    <div style={{
      width: 230,
      minWidth: 230,
      background: '#0f0f20',
      borderLeft: '1px solid #1e1e3a',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      fontSize: 12,
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      <style>{`@keyframes guidePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      {/* Header */}
      <div style={{
        background: guide ? guide.color + '18' : '#1a1a2e',
        borderBottom: `2px solid ${guide ? guide.color : '#333'}`,
        padding: '12px 14px',
        flexShrink: 0,
      }}>
        <div style={{display:'flex', alignItems:'center', gap: 8, marginBottom: guide && activeStep > -1 ? 10 : 0}}>
          <span style={{fontSize: 18}}>{guide ? guide.icon : '?'}</span>
          <span style={{
            color: guide ? guide.color : '#555',
            fontWeight: 'bold',
            fontSize: 14,
            letterSpacing: '0.08em',
            flex: 1,
          }}>
            {guide ? guide.title : 'SELECT A TOOL'}
          </span>
          {guide && activeStep > -1 && (
            <span style={{color: guide.color, fontSize: 10, opacity: 0.8}}>
              {activeStep + 1}/{guide.steps.length}
            </span>
          )}
        </div>
        {/* Progress bar */}
        {guide && activeStep > -1 && (
          <div style={{height: 3, background: guide.color + '22', borderRadius: 2, overflow:'hidden'}}>
            <div style={{
              height: '100%',
              width: `${((Array.isArray(activeStep) ? Math.max(...activeStep) : activeStep) + 1) / guide.steps.length * 100}%`,
              background: guide.color,
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}/>
          </div>
        )}
      </div>

      {!guide ? (
        <div style={{padding: 20, color: '#333', textAlign: 'center', marginTop: 30, lineHeight: 1.8}}>
          Click any tool on the left to see how to use it.
        </div>
      ) : (
        <div style={{padding: '12px 12px', flex: 1}}>

          {/* Steps header */}
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10}}>
            <div style={{
              color: '#444',
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}>
              Steps
            </div>
            {activeStep > -1 && (
              <div style={{
                color: guide.color,
                fontSize: 9,
                background: guide.color + '18',
                border: `1px solid ${guide.color}44`,
                borderRadius: 3,
                padding: '1px 6px',
                letterSpacing: '0.05em',
              }}>
                {Array.isArray(activeStep)
                  ? `Steps ${activeStep.map(s=>s+1).join('+')} of ${guide.steps.length}`
                  : `Step ${activeStep + 1} of ${guide.steps.length}`}
              </div>
            )}
          </div>

          {guide.steps.map((step, i) => {
            const activeArr = Array.isArray(activeStep) ? activeStep : activeStep > -1 ? [activeStep] : []
            const isActive  = activeArr.includes(i)
            const minActive = activeArr.length ? Math.min(...activeArr) : -1
            const isDone    = activeArr.length > 0 && i < minActive
            return (
            <div key={i} style={{marginBottom: 10, opacity: activeArr.length === 0 ? 1 : isDone ? 0.35 : isActive ? 1 : 0.45, transition: 'opacity 0.2s'}}>
              {/* Diagram — only show for active step */}
              {diagrams[i] && isActive && (
                <div style={{marginBottom: 6, borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 0 2px ${guide.color}88`}}>
                  {diagrams[i]}
                </div>
              )}
              {/* Step card */}
              <div style={{
                padding: '8px 10px',
                borderRadius: 4,
                background: isActive ? guide.color + '18' : '#141428',
                borderLeft: `3px solid ${isActive ? guide.color : isDone ? guide.color + '44' : guide.color + '22'}`,
                boxShadow: isActive ? `0 0 8px ${guide.color}33` : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}>
                <div style={{display:'flex', alignItems:'center', gap: 6, marginBottom: 4}}>
                  {isDone && <span style={{color: '#4CAF50', fontSize: 10}}>✓</span>}
                  {isActive && <span style={{color: guide.color, fontSize: 10, animation: 'guidePulse 1.2s ease-in-out infinite'}}>▶</span>}
                  <div style={{
                    color: isActive ? guide.color : isDone ? '#4CAF50' : guide.color + '88',
                    fontSize: 9,
                    textTransform: 'uppercase',
                    fontWeight: 'bold',
                    letterSpacing: '0.08em',
                  }}>
                    {step.label}
                  </div>
                </div>
                <div style={{color: isActive ? '#ddd' : isDone ? '#666' : '#777', lineHeight: 1.6, fontSize: isActive ? 12 : 11}}>
                  {step.text}
                </div>
              </div>
            </div>
            )
          })}

          {/* Tips */}
          {guide.tips && guide.tips.length > 0 && (
            <div style={{marginTop: 10, borderTop: '1px solid #1e1e3a', paddingTop: 10}}>
              <div style={{
                color: '#B8860B',
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                marginBottom: 8,
                fontWeight: 'bold',
              }}>
                💡 Pro Tips
              </div>
              {guide.tips.map((tip, i) => (
                <div key={i} style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                  background: '#1a1400',
                  border: '1px solid #3a2e00',
                  borderRadius: 4,
                  padding: '6px 8px',
                  marginBottom: 5,
                }}>
                  <span style={{color: '#DAA520', fontSize: 10, flexShrink: 0, marginTop: 1}}>▸</span>
                  <span style={{color: '#DAA520', lineHeight: 1.6, fontSize: 11}}>
                    {tip}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #1a1a2e',
        color: '#2a2a4a',
        fontSize: 10,
        textAlign: 'center',
        flexShrink: 0,
      }}>
        Press Esc to cancel any tool
      </div>
    </div>
  )
}
