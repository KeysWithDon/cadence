export type NoteLetter = "A"|"B"|"C"|"D"|"E"|"F"|"G";
export type SpelledNote = { letter: NoteLetter; accidental: "bb"|"b"|""|"#"|"##"; pitchClass: number; display: string };

const LETTERS: NoteLetter[] = ["C","D","E","F","G","A","B"];
const NATURAL_PC: Record<NoteLetter,number> = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const ACCIDENTAL_VALUE: Record<string,number> = {bb:-2,b:-1,"":0,"#":1,"##":2};
const mod12=(value:number)=>((value%12)+12)%12;
const glyph=(accidental:string)=>accidental.replace(/bb/g,"𝄫").replace(/##/g,"𝄪").replace(/b/g,"♭").replace(/#/g,"♯");

export function parseSpelledNote(value:string):SpelledNote {
  const match=value.trim().replace(/♯/g,"#").replace(/♭/g,"b").match(/^([A-Ga-g])((?:bb|##|b|#)?)/);
  if(!match) throw new RangeError(`Invalid written note: ${value}`);
  const letter=match[1].toUpperCase() as NoteLetter;
  const accidental=(match[2]||"") as SpelledNote["accidental"];
  return {letter,accidental,pitchClass:mod12(NATURAL_PC[letter]+ACCIDENTAL_VALUE[accidental]),display:`${letter}${glyph(accidental)}`};
}

export function parseChordRoot(symbol:string){
  const normalized=symbol.trim().replace(/♯/g,"#").replace(/♭/g,"b");
  const match=normalized.match(/^([A-Ga-g])((?:bb|##|b|#)?)/);
  if(!match) throw new RangeError(`Invalid chord root: ${symbol}`);
  const root=parseSpelledNote(match[0]);
  return {root,suffix:normalized.slice(match[0].length).replace(/#/g,"♯").replace(/b/g,"♭")};
}

export const pitchClassOf=(value:string)=>parseSpelledNote(value).pitchClass;

function accidentalFor(letter:NoteLetter,pitchClass:number):SpelledNote["accidental"]{
  const difference=((pitchClass-NATURAL_PC[letter]+18)%12)-6;
  if(difference===-2)return "bb"; if(difference===-1)return "b"; if(difference===0)return ""; if(difference===1)return "#"; if(difference===2)return "##";
  throw new RangeError(`Cannot spell pitch ${pitchClass} as ${letter}`);
}

export function spellInterval(rootValue:string, diatonicSteps:number, semitones:number):string {
  const root=parseSpelledNote(rootValue);
  const rootIndex=LETTERS.indexOf(root.letter);
  const letter=LETTERS[(rootIndex+diatonicSteps)%7];
  const accidental=accidentalFor(letter,mod12(root.pitchClass+semitones));
  return `${letter}${glyph(accidental)}`;
}

export function buildMajorScale(key:string):string[]{
  const intervals=[0,2,4,5,7,9,11];
  return intervals.map((semitones,index)=>spellInterval(key,index,semitones));
}

export function buildDiatonicSevenths(key:string):string[]{
  const scale=buildMajorScale(key);
  return [`${scale[0]}maj7`,`${scale[1]}m7`,`${scale[2]}m7`,`${scale[3]}maj7`,`${scale[4]}7`,`${scale[5]}m7`,`${scale[6]}m7♭5`];
}

/** Spell an altered scale degree by its written Roman function, not a chromatic lookup table. */
export function spellRomanDegree(target:string, degree:1|2|3|4|5|6|7, alteration=-0):string{
  const majorSemitones=[0,2,4,5,7,9,11];
  return spellInterval(target,degree-1,majorSemitones[degree-1]+alteration);
}

export function chordWithRoot(symbol:string,newSuffix?:string){const {root,suffix}=parseChordRoot(symbol);return `${root.display}${newSuffix??suffix}`}

export function spellChordPitch(symbol:string,pitchClass:number):string{
  const {root,suffix}=parseChordRoot(symbol.split("/")[0]);
  const minor=/^m(?!aj)/.test(suffix); const diminished=/dim|°/.test(suffix); const augmented=/aug|♯5|#5/.test(suffix);
  const major7=/maj|Δ/.test(suffix); const degrees=[
    {step:0,semi:0},{step:2,semi:minor||diminished?3:4},{step:4,semi:diminished?6:augmented?8:7},
    {step:6,semi:diminished?9:major7?11:10},{step:1,semi:/♭9|b9/.test(suffix)?1:/♯9|#9/.test(suffix)?3:2},
    {step:3,semi:/♯11|#11/.test(suffix)?6:5},{step:5,semi:/♭13|b13/.test(suffix)?8:9},
  ];
  const found=degrees.find(item=>mod12(root.pitchClass+item.semi)===mod12(pitchClass));
  return found?spellInterval(root.display,found.step,found.semi):["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"][mod12(pitchClass)];
}

export function normalizeChordTypography(symbol:string):string{
  return symbol.replace(/([A-G])bb/g,"$1𝄫").replace(/([A-G])##/g,"$1𝄪").replace(/([A-G])b/g,"$1♭").replace(/([A-G])#/g,"$1♯");
}
