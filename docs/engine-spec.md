# Keyscene engine spec (normative)

Normative behavior for `keyscene-core` (PLAN.md §3.2). This document plus the
data/vector files it references are the source of truth: engine disputes
resolve by changing this spec (with vectors in the same PR), never by silently
changing code (PLAN.md §6).

Normative companion files:

- `crates/keyscene-core/data/chords.json` — chord vocabulary (embedded in the
  binary; never fetched).
- `crates/keyscene-core/tests/vectors/{spelling,naming,roman}.json` — test
  vectors. Regenerate with `tests/vectors/generate.py` (an
  engine-independent implementation of this spec; hand-authored cases live in
  the generator's `HAND_*` tables).

Counts required by PLAN.md Phase 1: ≥200 spelling, ≥300 naming, ≥100 Roman
numeral vectors. The test harness asserts these minimums.

---

## 1. Definitions

- **pc** — pitch class 0–11 (C=0 … B=11). **MIDI note** 0–127; middle C = 60
  = C4 (scientific pitch, octave = `midi/12 − 1`).
- **Spelled note** — letter A–G + accidental ∈ {bb, b, ♮(empty), #, ##} +
  octave. ASCII rendering: `Bbb3`, `F#4`, `C##5`. The octave is chosen so
  that `natural(letter, octave) + accidental_offset = midi` (so midi 59 in a
  C-flat context is `Cb4`, midi 60 in a B-sharp context is `B#3`).
- **Line of fifths (LoF)** — every spelled pc maps to an integer:
  F=−1, C=0, G=1, D=2, A=3, E=4, B=5; each sharp adds +7, each flat −7
  (Bb=−2, F#=6, Bbb=−9, C##=14). All spelling distance rules use this line.
- **Interval names** — `(letter steps, semitones)` pairs, octave-reduced:
  P1(0,0) m2(1,1) M2(1,2) A2(1,3) m3(2,3) M3(2,4) P4(3,5) A4(3,6) d5(4,6)
  P5(4,7) A5(4,8) m6(5,8) M6(5,9) A6(5,10) d7(6,9) m7(6,10) M7(6,11)
  m9(1,1) M9(1,2) A9(1,3) P11(3,5) A11(3,6) m13(5,8) M13(5,9).
- **Key** — tonic spelled pc + mode ∈ {major, minor}. The 24 supported keys
  use these tonic spellings: majors C G D A E B F# Db Ab Eb Bb F; minors
  A E B F# C# G# Eb Bb F C G D. (User-selected keys are one of these 24.)

## 2. API contract

`analyze(notes: &[MidiNote], key: Option<Key>, settings: &Settings) -> Analysis`

Pure and deterministic: identical inputs give identical outputs, across
platforms and across native/WASM builds. Input notes are deduplicated and
sorted ascending; the lowest is the **bass**. `Analysis` contains
`chord_names` (ranked, all valid interpretations), `spelled_notes` (one per
input note, same order), `roman_numeral` (when a key is set), `intervals`
(from the bass, simple-reduced), `bass_note`, `inversion`, `is_partial`.

`Settings`: `accidental_pref` (Auto | Sharps | Flats — applies only where a
rule below says "default table"), `rn_convention` (Textbook | Quality),
`name_language` (English | German | Solfege — display formatting only;
vectors are English unless stated).

Never-blank rule: 1 note → note name (text = spelling without octave, `C#`);
2 notes → interval name (text = `<lower>·<upper> (<interval>)`, e.g.
`C·E (M3)`, semitone-based names P8 m2 M2 m3 M3 P4 TT P5 m6 M6 m7 M7; a
perfect-fifth dyad additionally ranks `X5` first: `["C5", "C·G (P5)"]`);
≥3 notes → at least one chord name or the cluster fallback (§3.4).

## 3. Chord naming

### 3.1 Matching

Let `P` = input pc set, `b` = bass pc. For every candidate root `r ∈ P` and
every template `T` in chords.json: the candidate matches iff every non-`opt`
interval of `T` is present in `P` relative to `r`, and `P` contains no pc
outside `T`'s full interval set relative to `r`. The chord symbol is the
template symbol plus each absent opt-interval's `suf` (in template order),
e.g. `C7(no5)`. Roots not present in `P` are never candidates (no rootless
voicings in v1).

### 3.2 Ranking

Score per candidate `(r, T)`:

```text
score = weight(T)                       // chords.json
      + 25 × [b == r]                   // bass is the root
      + 3 × |P|                         // fuller matches beat subsets
      − 6 × (# absent opt intervals)
      + 10 × [key set and r is a diatonic pc of key]
      + 5  × [key set and P ⊆ diatonic pcs of key]
```

Diatonic pcs of a minor key = natural minor + raised 7th (harmonic).
Sort candidates by score desc; ties by root pc asc, then symbol asc
(byte order). `chord_names[0]` is the display name. Duplicate `(root,
symbol)` pairs are emitted once (symmetric chords like dim7/aug match the
same template under several roots — each root is one candidate).

### 3.3 Inversions and slash basses

If `b != r` the name gains `/<bass spelling>` (`C/E`). Because matching is
exact (§3.1), `b` is always a tone of the winning template — except for
slash-bass fallback names (§3.4), where the bass is outside the template. When the bass
interval is a core triad/7th degree (3rd, 5th, 6th, 7th), `inversion` =
1/2/3 by that degree's position; when it is a tension (9/11/13),
`inversion = None` (slash notation only, e.g. `Cadd9/D`). Bass spelling
follows the chord-tone rule (§5.1).

### 3.4 Fallbacks

- **Polychord**: if `P` partitions into two disjoint complete major/minor
  triads, emit an alternate `Upper|Lower` (`D|C`), where Lower is the triad
  containing the bass (score 40 + bass bonus). Both triads are also ranked
  normally if they match on their own.
- **Quartal**: if the sorted input notes form ≥3 consecutive perfect
  fourths, emit an alternate `<bass spelling> quartal(n)` (score 30).
- **Slash bass**: if `P \ {b}` has ≥3 pcs, additionally match `P \ {b}`
  per §3.1–3.2 (the score formula runs on the reduced set, so the
  bass-is-root bonus never fires) and subtract 25; name
  `X/<bass spelling>` with the bass spelled per §5.2. A slash reading whose
  (root, template) pair also matches `P` exactly is suppressed — the exact
  reading accounts for the bass as a chord tone. The rest rank in the
  common candidate pool — usually alternates (`Cm6/F` under `F9`), and the
  primary name only when nothing matches `P` exactly (`C/Db`, `E/F`).
  When one is on top, upper-structure tones dictate their spelling per
  §5.1. No inversion number, no Roman numeral (§4).
- **Cluster**: if nothing matches, `chord_names` = one entry, the spelled
  pcs joined with `·` (`C·Db·D`), score 0. Spelling per §5.2.

## 4. Roman numerals (key required)

Computed for the top-ranked chord when its template's third+fifth family is
classifiable (all templates in v1 are; clusters/dyads/slash-bass fallback
names get `None`).

- **Degree**: from the root's spelled letter distance to the tonic letter
  (0→I … 6→VII) with an accidental prefix when the root's LoF differs from
  the diatonic degree's LoF: `b` per −7, `#` per +7 (`bIII`, `bVI`, `bVII`,
  `bII`, `#IV`). In minor, the diatonic reference is natural minor; degree
  7 has two prefix-free references — natural (subtonic: Bb in C minor is
  `VII`) and raised (leading tone: B° in C minor is `vii°`).
- **Quality (Textbook convention)**: lower-case iff the third is minor;
  `°` for dim triad/m7b5(ø)/dim7, `ø7` for m7b5, `°7` for dim7, `+` for aug.
  Seventh-family suffixes: `7` (dominant/minor 7th), `maj7` (major 7th on
  major triad), `m(maj7)` → `maj7` on lower-case numeral. Extended/altered
  chords keep their symbol tail after the numeral: `V9`, `V7(b9)`, `ii11`.
- **Quality convention**: numeral always upper-case, chord symbol appended
  verbatim minus the root: `IIm7`, `V7`, `IVmaj7`, `VIIm7b5`.
- **Inversion figures** (both conventions): triads `6`, `64`; sevenths `7`,
  `65`, `43`, `42` (replacing the plain `7`). Extended chords and true
  slash chords carry no figures.
- **Secondary chords**: when the chord is not diatonic and is a major triad
  or dominant-family chord whose root is a P5 above a diatonic degree
  2,3,4,5,6 (target shown in the key's own diatonic quality for Textbook:
  `V/ii`…`V/vi`; upper-case for Quality: `V/II`), name it `V/x`, `V7/x`,
  `V65/x` etc. When it is dim/dim7/m7b5 a semitone below such a degree:
  `vii°/x`, `vii°7/x`, `viiø7/x`. Secondary naming wins over accidental
  prefixes (`D7` in C is `V7/V`, never `II7`).
- **Borrowed/chromatic**: otherwise the prefixed numeral + quality stands
  (`iv`, `bVI`, `bVII7`, `bII6` — Neapolitan is just `bII6`).

## 5. Enharmonic spelling

Never a fixed per-key table (PLAN.md §1.3). Priority: chord interpretation
first, then key, then default tables.

### 5.1 Chord tones

The top-ranked interpretation dictates spelling: spell the root (§5.3), then
each chord tone by interval arithmetic from the root (letter = root letter +
interval steps; accidental = whatever makes the pc). Applies to every input
note that is a tone of the winning candidate — even against the key (an E
major triad while the key is C spells E G# B, not Ab: the ChordieApp defect
we must not repeat). A dim7 spells its d7 by interval: `C#dim7` = C# E G Bb
(d7 = 6 letter steps + 9 semitones above C#; note this corrects the
transposed example in PLAN.md §3.2), `Ebdim7` = Eb Gb Bbb Dbb.
If any tone would need a triple accidental, respell the root enharmonically
(prefer the candidate root spelling with fewer accidentals) and redo.

### 5.2 Non-chord contexts (clusters, non-tone basses, single notes)

With a key: choose the spelling (≤1 accidental) minimizing LoF distance to
the key's center: `LoF(tonic) + 2` for major, `LoF(tonic) − 1` for minor.
White-note enharmonics (Fb, Cb, E#, B#) add a penalty of 3 to their LoF
distance, so chart-style naturals win near-ties — a bare pc 4 in Db is E,
not Fb — while decisively-closer cases keep the enharmonic (Cb in Db,
E# in F#, Fb in Gb). Ties resolve flatwise (lower LoF). Exception: in
minor keys the pc 11 semitones above the tonic is always the raised 7th
(G# in A minor). This yields the conventional mixed set in C major:
C# Eb F# Ab Bb. Without a key: default tables (§5.3, note row).

### 5.3 Root and default spellings

With a key, the root spelling is chord-aware: among candidate root
spellings (≤2 accidentals), spell all matched template tones by interval
arithmetic and pick the root minimizing the *mean* LoF distance of those
tones to the key center; ties flatwise. This yields Db (bII, Neapolitan)
for a major triad on pc 1 in C, but C# for C#dim7; G#dim7 (not Abdim7) in
C; Cb7 (VI7) on pc 11 in Eb minor.
Without a key, black-key roots and bare notes use these default tables,
overridable by `accidental_pref` = Sharps (all-sharp) or Flats (all-flat):

| pc | 1 | 3 | 6 | 8 | 10 |
| --- | --- | --- | --- | --- | --- |
| major-family roots (maj, sus, 6, maj7, dom, 9, 11, 13, aug) | Db | Eb | F# | Ab | Bb |
| minor-family roots (m, m6, m7, m9, m11, m13, m(maj7)) | C# | Eb | F# | G# | Bb |
| dim-family roots (dim, dim7, m7b5) | C# | D# | F# | G# | A# |
| bare notes / clusters | Db | Eb | F# | Ab | Bb |

### 5.4 Display languages

`name_language` maps spelled letters for display: German (H = B♮, B = B♭,
else identical); Solfège (Do Re Mi Fa Sol La Si + `#`/`b`). Internal
representation and vectors stay English.

## 6. Key suggestion (assistive)

`suggest_keys(pc_weights: [f32; 12]) -> Vec<(Key, f32)>` — Pearson
correlation against the Krumhansl–Kessler profiles (major: 6.35 2.23 3.48
2.33 4.38 4.09 2.52 5.19 2.39 3.66 2.29 2.88; minor: 6.33 2.68 3.52 5.38
2.60 3.53 2.54 4.75 3.98 2.69 3.34 3.17) rotated to each of the 24 keys,
sorted desc, top 3, deterministic tie-break by key (majors before minors,
tonic pc asc). Suggestion only — the user confirms; manual selection always
wins (PLAN.md §3.2).

## 7. Stability requirements (property-tested)

1. Octave invariance: transposing any input by ±12 changes no chord name.
2. Transposition equivariance: transposing by n semitones transposes every
   root/bass pc by n (names change only in root spelling).
3. Totality: any 3+ note input yields ≥1 chord name or a cluster name;
   1–2 notes yield note/interval names; no input of ≤10 sounding notes
   panics or returns blank output.
4. Spelling soundness: every spelled note's pc equals its input note's pc.
5. Determinism: `analyze` is a pure function of its arguments.

## 8. Vector file formats

Common: every case has a unique `id` and optional `why` (provenance note).
`notes` are MIDI numbers. `key` is `"C"`, `"Ebm"`, `null` etc. (§1 keys;
`m` suffix = minor).

- `spelling.json`: `{id, notes, key?, accidental_pref?, expect: ["E4","G#4","B4"]}`
  — expected spellings aligned with sorted deduped input.
- `naming.json`: `{id, notes, key?, expect_top, expect_alternates_include?,
  expect_bass?, expect_inversion?}` — `expect_top` is the exact formatted
  `chord_names[0]` text; alternates are texts that must appear somewhere in
  `chord_names`.
- `roman.json`: `{id, notes, key, convention, expect}` — exact RN string,
  `expect: null` asserts `roman_numeral` is None.
