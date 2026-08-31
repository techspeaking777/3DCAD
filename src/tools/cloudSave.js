// cloudSave.js — talks to the website's classroom backend (a separate repo,
// technically-speaking-website) to save/load a project to/from a user's
// account, optionally tied to a class.
//
// This app is served same-origin with that backend's /api/* routes (its
// production build is copied into the website's public/tools/3d-cad/), so a
// plain fetch() carries the browser's existing session cookie automatically
// — no Supabase client or Bearer-token plumbing needed here at all.
//
// In the CAD app's OWN standalone `npm run dev` (a different Vite server,
// not same-origin with any backend), these requests have nothing to reach —
// every function here degrades to "unavailable" rather than throwing across
// that boundary, so local CAD-app dev keeps working untouched. getAuthState/
// fetchMyClasses (the two "can I even show cloud UI" probes) swallow errors
// entirely; the rest throw with the server's own message so callers' normal
// setCadError/setLoadError handling can just show it.

const BASE = '/api'

async function readErrorMessage(res) {
  try {
    const body = await res.json()
    return body?.error || `Request failed (${res.status})`
  } catch {
    return `Request failed (${res.status})`
  }
}

// Shared by every throwing call below — a non-ok response gets the server's
// own {error} message via readErrorMessage, but fetch() itself throws a raw
// `TypeError: Failed to fetch` for a genuine network failure (server down,
// offline, DNS), which is not a message a teacher/student should ever see
// verbatim. Normalizing both into one friendly message here means callers'
// setCadError/setLoadError handling never has to special-case which kind of
// failure it was.
async function request(url, opts) {
  let res
  try {
    res = await fetch(url, opts)
  } catch {
    throw new Error("Couldn't reach the server — check your connection")
  }
  if (!res.ok) throw new Error(await readErrorMessage(res))
  return res
}

/** {loggedIn, email?} — never throws; treats any failure as logged-out. */
export async function getAuthState() {
  try {
    const res = await fetch(`${BASE}/auth/me`)
    if (!res.ok) return { loggedIn: false }
    return await res.json()
  } catch {
    return { loggedIn: false }
  }
}

/** [{id, name, role:'teacher'|'student'}] — never throws; [] on any failure. */
export async function fetchMyClasses() {
  try {
    const res = await fetch(`${BASE}/classroom/my-classes`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

/** [{id, name, class_id, format_version, created_at, updated_at}] for the logged-in user. */
export async function listCloudProjects(classId = null) {
  const url = classId ? `${BASE}/cad/projects?class_id=${encodeURIComponent(classId)}` : `${BASE}/cad/projects`
  return (await request(url)).json()
}

/** Creates a new saved project. Returns {id, name, class_id, created_at, updated_at}. */
export async function saveNewCloudProject(name, classId, dataObj) {
  const res = await request(`${BASE}/cad/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, class_id: classId, data: dataObj }),
  })
  return res.json()
}

/** Overwrites an existing saved project (re-save semantics, like a local file's existing handle). */
export async function updateCloudProject(id, name, dataObj) {
  const res = await request(`${BASE}/cad/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: dataObj }),
  })
  return res.json()
}

/** Fetches one saved project's {name, data, format_version}. */
export async function loadCloudProject(id) {
  return (await request(`${BASE}/cad/projects/${encodeURIComponent(id)}`)).json()
}
