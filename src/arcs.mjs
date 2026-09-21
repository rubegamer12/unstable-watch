export const ARC_ALIASES = [
  ['spoke-exploit', 'Spoke Exploit', /spoke\s*(?:'s)?\s*exploit|exploit\s*arc/i],
  ['zam', 'Zam', /\bzam\b/i],
  ['clownpierce', 'ClownPierce', /clown\s*pierce|clownpierce/i],
  ['prison', 'Prison', /\bprison\b/i],
  ['mafia', 'Mafia', /\bmafia\b/i],
  ['pirate', 'Pirate', /\bpirate|private\s*arc/i],
  ['director', 'Director', /\bdirector\b/i],
  ['100-days', '100 Days', /100\s*days?|hundred\s*days?/i],
  ['power-vs-skill', 'Power vs Skill', /power\s*(?:vs\.?|versus)\s*skill/i],
  ['power', 'Power', /\bpower\b/i],
  ['toxic-players', 'Toxic Players', /toxic\s*(?:players?|team)/i],
  ['farlands', 'Farlands', /far\s*lands?|farlanda/i],
  ['betrayal', 'Betrayal', /betray(?:al|ed)|bertrayal/i],
  ['bat', 'B.A.T.', /\bb\.?\s*a\.?\s*t\.?\b|\bbat\s*arc/i],
  ['treasure', 'Treasure', /\btreasure\b/i],
  ['fake-identity', 'Fake Identity', /fake\s*identity/i],
  ['training', 'Training', /\btraining\b/i],
  ['election', 'Election', /\belection\b/i],
  ['great-sea', 'Great Sea', /great\s*sea/i],
  ['law', 'The Law', /\bthe\s*law\b|\blaw\s*arc/i],
  ['true-kings', 'True Kings', /true\s*kings?/i],
  ['kings', 'Kings', /\bkings?\b/i],
  ['blue-trims', 'Blue Trims', /blue\s*trims?|invisible\s*(?:guy|dude|player)/i],
  ['cindercrest', 'Cindercrest', /cinder\s*crest|cindercrest|cave\s*kingdom/i],
  ['kingdoms', 'Kingdoms', /\bkingdoms?\b/i],
  ['null', 'NULL', /\bnull\b/i],
  ['purgatory', 'Purgatory', /\bpurgatory\b/i],
  ['warriors', 'Warriors', /\bwarriors?\b/i],
  ['underworld', 'Underworld', /\bunderworld\b/i]
];

function cleanPlaylistTitle(title = '') {
  return title
    .replace(/unstable\s*(?:universe|smp)?/gi, '')
    .replace(/\b(?:full|complete)\s*(?:series|playlist)?\b/gi, '')
    .replace(/\b(?:pov|playlist|videos?)\b/gi, '')
    .replace(/[|:–—_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyArcTitle(title = '') {
  const clean = cleanPlaylistTitle(title);
  for (const [key, name, matcher] of ARC_ALIASES) {
    if (matcher.test(clean) || matcher.test(title)) return { key, name };
  }
  const fallback = clean
    .replace(/\barc\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!fallback) return { key: 'unstable', name: 'Unstable' };
  return {
    key: fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unstable',
    name: fallback.replace(/\b\w/g, letter => letter.toUpperCase())
  };
}

export function looksLikeArcPlaylist(title = '', description = '') {
  const text = `${title} ${description}`;
  if (/unstable\s*(?:universe|smp)?/i.test(text) || /\barc\b/i.test(title)) return true;
  return ARC_ALIASES.some(([, , matcher]) => matcher.test(title));
}
