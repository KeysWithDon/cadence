"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CIRCLE_APPROACH_OPTIONS,
  buildCircleWarmup,
  type CircleApproach,
  type CircleDirection,
  type CircleNote,
} from "./circle-warmups";
import { standardBeatsPerBar, standardTimeline, standardTimingLabel, type StandardSource } from "./standard-timeline";
import { STANDARDS } from "./standards";
import { voiceLeadProgression, type VoicedChord, type VoiceLeadingStyle, type VoicingLayout } from "./voice-leading";
import { buildDiatonicSevenths, parseChordRoot, spellChordPitch, spellRomanDegree } from "./music-theory";

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR: Record<string,string[]> = Object.fromEntries(NOTES.map(note=>[note,buildDiatonicSevenths(note).slice(0,6)]));

const PROGRESSIONS = [
  { name: "Pop anthem · I–V–vi–IV", degrees: [0,4,5,3] },
  { name: "50s changes · I–vi–IV–V", degrees: [0,5,3,4] },
  { name: "Jazz turnaround · I–vi–ii–V", degrees: [0,5,1,4] },
  { name: "Soul lift · I–iii–IV–V", degrees: [0,2,3,4] },
  { name: "Sensitive pop · vi–IV–I–V", degrees: [5,3,0,4] },
  { name: "Gospel walk · I–IV–ii–V", degrees: [0,3,1,4] },
  { name: "Doo-wop · I–vi–ii–V", degrees: [0,5,1,4] },
  { name: "Royal road · IV–V–iii–vi", degrees: [3,4,2,5] },
  { name: "Plagal soul · I–IV–I–IV", degrees: [0,3,0,3] },
];

type GeneratorMode = "common" | "resolve" | "circle" | "standards";

function parseChord(chord: string) {
  const primary = chord.split("(")[0];
  const parsedRoot = parseChordRoot(primary);
  const root = parsedRoot.root.pitchClass;
  const suffix = parsedRoot.suffix;
  const hasExtension = /7|9|11|13/.test(suffix);
  const isMinor = suffix.startsWith("m") && !suffix.startsWith("maj");
  const quality = /mMaj7/i.test(suffix) ? "minorMajor7"
    : isMinor && suffix.includes("♭5") ? "halfDim7"
    : suffix.includes("maj") && suffix.includes("♭5") ? "maj7Flat5"
    : /^m(?:6|69|6\/9)/.test(suffix) ? "minor6"
    : /^(?:6|69|6\/9|M6)/.test(suffix) ? "major6"
    : suffix.includes("sus") ? hasExtension ? "sus7" : "sus"
    : suffix.includes("♯5") ? "aug7"
    : suffix.includes("dim") ? hasExtension ? "dim7" : "dim"
    : suffix.includes("aug") ? hasExtension ? "aug7" : "aug"
    : /^(?:maj|M7|7\+)/.test(suffix) ? "maj7"
    : suffix.startsWith("m+") ? "minorAug"
    : isMinor ? hasExtension ? "m7" : "minor"
    : hasExtension ? "7" : "major";
  return { root: Math.max(0, root), quality };
}

function setChordComplexity(chord:string, level:"triad"|"7"|"9"|"11"|"13") {
  const rootName = parseChordRoot(chord).root.display;
  if (chord.includes("m6")) return `${rootName}m6`;
  const family = chord.includes("♭5") ? "half-diminished" : chord.includes("dim") ? "diminished" : chord.includes("aug") ? "augmented" : chord.includes("maj") ? "major" : chord.includes("m") ? "minor" : "dominant";
  if (family === "half-diminished") return level==="triad"?`${rootName}dim`:`${rootName}m7♭5`;
  if (level === "triad") return `${rootName}${family==="minor"?"m":family==="diminished"?"dim":family==="augmented"?"aug":""}`;
  if (chord.includes("♭9")) return `${rootName}7♭9`;
  if (chord.includes("♯5")) return `${rootName}7♯5`;
  if (level === "7") return `${rootName}${family==="major"?"maj7":family==="minor"?"m7":family==="diminished"?"dim7":family==="augmented"?"aug7":"7"}`;
  return `${rootName}${family==="major"?`maj${level}`:family==="minor"?`m${level}`:family==="diminished"?`dim${level}`:family==="augmented"?`aug${level}`:level}`;
}

function targetChord(note:string, quality:"major"|"minor"|"dominant"|"diminished"|"augmented") {
  return `${note}${quality==="major"?"maj7":quality==="minor"?"m7":quality==="dominant"?"7":quality==="diminished"?"dim7":"aug7"}`;
}

function musicalComplexity(chord:string, requested:"7"|"9"|"11"|"13") {
  const {quality} = parseChord(chord);
  if (["halfDim7","dim","dim7","aug","aug7"].includes(quality)) return "7" as const;
  if (quality === "major" || quality === "maj7") return requested === "11" || requested === "13" ? "9" as const : requested;
  if (quality === "minor" || quality === "m7" || quality === "minor6") return requested === "13" ? "11" as const : requested;
  return requested === "11" ? "9" as const : requested;
}

function noteName(midi: number) {
  return `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function chordNoteName(midi:number,chord:string){return `${spellChordPitch(chord,midi%12)}${Math.floor(midi/12)-1}`}

function rightHandFinger(index: number, voiceCount: number) {
  const fingerings: Record<number, number[]> = {
    3: [1, 3, 5],
    4: [1, 2, 3, 5],
    5: [1, 2, 3, 4, 5],
  };
  return fingerings[voiceCount]?.[index] ?? index + 1;
}

let sharedAudioContext: AudioContext | null = null;

async function ensureAudioContext() {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioCtx();
  }
  const ctx = sharedAudioContext;

  // Browsers initially suspend Web Audio until it is explicitly resumed from a
  // user gesture. Wait for that resume before scheduling notes; scheduling into
  // a suspended context is unreliable in Safari and other mobile browsers.
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }

  return ctx.state === "running" ? ctx : null;
}

function scheduleNotes(ctx: AudioContext, midis: number[], holdSeconds = 1.15, bassMidi?: number) {
  const releaseAt = Math.max(.2, holdSeconds);
  midis.forEach((midi, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const isBass = i === 0 && midi === bassMidi;
    const noteStart = ctx.currentTime + i * 0.035;
    osc.type = isBass ? "sine" : "triangle";
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(isBass ? 0.15 : 0.09, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, noteStart + releaseAt);
    osc.connect(gain).connect(ctx.destination);
    osc.start(noteStart);
    osc.stop(noteStart + releaseAt + .05);
  });
}

async function playNotes(midis: number[], holdSeconds = 1.15, bassMidi?: number) {
  const ctx = await ensureAudioContext();
  if (!ctx) return false;
  scheduleNotes(ctx, midis, holdSeconds, bassMidi);
  return true;
}

function expandDegrees(degrees: number[], length: number) {
  return Array.from({length}, (_,i)=>degrees[i % degrees.length]);
}

function leadToTarget(chords: string[], target: string, quality:"major"|"minor"|"dominant"|"diminished"|"augmented"="major") {
  const result = [...chords];
  if (result.length === 0) return result;
  result[result.length-1] = targetChord(target,quality);
  if (quality === "minor") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7♭9`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7♭5`;
  } else if (quality === "diminished") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,7)}dim7`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,5)}7♭9`;
  } else if (quality === "augmented") {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7♯5`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7`;
  } else {
    if (result.length >= 2) result[result.length-2] = `${spellRomanDegree(target,5)}7`;
    if (result.length >= 3) result[result.length-3] = `${spellRomanDegree(target,2)}m7`;
  }
  return result;
}

function resolutionPath(sourceNote:string, sourceQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", target:string, targetQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", length:number) {
  const source = targetChord(sourceNote,sourceQuality);
  const cadence = leadToTarget([source,source,source],target,targetQuality);
  const bridgeLength = Math.max(0,length-4);
  const bridge = Array.from({length:bridgeLength},(_,i)=>i%2===0?`${spellRomanDegree(target,6)}m7`:`${spellRomanDegree(target,2)}m7`);
  return [source,...bridge,...cadence].slice(0,length);
}

function audibleNotes(event: VoicedChord, includeBass: boolean) {
  return includeBass ? [event.bass, ...event.upperVoices] : event.upperVoices;
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [key, setKey] = useState("C");
  const [generatorMode, setGeneratorMode] = useState<GeneratorMode>("common");
  const [circleDirection, setCircleDirection] = useState<CircleDirection>("fourths");
  const [circleApproach, setCircleApproach] = useState<CircleApproach>("ii-v");
  const [extensionsEnabled, setExtensionsEnabled] = useState(true);
  const [extensionLevel, setExtensionLevel] = useState<"7"|"9"|"11"|"13">("7");
  const [preset, setPreset] = useState(0);
  const [standardIndex, setStandardIndex] = useState(0);
  const [controlsOpen, setControlsOpen] = useState(false);
  const progressionLength = 4;
  const [progression, setProgression] = useState(["Cmaj7", "Dm7", "G7", "Cmaj7"]);
  const [durations, setDurations] = useState([1,1,1,1]);
  const [selected, setSelected] = useState(0);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [substitutionTarget, setSubstitutionTarget] = useState("next");
  const [showBlockedInfo, setShowBlockedInfo] = useState(false);
  const [globalTarget, setGlobalTarget] = useState("C");
  const [targetQuality, setTargetQuality] = useState<"major"|"minor"|"dominant"|"diminished"|"augmented">("major");
  const [sourceNote, setSourceNote] = useState("C");
  const [sourceQuality, setSourceQuality] = useState<"major"|"minor"|"dominant"|"diminished"|"augmented">("major");
  const [voicing, setVoicing] = useState(0);
  const [fingers, setFingers] = useState(true);
  const [includeBass, setIncludeBass] = useState(true);
  const [tempo, setTempo] = useState(82);
  const [activeMidi, setActiveMidi] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [substitutionHistory, setSubstitutionHistory] = useState<Array<{progression:string[];durations:number[];selected:number}>>([]);
  const playbackTimers = useRef<number[]>([]);
  const progressionRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const themeFrame=requestAnimationFrame(()=>setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    const syncFullscreen=()=>setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange",syncFullscreen);
    return ()=>{cancelAnimationFrame(themeFrame);document.removeEventListener("fullscreenchange",syncFullscreen)};
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("cadence-theme", nextTheme);
  }
  async function toggleFullscreen(){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}
  const chordCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const chord = progression[selected];
  const standardBarBeats = standardBeatsPerBar(STANDARDS[standardIndex] as StandardSource);
  const voiceStyle: VoiceLeadingStyle = generatorMode === "standards" ? "jazz"
    : generatorMode === "circle" ? /gospel|iv-iv/.test(circleApproach) ? "gospel" : "jazz"
    : PROGRESSIONS[preset]?.name.includes("Gospel") || PROGRESSIONS[preset]?.name.includes("Soul") ? "gospel"
    : /Pop|Worship|Sensitive/.test(PROGRESSIONS[preset]?.name ?? "") ? "ccm"
    : "traditional";
  const voiceLayout = (["close", "open", "drop2"] as const)[voicing] satisfies VoicingLayout;
  const voicedProgression = useMemo(() => voiceLeadProgression(progression, {
    style: voiceStyle,
    layout: voiceLayout,
    includeBass: true,
    upperRange: [55, 81],
    bassRange: [36, 48],
    minimumBassGap: 9,
    maximumHandSpan: 12,
  }), [progression, voiceStyle, voiceLayout]);
  const voicedChord = voicedProgression[selected] ?? voicedProgression[0];
  const chordMidis = voicedChord?.upperVoices ?? [48,52,55,59];

  const standardSequence = (index=standardIndex) => {
    const events = standardTimeline(STANDARDS[index] as StandardSource);
    return {
      chords: events.map(event=>event.chord),
      durations: events.map(event=>event.beats),
    };
  };
  const routeForMode = (chords:string[], mode=generatorMode, length=progressionLength, quality=targetQuality) => mode==="standards"?standardSequence(standardIndex).chords:mode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,quality,length):chords;

  const applyComplexity = (chords:string[], enabled=extensionsEnabled, level=extensionLevel, mode=generatorMode) => chords.map((chordName,index)=>{
    if (mode === "standards") return chordName;
    if (!enabled) return setChordComplexity(chordName,"triad");
    const isTarget = mode!=="common" && index===chords.length-1;
    const isDominant = !chordName.includes("maj") && !chordName.includes("m") && !chordName.includes("dim") && !chordName.includes("aug");
    const isMinor = chordName.includes("m") && !chordName.includes("maj");
    const isPhraseTonic = index%4===0;
    const isPredominant = index===chords.length-3;
    if (isTarget) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isDominant) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isMinor && isPredominant) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    if (isPhraseTonic) return setChordComplexity(chordName,musicalComplexity(chordName,level));
    return setChordComplexity(chordName,"triad");
  });

  const circleSequence = (
    startNote=key as CircleNote,
    direction=circleDirection,
    approach=circleApproach,
    enabled=extensionsEnabled,
    level=extensionLevel,
  ) => {
    const events = buildCircleWarmup({startNote,direction,approach});
    const chords = events.map((event) => {
      if (!enabled) return setChordComplexity(event.chord,"triad");
      if (event.role === "target") {
        // State the destinations clearly. Add color only at four-key landmarks
        // and the final homecoming instead of extending every target chord.
        const landmark = event.legIndex%4===0 || event.legIndex===12;
        return setChordComplexity(event.chord,landmark?musicalComplexity(event.chord,level):"triad");
      }
      const finalApproach = event.approachStep === (event.approachStepCount??1)-1;
      const phraseColor = finalApproach && event.legIndex%3===0 && level!=="7";
      return setChordComplexity(event.chord,phraseColor?musicalComplexity(event.chord,level):"7");
    });
    return {events,chords,durations:events.map(event=>event.duration)};
  };

  const loadCircleSequence = (
    direction=circleDirection,
    approach=circleApproach,
    startNote=key as CircleNote,
    enabled=extensionsEnabled,
    level=extensionLevel,
  ) => {
    const sequence = circleSequence(startNote,direction,approach,enabled,level);
    setProgression(sequence.chords); setDurations(sequence.durations);
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  };

  function generate() {
    if (generatorMode === "standards") {
      const sequence = standardSequence();
      setProgression(sequence.chords); setDurations(sequence.durations);
      setSelected(0); setEditTarget(null); setSubstitutionHistory([]); setVoicing(0); return;
    }
    if (generatorMode === "circle") {
      loadCircleSequence();
      return;
    }
    const pool = MAJOR[key] || MAJOR.C;
    const tonicFirst = PROGRESSIONS.map((p,i)=>({p,i})).filter(({p})=>p.degrees[0]===0 && p.degrees.includes(0));
    const alternatives = tonicFirst.filter(({i})=>i!==preset);
    const next = alternatives[Math.floor(Math.random()*alternatives.length)] || tonicFirst[0];
    setPreset(next.i);
    const degrees = expandDegrees(next.p.degrees, progressionLength);
    const nextChords = degrees.map((n) => pool[n]);
    setProgression(applyComplexity(routeForMode(nextChords)));
    setDurations(degrees.map(()=>1));
    setSelected(0);
    setEditTarget(null);
    setSubstitutionHistory([]);
    setVoicing(0);
  }

  function generateRandomTheory() {
    if (generatorMode === "standards") {
      const nextIndex = (standardIndex+1)%STANDARDS.length;
      const sequence = standardSequence(nextIndex);
      setStandardIndex(nextIndex); setProgression(sequence.chords); setDurations(sequence.durations);
      setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]); return;
    }
    if (generatorMode === "circle") {
      const direction = circleDirection === "fourths" ? "fifths" : "fourths";
      setCircleDirection(direction);
      loadCircleSequence(direction);
      return;
    }
    const pool = MAJOR[key] || MAJOR.C;
    const transitions: Record<number,number[]> = {0:[1,2,3,4,5],1:[4,5,2],2:[5,3,1],3:[0,1,4,5],4:[0,5],5:[1,3,4]};
    const degrees = [0];
    while (degrees.length < progressionLength-2) {
      const choices = transitions[degrees[degrees.length-1]];
      degrees.push(choices[Math.floor(Math.random()*choices.length)]);
    }
    if (progressionLength>1) degrees.push(4);
    if (progressionLength>2) degrees.push(0);
    const nextChords = degrees.slice(0,progressionLength).map(n=>pool[n]);
    setProgression(applyComplexity(routeForMode(nextChords)));
    setDurations(degrees.slice(0,progressionLength).map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function choosePreset(index: number) {
    const pool = MAJOR[key] || MAJOR.C;
    setPreset(index);
    const degrees = expandDegrees(PROGRESSIONS[index].degrees, progressionLength);
    const nextChords = degrees.map(n=>pool[n]);
    setProgression(applyComplexity(routeForMode(nextChords)));
    setDurations(degrees.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function applySubstitution(chords: string[]) {
    if (editTarget === null) return;
    const index = editTarget;
    const coloredChords = applyComplexity(chords);
    setSubstitutionHistory(h=>[...h,{progression:[...progression],durations:[...durations],selected}]);
    setProgression((p) => [...p.slice(0,index), ...coloredChords, ...p.slice(index+1)]);
    setDurations((d) => {
      const replacedBeats = d[index] ?? 1;
      return [...d.slice(0,index), ...coloredChords.map(()=>replacedBeats/coloredChords.length), ...d.slice(index+1)];
    });
    setSelected(index); setVoicing(0); setEditTarget(null);
  }

  function chooseGlobalTarget(note: string) {
    setGlobalTarget(note);
    const pool = MAJOR[key] || MAJOR.C;
    const base = expandDegrees(PROGRESSIONS[preset].degrees,progressionLength).map(n=>pool[n]);
    const routed = generatorMode==="resolve"?resolutionPath(sourceNote,sourceQuality,note,targetQuality,progressionLength):leadToTarget(base,note,targetQuality);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,generatorMode));
    setDurations(d=>d.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseTargetQuality(quality:"major"|"minor"|"dominant"|"diminished"|"augmented") {
    setTargetQuality(quality);
    const pool = MAJOR[key] || MAJOR.C;
    const base = expandDegrees(PROGRESSIONS[preset].degrees,progressionLength).map(n=>pool[n]);
    const routed = generatorMode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,quality,progressionLength):leadToTarget(base,globalTarget,quality);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,generatorMode));
    setDurations(d=>d.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseSource(note:string, quality=sourceQuality) {
    setSourceNote(note); setSourceQuality(quality);
    const routed = resolutionPath(note,quality,globalTarget,targetQuality,progressionLength);
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,"resolve"));
    setDurations(routed.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseGeneratorMode(nextMode:GeneratorMode) {
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const nextChords = degrees.map(n=>pool[n]);
    setGeneratorMode(nextMode); setControlsOpen(false);
    if (nextMode === "circle") {
      loadCircleSequence();
      return;
    }
    const standard = standardSequence();
    const routed = nextMode==="standards"?standard.chords:nextMode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,targetQuality,progressionLength):nextChords;
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,nextMode));
    setDurations(nextMode==="standards"?standard.durations:degrees.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseStandard(index:number) {
    const sequence = standardSequence(index);
    setStandardIndex(index); setProgression(sequence.chords); setDurations(sequence.durations);
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseCircleDirection(direction:CircleDirection) {
    setCircleDirection(direction);
    loadCircleSequence(direction);
  }

  function chooseCircleApproach(approach:CircleApproach) {
    setCircleApproach(approach);
    loadCircleSequence(circleDirection,approach);
  }

  function chooseComplexity(enabled:boolean, level=extensionLevel) {
    setExtensionsEnabled(enabled); setExtensionLevel(level);
    if (generatorMode === "circle") {
      loadCircleSequence(circleDirection,circleApproach,key as CircleNote,enabled,level);
      return;
    }
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const baseChords = degrees.map(n=>pool[n]);
    const routed = routeForMode(baseChords);
    setProgression(applyComplexity(routed,enabled,level,generatorMode));
    setDurations(degrees.map(()=>1)); setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function undoSubstitution() {
    const previous = substitutionHistory[substitutionHistory.length-1];
    if (!previous) return;
    setProgression(previous.progression); setDurations(previous.durations); setSelected(previous.selected);
    setSubstitutionHistory(h=>h.slice(0,-1)); setEditTarget(null); setVoicing(0);
  }

  function reset() {
    setGeneratorMode("common"); setKey("C"); setPreset(0);
    setCircleDirection("fourths"); setCircleApproach("ii-v");
    setExtensionsEnabled(true); setExtensionLevel("7");
    setControlsOpen(false);
    setProgression(["Cmaj7", "Dm7", "G7", "Cmaj7"]);
    setDurations([1,1,1,1]);
    setGlobalTarget("C");
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  async function playProgression() {
    playbackTimers.current.forEach(clearTimeout);
    playbackTimers.current = [];
    if (isPlaying) { setIsPlaying(false); return; }

    // Unlock audio while this click still counts as a user gesture. The actual
    // progression notes are dispatched by timers, which cannot unlock audio.
    const ctx = await ensureAudioContext();
    if (!ctx) { setIsPlaying(false); return; }

    setIsPlaying(true);
    const beat = 60000 / tempo;
    let elapsed = 0;
    progression.forEach((_chordName, i) => {
      const playEvent = () => {
      const event = voicedProgression[i];
      if (!event) return;
      const eventBeats = durations[i] ?? 1;
      setSelected(i);
      const notes = audibleNotes(event, includeBass);
      if (ctx.state === "running") {
        scheduleNotes(ctx, notes, eventBeats*beat/1000*.94, includeBass ? event.bass : undefined);
      } else {
        void playNotes(notes, eventBeats*beat/1000*.94, includeBass ? event.bass : undefined);
      }
      const row = progressionRowRef.current;
      const card = chordCardRefs.current[i];
      if (row && card) row.scrollTo({left:card.offsetLeft-row.clientWidth/2+card.clientWidth/2,behavior:"smooth"});
      };
      if (elapsed === 0) playEvent();
      else playbackTimers.current.push(window.setTimeout(playEvent, elapsed * beat));
      elapsed += durations[i] ?? 1;
    });
    playbackTimers.current.push(window.setTimeout(()=>setIsPlaying(false), elapsed * beat));
  }

  const bassMidi = voicedChord?.bass ?? 36;
  const keyboardNotes = includeBass?[bassMidi, ...chordMidis]:chordMidis;
  const whites = Array.from({length:49},(_,i)=>36+i).filter(m=>![1,3,6,8,10].includes(m%12));
  const blacks = Array.from({length:49},(_,i)=>36+i).filter(m=>[1,3,6,8,10].includes(m%12));
  const nextDestination = editTarget === null ? chord : progression[(editTarget+1)%progression.length];
  const editDestination = substitutionTarget === "next" ? nextDestination : `${substitutionTarget}maj7`;
  const destination = parseChord(editDestination);
  const destinationRootName = parseChordRoot(editDestination).root.display;
  const minorDestination = destination.quality === "minor" || destination.quality === "m7" || destination.quality === "halfDim7";
  const majorDestination = ["major","major6","maj7"].includes(destination.quality);
  const stableDestination = !["dim","dim7","aug","aug7","halfDim7"].includes(destination.quality);
  const degree = (value:1|2|3|4|5|6|7,alteration=0) => spellRomanDegree(destinationRootName,value,alteration);
  const substitutionOptions = [
    {roman:"V/next", name:"Secondary dominant", chords:[`${degree(5)}7`], allowed:true},
    {roman:"vii°7/next", name:"Leading diminished", chords:[`${degree(7)}dim7`], allowed:true},
    {roman:"♭II7/next", name:"Tritone dominant", chords:[`${degree(2,-1)}7`], allowed:stableDestination},
    {roman:minorDestination?"iiø–V7alt/next":"ii–V/next", name:minorDestination?"Minor two-five":"Major two-five", chords:minorDestination?[`${degree(2)}m7♭5`,`${degree(5)}7♭9`]:[`${degree(2)}m7`,`${degree(5)}7`], allowed:stableDestination},
    {roman:"iii–VI/next", name:"Three-six approach", chords:[`${degree(3)}m7`,`${degree(6)}7`], allowed:stableDestination},
    {roman:"iv–♭VII/next", name:"Backdoor two-five", chords:[`${degree(4)}m7`,`${degree(7,-1)}7`], allowed:majorDestination},
    {roman:"♭vi–♭II/next", name:"Tritone two-five", chords:[`${degree(6,-1)}m7`,`${degree(2,-1)}7`], allowed:majorDestination},
    {roman:"IV–iv/next", name:"Major-to-minor plagal", chords:[`${degree(4)}maj7`,`${degree(4)}m7`], allowed:majorDestination},
    {roman:"♭IImaj7/next", name:"Phrygian borrowed color", chords:[`${degree(2,-1)}maj7`], allowed:majorDestination},
    {roman:"♭VImaj7/next", name:"Aeolian borrowed color", chords:[`${degree(6,-1)}maj7`], allowed:majorDestination},
    {roman:"iiø/next", name:"Half-diminished V alternative", chords:[`${degree(2)}m7♭5`], allowed:majorDestination},
    {roman:"ivm6/next", name:"Minor-six V alternative", chords:[`${degree(4)}m6`], allowed:majorDestination},
    {roman:"ivø/next", name:"Borrowed half-diminished", chords:[`${degree(4)}m7♭5`], allowed:majorDestination},
    {roman:"♭VIm6/next", name:"Flat-six minor alternative", chords:[`${degree(6,-1)}m6`], allowed:majorDestination},
  ];
  const blockedOptions = substitutionOptions.filter(option=>!option.allowed);
  const activeCircleApproach = CIRCLE_APPROACH_OPTIONS.find(option=>option.id===circleApproach) ?? CIRCLE_APPROACH_OPTIONS[2];
  const circleDirectionLabel = circleDirection === "fourths" ? "fourths" : "fifths";
  const circleEvents = generatorMode === "circle" ? buildCircleWarmup({startNote:key as CircleNote,direction:circleDirection,approach:circleApproach}) : [];
  const sectionStep = generatorMode === "standards"
    ? `01 · ${STANDARDS[standardIndex].bars.length} BARS · ${STANDARDS[standardIndex].timeSignature.join("/")}`
    : generatorMode === "circle" ? `01 · 12 KEYS · CIRCLE OF ${circleDirectionLabel.toUpperCase()}`
    : "01";
  const sectionTitle = generatorMode === "standards" ? STANDARDS[standardIndex].name
    : generatorMode === "circle" ? `Circle of ${circleDirectionLabel} warm-up`
    : "Your progression";
  const sectionDescription = generatorMode === "standards"
    ? `${STANDARDS[standardIndex].key} · ${STANDARDS[standardIndex].style}${STANDARDS[standardIndex].matchStatus==="reduction"?" · Reduced harmonic study":""} · Select each chord to hear its voice-led piano shape.`
    : generatorMode === "circle"
      ? `${activeCircleApproach.roman} before every destination. Play through all 12 keys and return to ${key}; every route and arrival is re-voiced together.`
      : "Select a chord to explore it, or add a turnaround before the next chord.";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#studio"><span className="brandmark">♩</span> Cadence</a>
        <div className="topbar-actions"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} aria-pressed={theme === "dark"}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span><b>{theme === "dark" ? "Light" : "Dark"}</b></button><button className="theme-toggle" type="button" onClick={toggleFullscreen} aria-label={isFullscreen?"Exit full screen":"Enter full screen"} aria-pressed={isFullscreen}><span aria-hidden="true">{isFullscreen?"↙":"↗"}</span><b>{isFullscreen?"Exit full screen":"Full screen"}</b></button><button className="ghost" onClick={reset}>Start over</button></div>
      </header>

      <section className="hero" id="studio">
        <div className="eyebrow">Harmony, made visible.</div>
        <h1>Find the chord you <em>meant</em> to play.</h1>
        <p>Generate a progression, reshape the harmony, and learn piano voicings as you go.</p>
        <div className={`generator-card mode-${generatorMode} ${controlsOpen?"controls-open":""}`}>
          <div className="mode-picker"><span>LEARNING MODE</span><div className="mode-options" role="group" aria-label="Choose a learning mode">
            {([['common','Common progressions'],['resolve','Resolution lab'],['circle','Circle warm-up'],['standards','Jazz standards']] as const).map(([mode,label])=><button type="button" key={mode} className={generatorMode===mode?"active":""} aria-pressed={generatorMode===mode} onClick={()=>chooseGeneratorMode(mode)}>{label}</button>)}
          </div></div>
          <button type="button" className="controls-toggle" onClick={()=>setControlsOpen(open=>!open)} aria-expanded={controlsOpen} aria-controls="generator-controls">{controlsOpen?"Hide controls":"Adjust controls"}<span aria-hidden="true">{controlsOpen?"−":"+"}</span></button>
          <div className="generator-fields" id="generator-controls">
          {generatorMode!=="resolve"&&generatorMode!=="standards"&&<label>{generatorMode==="circle"?"START NOTE":"TONIC NOTE"}<select value={key} onChange={(e) => {const nextKey=e.target.value;setKey(nextKey);if(generatorMode==="circle")loadCircleSequence(circleDirection,circleApproach,nextKey as CircleNote)}}>{["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"].map(k => <option key={k}>{k}</option>)}</select></label>}
          {generatorMode==="common"&&<label>KEYBOARD ESSENTIAL<select value={preset} onChange={(e) => choosePreset(+e.target.value)}>{PROGRESSIONS.map((p,i) => <option value={i} key={p.name}>{p.name}</option>)}</select></label>}
          {generatorMode==="standards"&&<label>STANDARD · {STANDARDS.length} SONGS<select value={standardIndex} onChange={e=>chooseStandard(+e.target.value)}>{STANDARDS.map((standard,i)=><option value={i} key={standard.name}>{standard.name} · {standard.key}{standard.matchStatus==="reduction"?" · REDUCED STUDY":""}</option>)}</select></label>}
          {generatorMode==="resolve"&&<><label>SOURCE NOTE<select value={sourceNote} onChange={e=>chooseSource(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="source-quality">SOURCE QUALITY<select value={sourceQuality} onChange={e=>chooseSource(sourceNote,e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode==="resolve"&&<><label>TARGET NOTE<select value={globalTarget} onChange={(e)=>chooseGlobalTarget(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="target-quality">TARGET QUALITY<select value={targetQuality} onChange={e=>chooseTargetQuality(e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode==="circle"&&<><label className="circle-direction">DIRECTION<select value={circleDirection} onChange={e=>chooseCircleDirection(e.target.value as CircleDirection)}><option value="fourths">Circle of fourths</option><option value="fifths">Circle of fifths</option></select></label><label className="circle-approach">BETWEEN EACH CHORD<select value={circleApproach} onChange={e=>chooseCircleApproach(e.target.value as CircleApproach)}>{CIRCLE_APPROACH_OPTIONS.map(option=><option value={option.id} key={option.id}>{option.roman} · {option.label}</option>)}</select></label></>}
          {generatorMode==="standards"?<div className="standards-spelling"><span>CHORD SPELLING</span><div>AS WRITTEN</div></div>:<label>EXTENSIONS<div className="complexity-control"><input aria-label="Use tasteful chord extensions" type="checkbox" checked={extensionsEnabled} onChange={e=>chooseComplexity(e.target.checked)}/><span>{extensionsEnabled?"ON":"OFF"}</span><select aria-label="Choose the highest available chord extension" value={extensionLevel} disabled={!extensionsEnabled} onChange={e=>chooseComplexity(true,e.target.value as "7"|"9"|"11"|"13")}><option value="7">Up to 7th</option><option value="9">Up to 9th</option><option value="11">Up to 11th</option><option value="13">Up to 13th</option></select></div></label>}
          <label>TEMPO<div className="tempo"><input aria-label="Playback tempo" type="range" min="30" max="200" step="1" value={tempo} onChange={e=>setTempo(+e.target.value)}/><b>{tempo} BPM</b></div></label>
          <button className="primary" onClick={generate}>{generatorMode!=="common"&&<span>↻</span>}{generatorMode==="common"?"Generate Chords":generatorMode==="standards"?`Restart ${STANDARDS[standardIndex].name}`:generatorMode==="circle"?`Build circle from ${key}`:generatorMode==="resolve"?"Build resolution":"Refresh progression"}</button>
          <button className="primary randomize" onClick={generateRandomTheory}><span>✦</span> {generatorMode==="standards"?"Next standard":generatorMode==="circle"?`Switch to ${circleDirection==="fourths"?"fifths":"fourths"}`:generatorMode==="resolve"?"New route":"Random theory"}</button>
          </div>
        </div>
      </section>

      <section className="workspace" id="learn">
        <div className="section-head"><div><span className="step">{sectionStep}</span><h2>{sectionTitle}</h2><p>{sectionDescription}</p></div><div className="progression-controls">{substitutionHistory.length>0&&<button className="undo-sub" onClick={undoSubstitution}>↶ Switch back</button>}<button className={`playall ${isPlaying?"playing":""}`} onClick={playProgression}>{isPlaying?"■ Stop progression":"▶ Play whole progression"}</button></div></div>
        <div className="progression-row" ref={progressionRowRef}>
          {progression.map((c, i) => <div className="chord-card" key={`${c}-${i}`} ref={(node)=>{chordCardRefs.current[i]=node}}>
            <button className={`chord-tile ${selected===i?"active":""} ${editTarget===i?"editing":""} ${durations[i]===.5?"eighth":""} ${generatorMode==="standards"?"standard-bar":""}`} onClick={()=>{const event=voicedProgression[i];setSelected(i);if(event)playNotes(audibleNotes(event,includeBass),generatorMode==="standards"?(durations[i]??standardBarBeats)*60000/tempo/1000*.94:1.15,includeBass?event.bass:undefined)}}><small>{generatorMode==="standards"?standardTimingLabel(durations,i,standardBarBeats):generatorMode==="circle"?`${String((circleEvents[i]?.legIndex??0)+1).padStart(2,"0")} · ${durations[i]===.5?"♪ EIGHTH":"♩ QUARTER"}`:`${String(i+1).padStart(2,"0")} · ${durations[i]===.5?"♪ EIGHTH":"♩ QUARTER"}`}</small><strong>{c}</strong><span>{generatorMode==="standards"?(durations[i]??standardBarBeats)>=standardBarBeats?"HELD":"SHARED BAR":generatorMode==="circle"?circleEvents[i]?.role==="approach"?"APPROACH":circleEvents[i]?.legIndex===0?"START":circleEvents[i]?.legIndex===12?"HOME":"DESTINATION":durations[i]===.5?"APPROACH":i===progression.length-1?"HOME":i===0?"TONIC":"COLOR"}</span></button>
            {generatorMode!=="circle"&&<button className={`substitute-trigger ${editTarget===i?"open":""}`} onClick={()=>{setSelected(i);setSubstitutionTarget("next");setShowBlockedInfo(false);setEditTarget(editTarget===i?null:i)}}>{editTarget===i?"× Close":"↗ Substitute"}</button>}
          </div>)}
          {generatorMode!=="standards"&&generatorMode!=="circle"&&<button className="add-tile" onClick={generate}>＋<span>New idea</span></button>}
        </div>

        {editTarget!==null&&<div className="substitution-compact">
          <label className="target-picker"><span>Target note</span><select value={substitutionTarget} onChange={e=>setSubstitutionTarget(e.target.value)} aria-label="Choose substitution target note"><option value="next">Next chord · {nextDestination}</option>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label>
          <label className="route-picker"><span>Replace <b>{progression[editTarget]}</b> → {substitutionTarget==="next"?nextDestination:substitutionTarget}</span>
            <select value="" aria-label={`Choose a substitution for ${progression[editTarget]}`} onChange={(e)=>{const option=substitutionOptions[+e.target.value];if(option?.allowed)applySubstitution(option.chords)}}>
              <option value="" disabled>Choose a substitution…</option>
              {substitutionOptions.map((option,i)=><option value={i} disabled={!option.allowed} key={`${option.roman}-${i}`}>{option.allowed?"":"BLOCKED · "}{option.roman} · {option.name} · {option.chords.join(" → ")}</option>)}
            </select>
          </label>
          {blockedOptions.length>0&&<button className="blocked-info-trigger" aria-label="Why are some substitutions blocked?" onClick={()=>setShowBlockedInfo(value=>!value)}>i</button>}
          <button aria-label="Close substitution menu" onClick={()=>setEditTarget(null)}>×</button>
          {showBlockedInfo&&blockedOptions.length>0&&<div className="blocked-info"><b>Why some routes are blocked</b><p>{minorDestination?"Backdoor, modal-mixture, and V-alternative colors here are taught as major-tonic resolutions. For this minor destination, use the available iiø–V7♭9 route for clear guide-tone motion.":"This destination is unstable or altered, so Cadence keeps only direct dominant and leading-diminished approaches whose tendency tones resolve clearly."}</p></div>}
        </div>}

        <div className="teacher" id="library">
          <div className="teacher-top compact"><div><span className="step">02 · VOICING TEACHER</span><p>Three comfortable right-hand positions plus a separate bass</p></div><label className="toggle">SHOW FINGERS <input type="checkbox" checked={fingers} onChange={e=>setFingers(e.target.checked)}/><span/></label></div>
          <div className="voicing-tabs">{["Lower position", "Voice-led middle", "Upper position"].map((v,i)=><button className={voicing===i?"active":""} key={v} onClick={()=>setVoicing(i)}>{v}</button>)}</div>
          <div className="piano-wrap">
            <div className="chord-label"><span>{chord}</span><small>{includeBass?`BASS ${chordNoteName(bassMidi,chord)}`:"BASS OFF"} &nbsp;·&nbsp; {chordMidis.map(midi=>chordNoteName(midi,chord)).join("  ·  ")} &nbsp;·&nbsp; PHRASE ARC {selected%4+1}/4</small><label className="bass-toggle"><input type="checkbox" checked={includeBass} onChange={e=>setIncludeBass(e.target.checked)}/><span/> ADD BASS</label></div>
            <div className="piano-shell"><div className="piano">
              {whites.map((midi) => {const cutLeft=blacks.includes(midi-1);const cutRight=blacks.includes(midi+1);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} className={`white ${cutLeft?"cut-left":""} ${cutRight?"cut-right":""} ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} key={midi} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi])}} onPointerUp={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>
                <small>{keyboardNotes.includes(midi)?chordNoteName(midi,chord):noteName(midi)}</small>{includeBass&&midi===bassMidi?<b className="bass-finger">LH</b>:chordMidis.includes(midi)&&fingers&&<b>{rightHandFinger(chordMidis.indexOf(midi),chordMidis.length)}</b>}
              </div>})}
              {blacks.map((midi)=>{const nextWhiteIndex=whites.findIndex(white=>white>midi);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} key={midi} style={{left:`${nextWhiteIndex/whites.length*100}%`}} className={`black black-key ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi])}} onPointerUp={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>{includeBass&&midi===bassMidi?<b className="bass-finger">LH</b>:chordMidis.includes(midi)&&fingers&&<b>{rightHandFinger(chordMidis.indexOf(midi),chordMidis.length)}</b>}</div>})}
            </div></div>
            <button className="listen" onClick={()=>voicedChord&&playNotes(audibleNotes(voicedChord,includeBass),1.15,includeBass?voicedChord.bass:undefined)}>▶ &nbsp; Hear {includeBass?"voicing + bass":"voicing"}</button>
            {isFullscreen&&<div className="fullscreen-explanation"><b>Why this movement works</b><p>{voicedChord?.diagnostics.summary} The bass and upper voices were re-evaluated together so common tones can stay, guide tones can resolve, and each hand stays in a comfortable register.</p></div>}
          </div>
          <div className="lesson-note"><span>✦</span><div><b>Why this works</b><p>{voicedChord?.diagnostics.summary} {voicing===0?"This lower right-hand position stays clear of the separate bass.":voicing===1?"This middle position balances a comfortable register with the smoothest available voice leading.":"This upper position moves the same required chord tones higher without increasing the hand stretch."} The right hand spans {voicedChord?.diagnostics.handSpan ?? 0} semitones.</p></div></div>
        </div>
      </section>
      <footer><span>Cadence</span><p>Make harmony feel like home.</p><small>Built for curious ears.</small></footer>
    </main>
  );
}
