"use client";

import { useMemo, useRef, useState } from "react";
import { standardBeatsPerBar, standardTimeline, standardTimingLabel, type StandardSource } from "./standard-timeline";
import { STANDARDS } from "./standards";

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR: Record<string, string[]> = {
  C: ["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7"],
  G: ["Gmaj7", "Am7", "Bm7", "Cmaj7", "D7", "Em7"],
  D: ["Dmaj7", "Em7", "F♯m7", "Gmaj7", "A7", "Bm7"],
  A: ["Amaj7", "Bm7", "C♯m7", "Dmaj7", "E7", "F♯m7"],
  E: ["Emaj7", "F♯m7", "G♯m7", "Amaj7", "B7", "C♯m7"],
  F: ["Fmaj7", "Gm7", "Am7", "B♭maj7", "C7", "Dm7"],
  "B♭": ["B♭maj7", "Cm7", "Dm7", "E♭maj7", "F7", "Gm7"],
  "C♯": ["C♯maj7", "D♯m7", "Fm7", "F♯maj7", "G♯7", "A♯m7"],
  "E♭": ["E♭maj7", "Fm7", "Gm7", "A♭maj7", "B♭7", "Cm7"],
  "F♯": ["F♯maj7", "G♯m7", "A♯m7", "Bmaj7", "C♯7", "D♯m7"],
  "A♭": ["A♭maj7", "B♭m7", "Cm7", "C♯maj7", "E♭7", "Fm7"],
  B: ["Bmaj7", "C♯m7", "D♯m7", "Emaj7", "F♯7", "G♯m7"],
};

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

function parseChord(chord: string) {
  const primary = chord.split("(")[0];
  const rootName = [...NOTES].sort((a,b)=>b.length-a.length).find((n) => primary.startsWith(n));
  const root = rootName ? NOTES.indexOf(rootName) : 0;
  const suffix = rootName ? primary.slice(rootName.length) : primary;
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
  const rootName = [...NOTES].sort((a,b)=>b.length-a.length).find(n=>chord.startsWith(n)) || "C";
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

function addColorTones(base:number[], chord:string) {
  const {root} = parseChord(chord);
  const symbol = chord.split("(")[0];
  const hasNinth = /9|11|13/.test(symbol);
  const ninth = symbol.includes("♭9") ? 13 : symbol.includes("♯9") ? 15 : 14;
  const eleventh = symbol.includes("♯11") ? 18 : 17;
  const thirteenth = symbol.includes("♭13") ? 20 : 21;
  const offsets = [
    ...(hasNinth ? [ninth] : []),
    ...(/11|13/.test(symbol) ? [eleventh] : []),
    ...(symbol.includes("13") || /add6/i.test(symbol) ? [thirteenth] : []),
    ...(symbol.includes("alt") ? [13,15,20] : []),
  ];
  const tones = offsets.map(offset=>48+root+offset).map(note=>note>72?note-12:note);
  return [...new Set([...base,...tones])].sort((a,b)=>a-b);
}

function shapeVoicing(base:number[], chord:string, shape=0) {
  if (shape === 1) {
    const split = Math.ceil(base.length/2);
    const opened = base.map((note,index)=>index>=split?note+12:note).map(note=>note>72?note-12:note).sort((a,b)=>a-b);
    return addColorTones(opened,chord);
  }
  if (shape === 2 && base.length>1) {
    const dropped = [...base];
    dropped[dropped.length-2] -= 12;
    return addColorTones(dropped.sort((a,b)=>a-b),chord);
  }
  return addColorTones(base,chord);
}

function noteName(midi: number) {
  return `${NOTES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function smoothVoiceLeading(chords: string[]) {
  let previous: number[] | null = null;
  let previousName: string | null = null;
  const usedVoicings = new Map<string, Set<string>>();
  return chords.map((name, chordIndex) => {
    const {root, quality} = parseChord(name);
    const intervals = quality === "major" ? [0,4,7]
      : quality === "minor" ? [0,3,7]
      : quality === "minor6" ? [0,3,7,9]
      : quality === "major6" ? [0,4,7,9]
      : quality === "minorMajor7" ? [0,3,7,11]
      : quality === "maj7Flat5" ? [0,4,6,11]
      : quality === "minorAug" ? [0,3,8]
      : quality === "sus" ? [0,5,7]
      : quality === "sus7" ? [0,5,7,10]
      : quality === "dim" ? [0,3,6]
      : quality === "aug" ? [0,4,8]
      : quality === "maj7" ? [0,4,7,11]
      : quality === "m7" ? [0,3,7,10]
      : quality === "halfDim7" ? [0,3,6,10]
      : quality === "dim7" ? [0,3,6,9]
      : quality === "aug7" ? [0,4,8,10]
      : [0,4,7,10];
    const candidates: number[][] = [];
    for (let inversion=0; inversion<intervals.length; inversion++) {
      const rotated = [...intervals.slice(inversion).map(n=>n+root), ...intervals.slice(0,inversion).map(n=>n+root+12)];
      for (const shift of [36,48,60]) {
        const notes = rotated.map(n=>shift+n).sort((a,b)=>a-b);
        if (notes[0]>=43 && notes[notes.length-1]<=76) candidates.push(notes);
      }
    }
    const used = usedVoicings.get(name) || new Set<string>();
    const phraseCenters = [57, 59, 61, 58];
    const desiredCenter = phraseCenters[chordIndex % phraseCenters.length];
    const score = (notes:number[]) => {
      const center = notes.reduce((sum,n)=>sum+n,0)/notes.length;
      if (!previous) return notes.reduce((sum,n)=>sum+Math.abs(n-60),0)+Math.abs(center-desiredCenter);
      const nearestMovement = notes.reduce((sum,n)=>sum+Math.min(...previous!.map(p=>Math.abs(n-p))),0)
        + previous.reduce((sum,p)=>sum+Math.min(...notes.map(n=>Math.abs(n-p))),0)*.45;
      const commonTones = notes.filter(n=>previous!.includes(n)).length;
      const largeLeapPenalty = notes.reduce((sum,n)=>sum+(Math.min(...previous!.map(p=>Math.abs(n-p)))>5?5:0),0);
      let resolutionReward = 0;
      if (previousName) {
        const prev = parseChord(previousName);
        const current = parseChord(name);
        const dominantResolution = ["7","aug7"].includes(prev.quality) && current.root===(prev.root+5)%12;
        const leadingDimResolution = ["dim","dim7"].includes(prev.quality) && current.root===(prev.root+1)%12;
        const movesBy = (fromPc:number,toPc:number,delta:number) => previous!.some(from=>from%12===fromPc && notes.some(to=>to-from===delta && to%12===toPc));
        if (dominantResolution) {
          const targetThird = current.quality==="minor" || current.quality==="m7" ? (current.root+3)%12 : (current.root+4)%12;
          if (movesBy((prev.root+4)%12,current.root,1)) resolutionReward += 9;
          if (movesBy((prev.root+10)%12,targetThird,-1)) resolutionReward += 9;
        }
        if (leadingDimResolution && movesBy(prev.root,current.root,1)) resolutionReward += 8;
      }
      const repeatPenalty = used.has(notes.join(",")) ? 14 : 0;
      return nearestMovement-commonTones*5+largeLeapPenalty+Math.abs(center-desiredCenter)*.7+repeatPenalty-resolutionReward;
    };
    const best = candidates.sort((a,b)=>score(a)-score(b))[0];
    used.add(best.join(","));
    usedVoicings.set(name,used);
    previous = best;
    previousName = name;
    return best;
  });
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

function scheduleNotes(ctx: AudioContext, midis: number[], holdSeconds = 1.15) {
  const releaseAt = Math.max(.2, holdSeconds);
  midis.forEach((midi, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const isBass = midis.length > 1 && i === 0;
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

async function playNotes(midis: number[], holdSeconds = 1.15) {
  const ctx = await ensureAudioContext();
  if (!ctx) return false;
  scheduleNotes(ctx, midis, holdSeconds);
  return true;
}

function withBass(voicing: number[], chord: string) {
  const primary = chord.split("(")[0];
  const slashBass = primary.match(/\/([A-G](?:♯|♭)?)(?:$|[^0-9])/);
  const root = slashBass ? NOTES.indexOf(slashBass[1]) : parseChord(chord).root;
  let bass = 36 + root;
  while (bass >= Math.min(...voicing) - 5) bass -= 12;
  if (bass < 36) bass += 12;
  return [bass, ...voicing];
}

function expandDegrees(degrees: number[], length: number) {
  return Array.from({length}, (_,i)=>degrees[i % degrees.length]);
}

function leadToTarget(chords: string[], target: string, quality:"major"|"minor"|"dominant"|"diminished"|"augmented"="major") {
  const result = [...chords];
  const root = NOTES.indexOf(target);
  if (root < 0 || result.length === 0) return result;
  result[result.length-1] = targetChord(target,quality);
  if (quality === "minor") {
    if (result.length >= 2) result[result.length-2] = `${NOTES[(root+7)%12]}7♭9`;
    if (result.length >= 3) result[result.length-3] = `${NOTES[(root+2)%12]}m7♭5`;
  } else if (quality === "diminished") {
    if (result.length >= 2) result[result.length-2] = `${NOTES[(root+11)%12]}dim7`;
    if (result.length >= 3) result[result.length-3] = `${NOTES[(root+7)%12]}7♭9`;
  } else if (quality === "augmented") {
    if (result.length >= 2) result[result.length-2] = `${NOTES[(root+7)%12]}7♯5`;
    if (result.length >= 3) result[result.length-3] = `${NOTES[(root+2)%12]}m7`;
  } else {
    if (result.length >= 2) result[result.length-2] = `${NOTES[(root+7)%12]}7`;
    if (result.length >= 3) result[result.length-3] = `${NOTES[(root+2)%12]}m7`;
  }
  return result;
}

function resolutionPath(sourceNote:string, sourceQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", target:string, targetQuality:"major"|"minor"|"dominant"|"diminished"|"augmented", length:number) {
  const source = targetChord(sourceNote,sourceQuality);
  const cadence = leadToTarget([source,source,source],target,targetQuality);
  const bridgeLength = Math.max(0,length-4);
  const bridge = Array.from({length:bridgeLength},(_,i)=>i%2===0?`${NOTES[(NOTES.indexOf(target)+9)%12]}m7`:`${NOTES[(NOTES.indexOf(target)+2)%12]}m7`);
  return [source,...bridge,...cadence].slice(0,length);
}

export default function Home() {
  const [key, setKey] = useState("C");
  const [generatorMode, setGeneratorMode] = useState<"common"|"target"|"resolve"|"standards">("common");
  const [extensionsEnabled, setExtensionsEnabled] = useState(true);
  const [extensionLevel, setExtensionLevel] = useState<"7"|"9"|"11"|"13">("7");
  const [preset, setPreset] = useState(0);
  const [standardIndex, setStandardIndex] = useState(0);
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
  const chordCardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const chord = progression[selected];
  const standardBarBeats = standardBeatsPerBar(STANDARDS[standardIndex] as StandardSource);
  const voiceLedProgression = useMemo(() => smoothVoiceLeading(progression), [progression]);
  const chordMidis = useMemo(() => {
    const close = voiceLedProgression[selected] || [48,52,55,59];
    return shapeVoicing(close,chord,voicing);
  }, [voiceLedProgression, selected, voicing, chord]);

  const standardSequence = (index=standardIndex) => {
    const events = standardTimeline(STANDARDS[index] as StandardSource);
    return {
      chords: events.map(event=>event.chord),
      durations: events.map(event=>event.beats),
    };
  };
  const routeForMode = (chords:string[], mode=generatorMode, length=progressionLength, quality=targetQuality) => mode==="standards"?standardSequence(standardIndex).chords:mode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,quality,length):mode==="target"?leadToTarget(chords,globalTarget,quality):chords;

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

  function generate() {
    if (generatorMode === "standards") {
      const sequence = standardSequence();
      setProgression(sequence.chords); setDurations(sequence.durations);
      setSelected(0); setEditTarget(null); setSubstitutionHistory([]); setVoicing(0); return;
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

  function chooseGeneratorMode(nextMode:"common"|"target"|"resolve"|"standards") {
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const nextChords = degrees.map(n=>pool[n]);
    setGeneratorMode(nextMode);
    const standard = standardSequence();
    const routed = nextMode==="standards"?standard.chords:nextMode==="resolve"?resolutionPath(sourceNote,sourceQuality,globalTarget,targetQuality,progressionLength):nextMode==="target"?leadToTarget(nextChords,globalTarget,targetQuality):nextChords;
    setProgression(applyComplexity(routed,extensionsEnabled,extensionLevel,nextMode));
    setDurations(nextMode==="standards"?standard.durations:degrees.map(()=>1));
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseStandard(index:number) {
    const sequence = standardSequence(index);
    setStandardIndex(index); setProgression(sequence.chords); setDurations(sequence.durations);
    setSelected(0); setVoicing(0); setEditTarget(null); setSubstitutionHistory([]);
  }

  function chooseComplexity(enabled:boolean, level=extensionLevel) {
    const pool = MAJOR[key] || MAJOR.C;
    const degrees = expandDegrees(PROGRESSIONS[preset].degrees, progressionLength);
    const baseChords = degrees.map(n=>pool[n]);
    const routed = routeForMode(baseChords);
    setExtensionsEnabled(enabled); setExtensionLevel(level);
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
    progression.forEach((c, i) => {
      const playEvent = () => {
      const fullVoicing = shapeVoicing(voiceLedProgression[i],c);
      const eventBeats = durations[i] ?? 1;
      setSelected(i);
      if (ctx.state === "running") {
        scheduleNotes(ctx, includeBass?withBass(fullVoicing, c):fullVoicing, eventBeats*beat/1000*.94);
      } else {
        void playNotes(includeBass?withBass(fullVoicing, c):fullVoicing, eventBeats*beat/1000*.94);
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

  const bassMidi = withBass(chordMidis, chord)[0];
  const keyboardNotes = includeBass?[bassMidi, ...chordMidis]:chordMidis;
  const whites = Array.from({length:49},(_,i)=>36+i).filter(m=>![1,3,6,8,10].includes(m%12));
  const blacks = Array.from({length:49},(_,i)=>36+i).filter(m=>[1,3,6,8,10].includes(m%12));
  const nextDestination = editTarget === null ? chord : progression[(editTarget+1)%progression.length];
  const editDestination = substitutionTarget === "next" ? nextDestination : `${substitutionTarget}maj7`;
  const destination = parseChord(editDestination);
  const destinationRoot = destination.root;
  const minorDestination = destination.quality === "minor" || destination.quality === "m7" || destination.quality === "halfDim7";
  const majorDestination = ["major","major6","maj7"].includes(destination.quality);
  const stableDestination = !["dim","dim7","aug","aug7","halfDim7"].includes(destination.quality);
  const n = (offset:number) => NOTES[(destinationRoot+offset+12)%12];
  const substitutionOptions = [
    {roman:"V/next", name:"Secondary dominant", chords:[`${n(7)}7`], allowed:true},
    {roman:"vii°7/next", name:"Leading diminished", chords:[`${n(11)}dim7`], allowed:true},
    {roman:"♭II7/next", name:"Tritone dominant", chords:[`${n(1)}7`], allowed:stableDestination},
    {roman:minorDestination?"iiø–V7alt/next":"ii–V/next", name:minorDestination?"Minor two-five":"Major two-five", chords:minorDestination?[`${n(2)}m7♭5`,`${n(7)}7♭9`]:[`${n(2)}m7`,`${n(7)}7`], allowed:stableDestination},
    {roman:"iii–VI/next", name:"Three-six approach", chords:[`${n(4)}m7`,`${n(9)}7`], allowed:stableDestination},
    {roman:"iv–♭VII/next", name:"Backdoor two-five", chords:[`${n(5)}m7`,`${n(10)}7`], allowed:majorDestination},
    {roman:"♭vi–♭II/next", name:"Tritone two-five", chords:[`${n(8)}m7`,`${n(1)}7`], allowed:majorDestination},
    {roman:"IV–iv/next", name:"Major-to-minor plagal", chords:[`${n(5)}maj7`,`${n(5)}m7`], allowed:majorDestination},
    {roman:"♭IImaj7/next", name:"Phrygian borrowed color", chords:[`${n(1)}maj7`], allowed:majorDestination},
    {roman:"♭VImaj7/next", name:"Aeolian borrowed color", chords:[`${n(8)}maj7`], allowed:majorDestination},
    {roman:"iiø/next", name:"Half-diminished V alternative", chords:[`${n(2)}m7♭5`], allowed:majorDestination},
    {roman:"ivm6/next", name:"Minor-six V alternative", chords:[`${n(5)}m6`], allowed:majorDestination},
    {roman:"ivø/next", name:"Borrowed half-diminished", chords:[`${n(5)}m7♭5`], allowed:majorDestination},
    {roman:"♭VIm6/next", name:"Flat-six minor alternative", chords:[`${n(8)}m6`], allowed:majorDestination},
  ];
  const blockedOptions = substitutionOptions.filter(option=>!option.allowed);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#studio"><span className="brandmark">♩</span> Cadence</a>
        <nav><a href="#studio">Studio</a><a href="#learn">Learn</a><a href="#library">Library</a></nav>
        <button className="ghost" onClick={reset}>Start over</button>
      </header>

      <section className="hero" id="studio">
        <div className="eyebrow">Harmony, made visible.</div>
        <h1>Find the chord you <em>meant</em> to play.</h1>
        <p>Generate a progression, reshape the harmony, and learn piano voicings as you go.</p>
        <div className={`generator-card mode-${generatorMode}`}>
          <div className="mode-picker"><span>LEARNING MODE</span><div className="mode-options" role="group" aria-label="Choose a learning mode">
            {([['common','Common progressions'],['target','Target practice'],['resolve','Resolution lab'],['standards','Jazz standards']] as const).map(([mode,label])=><button type="button" key={mode} className={generatorMode===mode?"active":""} aria-pressed={generatorMode===mode} onClick={()=>chooseGeneratorMode(mode)}>{label}</button>)}
          </div></div>
          {generatorMode!=="resolve"&&generatorMode!=="standards"&&<label>TONIC NOTE<select value={key} onChange={(e) => setKey(e.target.value)}>{["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"].map(k => <option key={k}>{k}</option>)}</select></label>}
          {generatorMode==="common"&&<label>KEYBOARD ESSENTIAL<select value={preset} onChange={(e) => choosePreset(+e.target.value)}>{PROGRESSIONS.map((p,i) => <option value={i} key={p.name}>{p.name}</option>)}</select></label>}
          {generatorMode==="standards"&&<label>STANDARD · {STANDARDS.length} SONGS<select value={standardIndex} onChange={e=>chooseStandard(+e.target.value)}>{STANDARDS.map((standard,i)=><option value={i} key={standard.name}>{standard.name} · {standard.key}{standard.matchStatus==="reduction"?" · REDUCED STUDY":""}</option>)}</select></label>}
          {generatorMode==="resolve"&&<><label>SOURCE NOTE<select value={sourceNote} onChange={e=>chooseSource(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="source-quality">SOURCE QUALITY<select value={sourceQuality} onChange={e=>chooseSource(sourceNote,e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode!=="common"&&generatorMode!=="standards"&&<><label>TARGET NOTE<select value={globalTarget} onChange={(e)=>chooseGlobalTarget(e.target.value)}>{NOTES.map(note=><option value={note} key={note}>{note}</option>)}</select></label><label className="target-quality">TARGET QUALITY<select value={targetQuality} onChange={e=>chooseTargetQuality(e.target.value as "major"|"minor"|"dominant"|"diminished"|"augmented")}><option value="major">Major</option><option value="minor">Minor</option><option value="dominant">Dominant</option><option value="diminished">Diminished</option><option value="augmented">Augmented</option></select></label></>}
          {generatorMode==="standards"?<div className="chart-extensions-field"><span>EXTENSIONS</span><div className="chart-extensions">AS WRITTEN</div></div>:<label>EXTENSIONS<div className="complexity-control"><input aria-label="Use tasteful chord extensions" type="checkbox" checked={extensionsEnabled} onChange={e=>chooseComplexity(e.target.checked)}/><span>{extensionsEnabled?"ON":"OFF"}</span><select aria-label="Choose the highest available chord extension" value={extensionLevel} disabled={!extensionsEnabled} onChange={e=>chooseComplexity(true,e.target.value as "7"|"9"|"11"|"13")}><option value="7">Up to 7th</option><option value="9">Up to 9th</option><option value="11">Up to 11th</option><option value="13">Up to 13th</option></select></div></label>}
          <label>TEMPO<div className="tempo"><input aria-label="Playback tempo" type="range" min="55" max="145" value={tempo} onChange={e=>setTempo(+e.target.value)}/><b>{tempo}</b></div></label>
          <button className="primary" onClick={generate}><span>↻</span> {generatorMode==="common"?`Refresh in ${key}`:generatorMode==="standards"?`Restart ${STANDARDS[standardIndex].name}`:generatorMode==="resolve"?"Build resolution":`Reach ${setChordComplexity(targetChord(globalTarget,targetQuality),extensionsEnabled?musicalComplexity(targetChord(globalTarget,targetQuality),extensionLevel):"triad")}`}</button>
          <button className="primary randomize" onClick={generateRandomTheory}><span>✦</span> {generatorMode==="standards"?"Next standard":generatorMode==="resolve"?"New route":"Random theory"}</button>
        </div>
      </section>

      <section className="workspace" id="learn">
        <div className="section-head"><div><span className="step">{generatorMode==="standards"?`01 · ${STANDARDS[standardIndex].bars.length} BARS · ${STANDARDS[standardIndex].timeSignature.join("/")}`:"01"}</span><h2>{generatorMode==="standards"?STANDARDS[standardIndex].name:"Your progression"}</h2><p>{generatorMode==="standards"?`${STANDARDS[standardIndex].key} · ${STANDARDS[standardIndex].style}${STANDARDS[standardIndex].matchStatus==="reduction"?" · Reduced harmonic study":""} · Select each chord to hear its voice-led piano shape.`:"Select a chord to explore it, or add a turnaround before the next chord."}</p></div><div className="progression-controls">{substitutionHistory.length>0&&<button className="undo-sub" onClick={undoSubstitution}>↶ Switch back</button>}<button className={`playall ${isPlaying?"playing":""}`} onClick={playProgression}>{isPlaying?"■ Stop progression":"▶ Play whole progression"}</button></div></div>
        <div className="progression-row" ref={progressionRowRef}>
          {progression.map((c, i) => <div className="chord-card" key={`${c}-${i}`} ref={(node)=>{chordCardRefs.current[i]=node}}>
            <button className={`chord-tile ${selected===i?"active":""} ${editTarget===i?"editing":""} ${durations[i]===.5?"eighth":""} ${generatorMode==="standards"?"standard-bar":""}`} onClick={()=>{const fullVoicing=shapeVoicing(voiceLedProgression[i],c);setSelected(i);setVoicing(0);playNotes(includeBass?withBass(fullVoicing,c):fullVoicing,generatorMode==="standards"?(durations[i]??standardBarBeats)*60000/tempo/1000*.94:1.15)}}><small>{generatorMode==="standards"?standardTimingLabel(durations,i,standardBarBeats):`${String(i+1).padStart(2,"0")} · ${durations[i]===.5?"♪ EIGHTH":"♩ QUARTER"}`}</small><strong>{c}</strong><span>{generatorMode==="standards"?(durations[i]??standardBarBeats)>=standardBarBeats?"HELD":"SHARED BAR":durations[i]===.5?"APPROACH":i===progression.length-1?"HOME":i===0?"TONIC":"COLOR"}</span></button>
            <button className={`substitute-trigger ${editTarget===i?"open":""}`} onClick={()=>{setSelected(i);setVoicing(0);setSubstitutionTarget("next");setShowBlockedInfo(false);setEditTarget(editTarget===i?null:i)}}>{editTarget===i?"× Close":"↗ Substitute"}</button>
          </div>)}
          {generatorMode!=="standards"&&<button className="add-tile" onClick={generate}>＋<span>New idea</span></button>}
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
          <div className="teacher-top compact"><div><span className="step">02 · VOICING TEACHER</span><p>Bass and voice-led shapes across C2–C6</p></div><label className="toggle">SHOW FINGERS <input type="checkbox" checked={fingers} onChange={e=>setFingers(e.target.checked)}/><span/></label></div>
          <div className="voicing-tabs">{["Voice-led position", "Open voicing", "Drop 2"].map((v,i)=><button className={voicing===i?"active":""} key={v} onClick={()=>setVoicing(i)}>{v}</button>)}</div>
          <div className="piano-wrap">
            <div className="chord-label"><span>{chord}</span><small>{includeBass?`BASS ${noteName(bassMidi)}`:"BASS OFF"} &nbsp;·&nbsp; {chordMidis.map(noteName).join("  ·  ")} &nbsp;·&nbsp; PHRASE ARC {selected%4+1}/4</small><label className="bass-toggle"><input type="checkbox" checked={includeBass} onChange={e=>setIncludeBass(e.target.checked)}/><span/> ADD BASS</label></div>
            <div className="piano-shell"><div className="piano">
              {whites.map((midi) => {const cutLeft=blacks.includes(midi-1);const cutRight=blacks.includes(midi+1);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} className={`white ${cutLeft?"cut-left":""} ${cutRight?"cut-right":""} ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} key={midi} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi])}} onPointerUp={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>
                <small>{noteName(midi)}</small>{includeBass&&midi===bassMidi?<b className="bass-finger">B</b>:chordMidis.includes(midi)&&fingers&&<b>{chordMidis.indexOf(midi)+1}</b>}
              </div>})}
              {blacks.map((midi)=>{const nextWhiteIndex=whites.findIndex(white=>white>midi);return <div role="button" tabIndex={0} aria-label={`Play ${noteName(midi)}`} key={midi} style={{left:`${nextWhiteIndex/whites.length*100}%`}} className={`black black-key ${keyboardNotes.includes(midi)?"voiced":""} ${includeBass&&midi===bassMidi?"bass-key":""} ${activeMidi===midi?"key-down":""}`} onPointerDown={()=>{setActiveMidi(midi);playNotes([midi])}} onPointerUp={()=>setActiveMidi(null)} onPointerLeave={()=>setActiveMidi(null)}>{includeBass&&midi===bassMidi?<b className="bass-finger">B</b>:chordMidis.includes(midi)&&fingers&&<b>{chordMidis.indexOf(midi)+1}</b>}</div>})}
            </div></div>
            <button className="listen" onClick={()=>playNotes(includeBass?withBass(chordMidis, chord):chordMidis)}>▶ &nbsp; Hear {includeBass?"voicing + bass":"voicing"}</button>
          </div>
          <div className="lesson-note"><span>✦</span><div><b>Why this works</b><p>{voicing===0?"Each voice takes the shortest practical path from the previous chord, so the harmony connects smoothly instead of jumping back to root position.":voicing===1?"Spreading the inner voices creates space and lets every note breathe.":"Drop 2 moves the second-highest note down an octave for a warm, professional sound."}</p></div></div>
        </div>
      </section>
      <footer><span>Cadence</span><p>Make harmony feel like home.</p><small>Built for curious ears.</small></footer>
    </main>
  );
}
