import { useEffect, useRef, useState } from 'react'
import App3D from './App3D.jsx'
import DrawingApp from './App.jsx'
import { getAuthState } from './tools/cloudSave.js'

// Where the website's login pages should send people back to afterwards.
// Both /student-login and /login only honour relative in-site paths.
const NEXT = encodeURIComponent('/tools/3d-cad/index.html')
const STUDENT_LOGIN_URL = `/student-login?next=${NEXT}`
const TEACHER_LOGIN_URL = `/login?next=${NEXT}`
const GUEST_KEY = 'retrocad-guest'

// Students sign in with a username, but Supabase stores it as a synthetic
// email — never show that address, just the username part.
const displayName = (email) => (email || '').replace(/@students.stem4schools.net$/, '')

// Top-level shell: one running app, two tabs sharing the same window. Both
// tabs stay mounted simultaneously (toggled via CSS display, never
// unmounted) so switching tabs never loses in-progress sketch/tool state or
// undo history in either one — the same "keep both alive" approach the app
// already uses for its two superimposed 3D/2D-overlay canvases.
export default function AppShell() {
  const [activeTab, setActiveTab] = useState('3d')   // '3d' | 'drawing'
  // Pushed up from App3D (onProjectNameChange prop) on every successful
  // save/open/cloud-load — lives here, not in App3D, since this bar is
  // shared by both tabs and sits outside either app's own component.
  const [projectName, setProjectName] = useState(null)
  // {text, error} from App3D's autosave, or null (off / nothing saved yet).
  const [autosave, setAutosave] = useState(null)
  // Student's name while a teacher/admin is editing a COPY of that student's
  // work (pushed from App3D); null otherwise.
  const [feedbackStudent, setFeedbackStudent] = useState(null)
  const app3dRef = useRef(null)
  const drawingRef = useRef(null)
  const app3dWrapRef = useRef(null)
  const drawingWrapRef = useRef(null)

  // null = still checking; otherwise {loggedIn, email?}. Guests get the full
  // tool — logging in only unlocks saving to / opening from the school.
  const [auth, setAuth] = useState(null)
  const [guestChosen, setGuestChosen] = useState(() => {
    try { return sessionStorage.getItem(GUEST_KEY) === '1' } catch { return false }
  })
  useEffect(() => { getAuthState().then(setAuth) }, [])

  // A teacher's "Open in Retro CAD" link (?loadProjectId=) must go straight
  // to the project, never behind a welcome prompt.
  const opensProject = new URLSearchParams(window.location.search).has('loadProjectId')
  const showWelcome = auth && !auth.loggedIn && !guestChosen && !opensProject

  function continueAsGuest() {
    try { sessionStorage.setItem(GUEST_KEY, '1') } catch { /* private mode: just hide for this view */ }
    setGuestChosen(true)
  }
  // Leaving the page loses any unsaved work, so the in-app button asks first;
  // the welcome prompt (nothing drawn yet) goes straight through.
  function goToLogin(url, confirmFirst) {
    if (confirmFirst && !window.confirm('Logging in leaves this page, and any unsaved work will be lost. Continue?')) return
    window.location.href = url
  }
  async function logOut() {
    try { await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' }) } catch { /* reload below shows true state */ }
    try { sessionStorage.removeItem(GUEST_KEY) } catch { /* ignore */ }
    window.location.reload()
  }

  const authBtnStyle = {
    background: 'transparent', border: '1px solid #3ad6ff', borderRadius: 4,
    color: '#3ad6ff', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.05em',
    padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
  }
  const welcomeBtn = (primary) => ({
    width: '100%', padding: '12px 16px', borderRadius: 6, cursor: 'pointer',
    fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14, letterSpacing: '0.05em',
    background: primary ? '#3ad6ff' : 'transparent',
    color: primary ? '#001018' : '#ccc',
    border: primary ? '1px solid #3ad6ff' : '1px solid #444',
  })

  function selectTab(tab) {
    setActiveTab(tab)
    // Route keyboard shortcuts to whichever app is now visible — both apps'
    // root divs are plain per-element tabIndex={0}, not window-level
    // listeners, so focusing the right one is enough.
    requestAnimationFrame(() => {
      const wrap = tab === '3d' ? app3dWrapRef.current : drawingWrapRef.current
      wrap?.querySelector('[tabindex]')?.focus()
    })
  }

  // Distinct accent per tab (not just position) so the active one reads at a
  // glance: cyan matches the app's wordmark/3D-viewport accent, orange
  // matches the Drawing tab's own tool-icon palette.
  const ACCENT = { '3d': '#3ad6ff', drawing: '#FF7043' }

  const tabBtnStyle = (tab, active) => ({
    display: 'flex', alignItems: 'center', gap: 9,
    padding: '0 26px',
    height: '100%',
    background: active ? '#161616' : 'transparent',
    color: active ? '#fff' : '#777',
    border: 'none',
    borderBottom: active ? `3px solid ${ACCENT[tab]}` : '3px solid transparent',
    boxShadow: active ? `inset 0 0 16px ${ACCENT[tab]}22` : 'none',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    fontSize: 15,
    letterSpacing: '0.08em',
    cursor: 'pointer',
    transition: 'all 0.12s',
  })

  const CubeIcon = ({ color }) => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M10 1.5l8 4.5v8l-8 4.5-8-4.5v-8l8-4.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M2 6l8 4.5 8-4.5M10 10.5v8" stroke={color} strokeWidth="1.1" opacity="0.7"/>
    </svg>
  )
  const PencilIcon = ({ color }) => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M3 17l1-4.2L12.3 4.5a1.5 1.5 0 0 1 2.2 0l1 1a1.5 1.5 0 0 1 0 2.2L7.2 16 3 17z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M11 6.5l2.5 2.5" stroke={color} strokeWidth="1.1"/>
    </svg>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000' }}>
      <div style={{ height: 48, flexShrink: 0, display: 'flex', background: '#0a0a0a', borderBottom: '1px solid #222' }}>
        <button style={tabBtnStyle('3d', activeTab === '3d')} onClick={() => selectTab('3d')}>
          <CubeIcon color={activeTab === '3d' ? ACCENT['3d'] : '#777'}/>
          3D MODEL
        </button>
        <button style={tabBtnStyle('drawing', activeTab === 'drawing')} onClick={() => selectTab('drawing')}>
          <PencilIcon color={activeTab === 'drawing' ? ACCENT.drawing : '#777'}/>
          DRAWING
        </button>

        {/* Tagline — sits in the otherwise-empty stretch between the tabs
            and the wordmark. Same neon-glow text-shadow treatment as the
            RETRO CAD wordmark below, just smaller/dimmer so it reads as a
            tagline, not a second logo competing with it. */}
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 22 }}>
          <span style={{
            fontFamily: 'monospace', fontStyle: 'italic', fontSize: 13,
            letterSpacing: '0.03em', color: '#7fe0ff',
            textShadow: '0 0 6px #3ad6ff99, 0 0 14px #3ad6ff44',
            whiteSpace: 'nowrap',
          }}>
            Depth in Simplicity
          </span>
        </div>

        {/* Current project name — only once something's actually been saved
            or opened (a brand-new, never-saved project shows nothing here
            rather than a misleading "Untitled"). Pushed up from App3D via
            onProjectNameChange on every save/open/cloud-load. */}
        {projectName && (
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 22, minWidth: 0 }}>
            <span style={{
              fontFamily: 'monospace', fontSize: 13, color: '#999',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
            }} title={projectName}>
              {projectName}
            </span>
            {autosave && (
              <span style={{
                fontFamily: 'monospace', fontSize: 11, marginLeft: 10, whiteSpace: 'nowrap',
                color: autosave.error ? '#ff8a65' : '#69F0AE',
              }}>
                {autosave.error ? '⚠ ' : '● '}{autosave.text}
              </span>
            )}
          </div>
        )}

        {feedbackStudent && (
          <span style={{
            fontFamily: 'monospace', fontSize: 12, marginLeft: 14, padding: '3px 10px', borderRadius: 4,
            background: '#3a2a00', border: '1px solid #FF9800', color: '#FFB74D', whiteSpace: 'nowrap',
          }} title="Your changes are saved as a new copy in the student's folder; their original is never changed.">
            ✎ Editing a copy of {feedbackStudent}'s work
          </span>
        )}

        {/* Wordmark — lives here (the one bar that's never in either app's own
            toolbar, so it can't get crowded out by tool groups) rather than
            inside App3D's sketch toolbar, which needed the width back. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: 'auto', paddingRight: 16 }}>
          {auth && (auth.loggedIn ? (
            <>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#69F0AE', whiteSpace: 'nowrap' }} title={auth.email}>
                ● {displayName(auth.email)}
              </span>
              <button onClick={() => window.open('/account/projects', '_blank')} title="See everything saved to your account" style={authBtnStyle}>My projects</button>
              <button onClick={logOut} style={{ ...authBtnStyle, borderColor: '#333', color: '#999' }}>Log out</button>
            </>
          ) : (
            <>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#777', whiteSpace: 'nowrap' }}>Guest</span>
              <button onClick={() => goToLogin(STUDENT_LOGIN_URL, true)} style={authBtnStyle}>Log in</button>
            </>
          ))}
          <button
            onClick={() => window.open('/retrocad-plus', '_blank')}
            title="Learn about RetroCAD+"
            style={{
              background: 'transparent', border: '1px solid #333', borderRadius: 4,
              color: '#999', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.05em',
              padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            More info
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
              <path d="M10 1.5l8 4.5v8l-8 4.5-8-4.5v-8l8-4.5z" stroke="#3ad6ff" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M2 6l8 4.5 8-4.5M10 10.5v8" stroke="#3ad6ff" strokeWidth="1.2" opacity="0.6"/>
            </svg>
            <span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: 18,
              letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#FF9800', textShadow: '0 0 8px #FF9800' }}>RETRO</span>
              {' '}
              <span style={{ color: '#3ad6ff', textShadow: '0 0 10px #3ad6ff,0 0 20px #3ad6ff88' }}>CAD</span>
            </span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={app3dWrapRef} style={{ display: activeTab === '3d' ? 'block' : 'none', height: '100%' }}>
          <App3D
            ref={app3dRef}
            getSheetData={() => drawingRef.current?.getSheetData()}
            onSheetLoaded={sheet => drawingRef.current?.restoreSheetData(sheet)}
            onProjectNameChange={setProjectName}
            onAutosaveStatus={setAutosave}
            onFeedbackStudent={setFeedbackStudent}
          />
        </div>
        <div ref={drawingWrapRef} style={{ display: activeTab === 'drawing' ? 'block' : 'none', height: '100%' }}>
          <DrawingApp ref={drawingRef} getSolidIds={() => app3dRef.current?.getSolidIds() ?? []} />
        </div>
      </div>

      {showWelcome && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.78)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div role="dialog" aria-modal="true" aria-label="Welcome to Retro CAD" data-welcome-modal style={{
            width: '100%', maxWidth: 380, background: '#0f0f16', border: '1px solid #2a2a3a',
            borderRadius: 10, padding: '28px 28px 22px', fontFamily: 'monospace', textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontWeight: 'bold', fontSize: 22, letterSpacing: '0.1em' }}>
              <span style={{ color: '#FF9800', textShadow: '0 0 8px #FF9800' }}>RETRO</span>{' '}
              <span style={{ color: '#3ad6ff', textShadow: '0 0 10px #3ad6ff,0 0 20px #3ad6ff88' }}>CAD</span>
            </div>
            <p style={{ color: '#aaa', fontSize: 13, lineHeight: 1.5, margin: '14px 0 22px' }}>
              Log in to save your work to your class, or carry on as a guest.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button style={welcomeBtn(true)} onClick={() => goToLogin(STUDENT_LOGIN_URL, false)}>Student log in</button>
              <button style={welcomeBtn(false)} onClick={continueAsGuest}>Continue as guest</button>
            </div>
            <p style={{ color: '#777', fontSize: 11, margin: '16px 0 0' }}>
              Teacher?{' '}
              <a href={TEACHER_LOGIN_URL} style={{ color: '#3ad6ff' }}>Log in here</a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
