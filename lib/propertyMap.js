// Canonical property ID lookup by IGMS or Baselane name
// Add aliases here as new properties come on board

const IGMS_MAP = {
  'Village Lane':        'village-lane',
  'Lindley Park Cottage':'walker',
  'Snowshoe Chalet':     'hidden-hollow',
  'Canal Keep':          'lee-ct',
}

const BASELANE_MAP = {
  'Village Lane': 'village-lane',
  'Walker Ave':   'walker',
  'Kenview':      'kenview',
  'Hidden Hollow':'hidden-hollow',
  'Lee Court':    'lee-ct',
  'BMF Enterprises': null, // portfolio-level, no specific property
}

export function propertyIdFromIgms(name) {
  const id = IGMS_MAP[name?.trim()]
  if (!id) console.warn(`Unknown IGMS property name: "${name}"`)
  return id ?? null
}

export function propertyIdFromBaselane(name) {
  if (!name?.trim()) return null  // empty = portfolio-level, silently return null
  const id = BASELANE_MAP[name.trim()]
  if (id === undefined) console.warn(`Unknown Baselane property name: "${name}"`)
  return id ?? null
}
