/** Pitch spellings shared by the app's tonic-note selector. */
export const CIRCLE_NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;

export type CircleNote = (typeof CIRCLE_NOTES)[number];
export type CircleDirection = "fourths" | "fifths";
export type CircleApproach =
  | "direct"
  | "v-of-target"
  | "ii-v"
  | "iii-vi"
  | "vii-dim7"
  | "tritone-dominant"
  | "backdoor-ii-v"
  | "tritone-ii-v"
  | "iv-iv-minor"
  | "gospel-chromatic-pull";
export type CircleTargetQuality = "major7" | "dominant7" | "minor7" | "triad";

export type CircleApproachOption = {
  id: CircleApproach;
  label: string;
  roman: string;
  description: string;
};

export type CircleWarmupEvent = {
  /** Stable key for rendering repeated roots such as the final return home. */
  id: string;
  chord: string;
  /** One target beat or one half-beat approach event. */
  duration: 0.5 | 1;
  role: "approach" | "target";
  /** 0 is the opening home chord; 12 is the final return home. */
  legIndex: number;
  /** The destination this event prepares or states. */
  destinationNote: CircleNote;
  approach: CircleApproach;
  /** Present only on approach events. */
  approachStep?: number;
  /** Present only on approach events. */
  approachStepCount?: number;
};

export type CircleWarmupOptions = {
  startNote: CircleNote;
  direction: CircleDirection;
  approach: CircleApproach;
  targetQuality?: CircleTargetQuality;
};

export const CIRCLE_APPROACH_OPTIONS: readonly CircleApproachOption[] = [
  {
    id: "direct",
    label: "Direct",
    roman: "target",
    description: "Move straight to each next key in the circle.",
  },
  {
    id: "v-of-target",
    label: "V of target",
    roman: "V/target",
    description: "Use the destination's dominant before every target chord.",
  },
  {
    id: "ii-v",
    label: "ii–V",
    roman: "ii–V → target",
    description: "Practice a complete jazz cadence into every key.",
  },
  {
    id: "iii-vi",
    label: "iii–VI",
    roman: "iii–VI → target",
    description: "Use the longer three–six approach relative to each destination.",
  },
  {
    id: "vii-dim7",
    label: "vii°7",
    roman: "vii°7 → target",
    description: "Resolve a leading-tone diminished seventh into each target.",
  },
  {
    id: "tritone-dominant",
    label: "Tritone dominant",
    roman: "♭II7 → target",
    description: "Approach by the dominant a half-step above the destination.",
  },
  {
    id: "backdoor-ii-v",
    label: "Backdoor ii–V",
    roman: "iv–♭VII → target",
    description: "Use the minor-four and flat-seven dominant backdoor cadence.",
  },
  {
    id: "tritone-ii-v",
    label: "Tritone ii–V",
    roman: "ii/♭II–♭II7 → target",
    description: "Prepare the tritone dominant with its own ii chord.",
  },
  {
    id: "iv-iv-minor",
    label: "IV–iv plagal",
    roman: "IV–iv → target",
    description: "Hear the major-four turn minor before resolving home.",
  },
  {
    id: "gospel-chromatic-pull",
    label: "Gospel chromatic pull",
    roman: "VI7–♭VI7–V7 → target",
    description: "Walk dominant color downward chromatically into each target.",
  },
] as const;

const mod12 = (value: number) => ((value % 12) + 12) % 12;

function noteAt(root: number, offset = 0): CircleNote {
  return CIRCLE_NOTES[mod12(root + offset)];
}

function chord(root: number, offset: number, suffix: string) {
  return `${noteAt(root, offset)}${suffix}`;
}

function targetChord(note: CircleNote, quality: CircleTargetQuality) {
  const suffix = quality === "major7" ? "maj7"
    : quality === "dominant7" ? "7"
    : quality === "minor7" ? "m7"
    : "";
  return `${note}${suffix}`;
}

/**
 * Return all twelve destinations plus the final return to the starting key.
 * Fourths advance five semitones; fifths advance seven semitones.
 */
export function circleDestinations(startNote: CircleNote, direction: CircleDirection): CircleNote[] {
  const start = CIRCLE_NOTES.indexOf(startNote);
  if (start < 0) throw new RangeError(`Unknown circle start note: ${startNote}`);
  const step = direction === "fourths" ? 5 : direction === "fifths" ? 7 : 0;
  if (!step) throw new RangeError(`Unknown circle direction: ${direction}`);
  return Array.from({ length: 13 }, (_, index) => noteAt(start, step * index));
}

/** Build the selected route into one destination without adding the target. */
export function circleApproachChords(targetNote: CircleNote, approach: CircleApproach): string[] {
  const root = CIRCLE_NOTES.indexOf(targetNote);
  if (root < 0) throw new RangeError(`Unknown circle target note: ${targetNote}`);

  switch (approach) {
    case "direct": return [];
    case "v-of-target": return [chord(root, 7, "7")];
    case "ii-v": return [chord(root, 2, "m7"), chord(root, 7, "7")];
    case "iii-vi": return [chord(root, 4, "m7"), chord(root, 9, "7")];
    case "vii-dim7": return [chord(root, 11, "dim7")];
    case "tritone-dominant": return [chord(root, 1, "7")];
    case "backdoor-ii-v": return [chord(root, 5, "m7"), chord(root, 10, "7")];
    case "tritone-ii-v": return [chord(root, 8, "m7"), chord(root, 1, "7")];
    case "iv-iv-minor": return [chord(root, 5, "maj7"), chord(root, 5, "m7")];
    case "gospel-chromatic-pull": return [chord(root, 9, "7"), chord(root, 8, "7"), chord(root, 7, "7")];
    default: throw new RangeError(`Unknown circle approach: ${approach}`);
  }
}

/**
 * Create a complete circle warmup. The opening target is stated directly;
 * every later leg inserts the chosen route before its destination. Approach
 * notes are eighth-note-length events (.5), while every target lasts one beat.
 */
export function buildCircleWarmup({
  startNote,
  direction,
  approach,
  targetQuality = "major7",
}: CircleWarmupOptions): CircleWarmupEvent[] {
  const destinations = circleDestinations(startNote, direction);
  return destinations.flatMap((destinationNote, legIndex) => {
    const route = legIndex === 0 ? [] : circleApproachChords(destinationNote, approach);
    const approaches: CircleWarmupEvent[] = route.map((routeChord, approachStep) => ({
      id: `circle-${legIndex}-approach-${approachStep}`,
      chord: routeChord,
      duration: 0.5,
      role: "approach",
      legIndex,
      destinationNote,
      approach,
      approachStep,
      approachStepCount: route.length,
    }));
    return [
      ...approaches,
      {
        id: `circle-${legIndex}-target`,
        chord: targetChord(destinationNote, targetQuality),
        duration: 1,
        role: "target" as const,
        legIndex,
        destinationNote,
        approach,
      },
    ];
  });
}
