// featureDeps.js — what each feature in the Feature Tree relies on.
//
// Part of "edit any feature, everything after it updates"
// (docs/plan-edit-history.md). Worked out purely from data features already
// store, so it needs no change to the save format:
//   - a cutout / fillet / shell needs the body it modifies (its base feature)
//   - a mirror needs its source body
//   - a Join / Subtract needs its members
//   - a feature sketched on a body's face needs that body
//   - a pattern copy needs the body it repeats (patternOf)
// Bodies are found by solidId; the "base" of a body is the feature that owns it
// (extrude, revolve, loft, sweep, spring, mirror, join, import).

const BODY_OPS = ['extrude', 'revolve', 'loft', 'sweep', 'spring', 'mirror', 'join', 'import']

export function isBodyOwner(f) {
  return f?.type === 'extrude' && BODY_OPS.includes(f.operation || 'extrude')
}

// The feature that owns body `solidId` (null when none — e.g. a deleted body).
export function baseFeatureOf(solidId, feats) {
  if (solidId == null) return null
  return feats.find(f => f.solidId === solidId && isBodyOwner(f)) || null
}

// Ids of the features `feat` directly needs, in tree order, without itself.
export function featureNeeds(feat, feats) {
  if (!feat) return []
  const need = new Set()
  const addBody = solidId => { const b = baseFeatureOf(solidId, feats); if (b && b.id !== feat.id) need.add(b.id) }
  if (!isBodyOwner(feat)) addBody(feat.solidId)                       // cutout / fillet / shell
  if (feat.operation === 'mirror') addBody(feat.sourceSolidId)
  if (feat.operation === 'join') for (const id of feat.memberFeatureIds || []) if (id !== feat.id) need.add(id)
  if (feat.planeId === 'face' && feat.facePlane?.solidId != null) addBody(feat.facePlane.solidId)
  if (feat.patternOf != null && feat.patternOf !== feat.id && feats.some(f => f.id === feat.patternOf)) need.add(feat.patternOf)
  return feats.filter(f => need.has(f.id)).map(f => f.id)
}

// Every feature that needs `id`, directly or through others, in tree order.
export function dependentsOf(id, feats) {
  const hit = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of feats) {
      if (hit.has(f.id)) continue
      if (featureNeeds(f, feats).some(n => hit.has(n))) { hit.add(f.id); grew = true }
    }
  }
  hit.delete(id)
  return feats.filter(f => hit.has(f.id)).map(f => f.id)
}
