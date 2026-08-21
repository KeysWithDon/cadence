import { normalizeChordTypography, parseChordRoot } from "./music-theory.ts";

export type ParsedChart = {
  chords: string[];
  chordLines: number;
};

const MAX_CHORDS = 512;

function possibleChord(token: string) {
  let raw = token.trim().replace(/^[0-9]+[.)-]?/, "");
  while (raw && "[({".includes(raw[0])) raw = raw.slice(1);
  while (raw && "])},;:.!?".includes(raw[raw.length-1])) raw = raw.slice(0, -1);
  const cleaned = normalizeChordTypography(raw);
  if (!cleaned || !/^[A-Ga-g]/.test(cleaned)) return null;

  try {
    const { root, suffix } = parseChordRoot(cleaned);
    // A root must be followed by a recognizable chord quality/bass. This keeps
    // lyric words such as “Can” or “Going” out of a text-chart import.
    if (!/^(?:|m(?:aj)?(?:[0-9]|\(|\/|♭|♯|add|sus|[+−-])?.*|maj.*|M(?:[0-9]|aj).*|Δ.*|dim.*|°.*|ø.*|aug.*|\+.*|sus.*|add.*|[0-9].*|\/[A-Ga-g](?:𝄫|𝄪|♭|♯|bb|##|b|#)?)$/.test(suffix)) return null;
    return `${root.display}${suffix}`;
  } catch {
    return null;
  }
}

/**
 * Extract written chord symbols from a lead sheet without normalizing their
 * enharmonic roots. The chart remains the notation authority; Cadence only
 * adds voicings and motion around it.
 */
export function parseLeadSheet(text: string): ParsedChart {
  const chords: string[] = [];
  let chordLines = 0;
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    const candidates = rawLine.split(/[\s|]+/).map(possibleChord).filter((value): value is string => Boolean(value));
    const chartLike = rawLine.includes("|") || candidates.length >= 2;
    if (!chartLike || candidates.length === 0) continue;
    chordLines += 1;
    for (const chord of candidates) {
      if (chords.length >= MAX_CHORDS) return { chords, chordLines };
      chords.push(chord);
    }
  }
  return { chords, chordLines };
}
