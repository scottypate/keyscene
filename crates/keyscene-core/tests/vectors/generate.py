#!/usr/bin/env python3
"""Generate normative test vectors for keyscene-core.

Independent implementation of docs/engine-spec.md (shares only
data/chords.json with the engine). Run from this directory:

    python3 generate.py

Writes spelling.json, naming.json, roman.json and prints counts.
Hand-authored cases live in the HAND_* tables at the bottom.
"""

import json
import os
from itertools import count

HERE = os.path.dirname(os.path.abspath(__file__))
CHORDS = json.load(open(os.path.join(HERE, "../../data/chords.json")))["templates"]

# ---------------------------------------------------------------- theory core

LETTERS = "CDEFGAB"
NAT_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
LOF_BASE = {"F": -1, "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5}
ACC_STR = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}

# interval name -> (letter steps, semitones mod 12)
IV = {
    "P1": (0, 0), "m2": (1, 1), "M2": (1, 2), "A2": (1, 3), "m3": (2, 3),
    "M3": (2, 4), "P4": (3, 5), "A4": (3, 6), "d5": (4, 6), "P5": (4, 7),
    "A5": (4, 8), "m6": (5, 8), "M6": (5, 9), "A6": (5, 10), "d7": (6, 9),
    "m7": (6, 10), "M7": (6, 11), "m9": (1, 1), "M9": (1, 2), "A9": (1, 3),
    "P11": (3, 5), "A11": (3, 6), "m13": (5, 8), "M13": (5, 9),
}
TENSION = {"m9", "M9", "A9", "P11", "A11", "m13", "M13"}


def sp_pc(letter, acc):
    return (NAT_PC[letter] + acc) % 12


def sp_lof(letter, acc):
    return LOF_BASE[letter] + 7 * acc


def sp_str(letter, acc):
    return letter + ACC_STR[acc]


def parse_sp(s):
    letter, rest = s[0], s[1:]
    acc = {"bb": -2, "b": -1, "": 0, "#": 1, "##": 2}[rest]
    return letter, acc


def interval_above(root, iv_name):
    """Spelled pc an interval above a spelled root. Returns (letter, acc)."""
    steps, semis = IV[iv_name]
    rl, ra = root
    letter = LETTERS[(LETTERS.index(rl) + steps) % 7]
    acc = (sp_pc(rl, ra) + semis - NAT_PC[letter]) % 12
    if acc > 6:
        acc -= 12
    return letter, acc


def spelled_with_octave(midi, letter, acc):
    """Octave such that natural(letter, octave) + acc == midi."""
    natural = midi - acc
    octave = natural // 12 - 1
    return f"{sp_str(letter, acc)}{octave}"


# ---------------------------------------------------------------------- keys

MAJOR_TONICS = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"]
MINOR_TONICS = ["A", "E", "B", "F#", "C#", "G#", "Eb", "Bb", "F", "C", "G", "D"]
MAJ_SCALE = ["P1", "M2", "M3", "P4", "P5", "M6", "M7"]
NAT_MIN_SCALE = ["P1", "M2", "m3", "P4", "P5", "m6", "m7"]


class Key:
    def __init__(self, name):
        self.name = name
        self.minor = name.endswith("m")
        self.tonic = parse_sp(name[:-1] if self.minor else name)
        scale = NAT_MIN_SCALE if self.minor else MAJ_SCALE
        self.degrees = [interval_above(self.tonic, iv) for iv in scale]
        self.diatonic_pcs = {sp_pc(*d) for d in self.degrees}
        if self.minor:  # harmonic: raised 7th is part of the key (spec §3.2)
            self.leading = (sp_pc(*self.tonic) + 11) % 12
            self.diatonic_pcs.add(self.leading)
        self.center = sp_lof(*self.tonic) + (-1 if self.minor else 2)

    def spell_pc(self, pc):
        """Spec §5.2: nearest-to-center spelling, <=1 accidental, ties flatwise.
        Minor exception: leading tone is always the raised 7th."""
        if self.minor and pc == self.leading:
            seventh = self.degrees[6]
            return seventh[0], seventh[1] + 1
        best = None
        for letter in LETTERS:
            for acc in (-1, 0, 1):
                if sp_pc(letter, acc) != pc:
                    continue
                lof = sp_lof(letter, acc)
                cand = (abs(lof - self.center), lof)  # tie -> flatwise
                if best is None or cand < best[0]:
                    best = (cand, (letter, acc))
        return best[1]


ALL_KEYS = {k: Key(k) for k in MAJOR_TONICS} | {
    k + "m": Key(k + "m") for k in MINOR_TONICS
}

# ------------------------------------------------- default root spelling §5.3

DEFAULT_MAJOR = {1: "Db", 3: "Eb", 6: "F#", 8: "Ab", 10: "Bb"}
DEFAULT_MINOR = {1: "C#", 3: "Eb", 6: "F#", 8: "G#", 10: "Bb"}
DEFAULT_DIM = {1: "C#", 3: "D#", 6: "F#", 8: "G#", 10: "A#"}
SHARPS = {1: "C#", 3: "D#", 6: "F#", 8: "G#", 10: "A#"}
FLATS = {1: "Db", 3: "Eb", 6: "Gb", 8: "Ab", 10: "Bb"}
NATURALS = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}


def template_family(t):
    ivs = {e["i"] for e in t["intervals"]}
    if "m3" in ivs and "d5" in ivs and "P5" not in ivs:
        return "dim"
    if "m3" in ivs:
        return "min"
    return "maj"


def default_root(pc, family="maj", pref="auto"):
    if pc in NATURALS:
        return parse_sp(NATURALS[pc])
    table = {
        ("auto", "maj"): DEFAULT_MAJOR, ("auto", "min"): DEFAULT_MINOR,
        ("auto", "dim"): DEFAULT_DIM, ("auto", "note"): DEFAULT_MAJOR,
    }.get((pref, family))
    if pref == "sharps":
        table = SHARPS
    elif pref == "flats":
        table = FLATS
    return parse_sp(table[pc])


# ----------------------------------------------------- matching/ranking §3.1-2


def expand(t):
    """pc offsets: (required set, full set, opt list [(iv, suf)])."""
    req, full, opts = set(), set(), []
    for e in t["intervals"]:
        semis = IV[e["i"]][1]
        full.add(semis)
        if e.get("opt"):
            opts.append((e["i"], e.get("suf", "")))
        else:
            req.add(semis)
    return req, full, opts


def candidates(pcs, bass, key=None):
    """All (score, root_pc, template, suffix) exact matches, spec-ranked."""
    out = []
    kobj = ALL_KEYS[key] if key else None
    for r in sorted(pcs):
        rel = {(p - r) % 12 for p in pcs}
        for t in CHORDS:
            req, full, opts = expand(t)
            if not (req <= rel <= full):
                continue
            absent = [(iv, suf) for iv, suf in opts if IV[iv][1] not in rel]
            suffix = "".join(suf for _, suf in absent)
            score = t["weight"] + 25 * (bass == r) + 3 * len(pcs) - 6 * len(absent)
            if kobj:
                if r in kobj.diatonic_pcs:
                    score += 10
                if pcs <= kobj.diatonic_pcs:
                    score += 5
            out.append((score, r, t, suffix))
    out.sort(key=lambda c: (-c[0], c[1], c[2]["symbol"] + c[3]))
    return out


def slash_candidates(pcs, bass, key=None):
    """Spec §3.4 slash-bass readings: match the >=3 pcs above the bass and
    name X/<bass>; score runs on the reduced set (no bass-is-root bonus)
    minus 25. Ranked in the common pool with exact matches."""
    upper = pcs - {bass}
    if len(upper) < 3:
        return []
    return [(s - 25, r, t, suf) for s, r, t, suf in candidates(upper, bass, key)]


def ranked(pcs, bass, key=None):
    """Exact + slash-bass candidates in one spec-ranked list; the trailing
    flag marks slash-bass entries. Slash readings duplicating an exact
    (root, template) pair are suppressed (the exact one reads the bass as
    a chord tone)."""
    exact = candidates(pcs, bass, key)
    seen = {(r, t["id"]) for _, r, t, _ in exact}
    out = [(s, r, t, suf, False) for s, r, t, suf in exact]
    out += [(s, r, t, suf, True)
            for s, r, t, suf in slash_candidates(pcs, bass, key)
            if (r, t["id"]) not in seen]
    out.sort(key=lambda c: (-c[0], c[1], c[2]["symbol"] + c[3]))
    return out


def chord_tone_spellings(root_sp, template, pcs, root_pc):
    """pc -> (letter, acc) for every input pc, via interval arithmetic."""
    m = {}
    for e in template["intervals"]:
        pc = (root_pc + IV[e["i"]][1]) % 12
        if pc in pcs:
            m[pc] = interval_above(root_sp, e["i"])
    return m


def key_root_spelling(kobj, root_pc, template, pcs):
    """Spec §5.3: chord-aware root spelling in a key — pick the candidate
    root minimizing mean LoF distance of the matched tones to the key
    center; ties flatwise."""
    best = None
    for letter in LETTERS:
        for acc in (-2, -1, 0, 1, 2):
            if sp_pc(letter, acc) != root_pc:
                continue
            tones = chord_tone_spellings((letter, acc), template, pcs, root_pc)
            if any(abs(a) > 2 for _, a in tones.values()):
                continue
            lofs = [sp_lof(*t) for t in tones.values()]
            mean = sum(abs(l - kobj.center) for l in lofs) / len(lofs)
            cand = (mean, sp_lof(letter, acc))
            if best is None or cand < best[0]:
                best = (cand, (letter, acc))
    return best[1]


def format_candidate(cand, pcs, bass, kobj, pref):
    """(text, tone map) for one ranked() entry, exact or slash-bass."""
    _, r, t, suffix, is_slash = cand
    tone_pcs = (pcs - {bass}) if is_slash else pcs
    root_sp = (key_root_spelling(kobj, r, t, tone_pcs) if kobj
               else default_root(r, template_family(t), pref))
    tones = chord_tone_spellings(root_sp, t, tone_pcs, r)
    text = sp_str(*root_sp) + t["symbol"] + suffix
    if is_slash:
        bass_sp = kobj.spell_pc(bass) if kobj else default_root(bass, "note", pref)
        text += "/" + sp_str(*bass_sp)
    elif bass != r:
        text += "/" + sp_str(*tones[bass])
    return text, tones


def top_name(notes, key=None, pref="auto"):
    """Formatted chord_names[0] + spelling map, replicating the engine."""
    pcs = {n % 12 for n in notes}
    bass = min(notes) % 12
    kobj = ALL_KEYS[key] if key else None
    for cand in ranked(pcs, bass, key)[:1]:
        return format_candidate(cand, pcs, bass, kobj, pref)
    return None, None


def all_names(notes, key=None, pref="auto"):
    pcs = {n % 12 for n in notes}
    bass = min(notes) % 12
    seen, out = set(), []
    kobj = ALL_KEYS[key] if key else None
    for cand in ranked(pcs, bass, key):
        text, _ = format_candidate(cand, pcs, bass, kobj, pref)
        if text not in seen:
            seen.add(text)
            out.append(text)
    return out


def spellings_for(notes, key=None, pref="auto"):
    """Expected spelled_notes for sorted deduped input."""
    notes = sorted(set(notes))
    pcs = {n % 12 for n in notes}
    _, tones = top_name(notes, key, pref)
    kobj = ALL_KEYS[key] if key else None
    out = []
    for n in notes:
        pc = n % 12
        if tones and pc in tones:
            letter, acc = tones[pc]
        elif kobj:
            letter, acc = kobj.spell_pc(pc)
        else:
            letter, acc = default_root(pc, "note", pref)
        out.append(spelled_with_octave(n, letter, acc))
    return out


def voice(root_pc, template, base=48, omit=()):
    """Root-position closed voicing (tensions up an octave), skipping omits."""
    notes = []
    for e in template["intervals"]:
        if e["i"] in omit:
            continue
        semis = IV[e["i"]][1] + (12 if e["i"] in TENSION else 0)
        notes.append(base + root_pc + semis)
    return notes


# ------------------------------------------------------------------- emitters

spelling, naming, roman = [], [], []
ids = {"sp": count(1), "nm": count(1), "rn": count(1)}


def add_sp(notes, key=None, pref=None, why=None, expect=None):
    v = {"id": f"sp-{next(ids['sp']):03d}", "notes": sorted(set(notes)),
         "key": key,
         "expect": expect or spellings_for(notes, key, pref or "auto")}
    if pref:
        v["accidental_pref"] = pref
    if why:
        v["why"] = why
    spelling.append(v)


def add_nm(notes, key=None, expect_top=None, alternates=None, why=None,
           pref=None):
    v = {"id": f"nm-{next(ids['nm']):03d}", "notes": sorted(set(notes)),
         "key": key,
         "expect_top": expect_top if expect_top is not None
         else top_name(notes, key, pref or "auto")[0]}
    if alternates:
        v["expect_alternates_include"] = alternates
    if pref:
        v["accidental_pref"] = pref
    if why:
        v["why"] = why
    naming.append(v)


def add_rn(notes, key, expect, convention="textbook", why=None):
    v = {"id": f"rn-{next(ids['rn']):03d}", "notes": sorted(set(notes)),
         "key": key, "convention": convention, "expect": expect}
    if why:
        v["why"] = why
    roman.append(v)


T = {t["id"]: t for t in CHORDS}

# --- spelling: every pc as a single note in 9 keys (diatonic + chromatic rule)
for keyname in ["C", "G", "F", "B", "Db", "F#", "Am", "Ebm", "Bbm"]:
    for pc in range(12):
        add_sp([60 + pc], key=keyname)

# --- spelling: triads + sevenths standalone on all 12 roots (default tables)
for tid in ["maj", "min", "dim", "aug", "maj7", "7", "m7", "m7b5", "dim7",
            "mmaj7", "7s5", "6"]:
    for r in range(12):
        add_sp(voice(r, T[tid]))

# --- spelling: chord interpretation beats the key (ChordieApp defect class)
add_sp(voice(4, T["maj"]), key="C",
       why="E major triad in C key spells G#, never Ab (PLAN §1.3)")
add_sp(voice(4, T["7"]), key="Am", why="V7 of Am: E G# B D")
add_sp(voice(8, T["maj"]), key="C", why="bVI in C: Ab C Eb")
add_sp(voice(1, T["dim7"]), key="C", why="C#dim7 = C# E G Bb (corrected PLAN §3.2 example)")
add_sp(voice(3, T["dim7"]), key="Ebm",
       why="Ebdim7 in Ebm = Eb Gb Bbb Dbb, double flats by interval rule")
add_sp(voice(11, T["7"]), key="Ebm",
       why="pc11 dominant in Ebm spells Cb7: Cb Eb Gb Bbb (chord-aware root)")
add_sp(voice(6, T["7"]), key="B", why="F#7 in B: A# not Bb")
add_sp(voice(10, T["min"]), key="Db", why="Bbm in Db")
add_sp(voice(1, T["maj"]), key="Ebm", why="bVII of Ebm major triad: Db F Ab")
for keyname, r, tid in [("G", 9, "7"), ("F", 7, "7"), ("Db", 3, "m7"),
                        ("F#", 8, "m7"), ("Bbm", 5, "7"), ("Am", 2, "m6"),
                        ("B", 1, "m7"), ("Eb", 5, "m9"), ("C", 2, "9"),
                        ("Ebm", 11, "7")]:
    add_sp(voice(r, T[tid]), key=keyname)

# --- spelling: accidental preference override (no key)
for pref in ("sharps", "flats"):
    add_sp([61, 63, 66, 68, 70], pref=pref, why="bare black keys, pref=" + pref)
    add_sp(voice(6, T["maj"]), pref=pref)
    add_sp(voice(1, T["min"]), pref=pref)

# --- naming: every template, root position, roots C/Eb/F#/A
for t in CHORDS:
    for r in (0, 3, 6, 9):
        add_nm(voice(r, t))

# --- naming: the big five on all 12 roots
for tid in ["maj", "min", "7", "m7", "maj7"]:
    for r in range(12):
        add_nm(voice(r, T[tid]))

# --- naming: omission variants (drop the opt 5th -> "(no5)" etc.)
for tid in ["7", "maj7", "m7", "9", "13", "m11", "69"]:
    for r in (0, 5):
        add_nm(voice(r, T[tid], omit=("P5",)))

# --- naming: inversions of triads and sevenths
for tid, invs in [("maj", ["M3", "P5"]), ("min", ["m3", "P5"]),
                  ("7", ["M3", "P5", "m7"]), ("m7", ["m3", "P5", "m7"]),
                  ("maj7", ["M3", "P5", "M7"]), ("dim", ["m3", "d5"])]:
    for r in (0, 2, 7):
        for bass_iv in invs:
            notes = voice(r, T[tid], base=60)
            semis = IV[bass_iv][1]
            bass = 48 + (r + semis) % 12
            add_nm([bass] + notes)

# --- naming: tension in the bass (slash, no inversion number)
add_nm([50, 60, 64, 67], expect_top="D9sus4",
       alternates=["Cadd9/D", "D11"],
       why="bass-as-root 9sus4 outweighs add9 over a 9th bass; slash reading stays an alternate")
add_nm([45, 48, 52, 58, 62], expect_top="C13/A",
       why="13th in bass: slash only, 5th absent silently")
add_nm([48, 58, 62, 65], expect_top="C9sus4", alternates=["C11"],
       why="same pc set: 9sus4 outweighs 11 (spec pc-set collision)")

# --- naming: sus2/sus4 sevenths and the slash-bass fallback (§3.4)
add_nm([54, 65, 68, 73], key="Db", expect_top="Gbmaj7sus2",
       why="Gb F Ab Db: maj7sus2, not a cluster (user report)")
add_nm(voice(0, T["7sus2"]), expect_top="C7sus2",
       alternates=["Bb6/9/C"],
       why="7sus2 with root in bass outweighs the rootless 6/9 rotation")
add_nm(voice(0, T["maj7sus4"]), expect_top="Cmaj7sus4")
add_nm([49, 60, 64, 67], expect_top="C/Db",
       why="non-tone bass under a plain triad: slash-bass fallback, not cluster")
add_nm([53, 64, 68, 71], expect_top="E/F",
       why="classic E-over-F non-tone bass")
add_nm([41, 48, 51, 55, 57, 60, 63], key="Db", expect_top="F9",
       alternates=["Cm6/F", "Am7b5/F"],
       why="slash-bass readings rank as alternates under the exact F9 match")
add_nm([48, 55, 58], expect_top="C7(no3)",
       why="root-5th-b7 shell voicing reads as a third-less dominant (user report)")
add_nm([48, 55, 59], expect_top="Cmaj7(no3)",
       why="root-5th-maj7 shell voicing")
add_rn([49, 60, 64, 67], "C", None,
       why="slash-bass fallback carries no RN (§3.4)")
add_sp([49, 60, 64, 67],
       why="slash-bass: upper tones by chord rule (§5.1), bass by default table")

# --- naming: dyads and single notes (hand-formatted, spec §2)
DYAD = {1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4", 6: "TT", 7: "P5",
        8: "m6", 9: "M6", 10: "m7", 11: "M7", 12: "P8"}
for semis, ivn in DYAD.items():
    lower, upper = 60, 60 + semis
    lo = default_root(0, "note")
    up = default_root(upper % 12, "note")
    text = f"{sp_str(*lo)}·{sp_str(*up)} ({ivn})"
    if ivn == "P5":
        add_nm([lower, upper], expect_top="C5", alternates=[text])
    else:
        add_nm([lower, upper], expect_top=text)
for pc in range(12):
    lt, acc = default_root(pc, "note")
    add_nm([60 + pc], expect_top=sp_str(lt, acc))
add_nm([61], pref="sharps", expect_top="C#")
add_nm([63], pref="flats", expect_top="Eb")

# --- naming: ranking behavior (rotation ambiguities resolved by the bass)
add_nm([48, 52, 55, 57], expect_top="C6", alternates=["Am7/C"],
       why="6 vs relative m7: bass decides")
add_nm([45, 48, 52, 55], expect_top="Am7", alternates=["C6/A"])
add_nm([48, 51, 55, 57], expect_top="Cm6", alternates=["Am7b5/C"])
add_nm([45, 48, 51, 55], expect_top="Am7b5", alternates=["Cm6/A"])
add_nm([48, 50, 55], expect_top="Csus2", alternates=["Gsus4/C"])
add_nm([43, 48, 50], expect_top="Gsus4", alternates=["Csus2/G"])
add_nm([48, 52, 56], expect_top="Caug", alternates=["Eaug/B#", "Abaug/C"],
       why="symmetric aug: all three roots are alternates; Eaug spells its A5 as B# by interval rule")
add_nm([48, 51, 54, 57], expect_top="Cdim7",
       alternates=["D#dim7/C", "F#dim7/C", "Adim7/C"])
add_nm([48, 52, 55, 58, 63], expect_top="C7(#9)",
       why="Hendrix chord: #9 beats b3 reading (no m-template fits E natural)")
add_nm([48, 52, 56, 58, 63], expect_top="C7(#5#9)",
       alternates=["C7(#5#9)"], why="PLAN §3.2 flagship example")
add_nm([36, 48, 52, 55, 58], expect_top="C7",
       why="doubled root collapses to one pc")

# --- naming: key context steers ranking
add_nm([50, 53, 57, 60], key="C", expect_top="Dm7",
       why="diatonic bonus keeps ii7 on top in C")
add_nm([50, 55, 59, 65], key="C", expect_top="G7/D",
       why="V7 second inversion in C")
add_nm([48, 53, 56], key="C", expect_top="Fm/C", why="borrowed iv in C, 2nd inv")

# --- naming: polychords, quartal, cluster fallback
add_nm([48, 52, 55, 66, 70, 73], expect_top="F#|C",
       why="Petrushka chord: disjoint triads, no tertian exact match -> polychord tops cluster")
add_nm([48, 52, 55, 61, 65, 68], expect_top="Db|C",
       why="Petrushka-style clash: polychord is the only name")
add_nm([48, 52, 55, 62, 66, 69], expect_top="D11/C", alternates=["D|C"],
       why="triads a whole step apart also read as an 11 chord; polychord stays an alternate")
add_nm([48, 53, 58], expect_top="C7sus4(no5)", alternates=["C quartal(3)"],
       why="stack of two P4s also reads as 7sus4 no5")
add_nm([48, 53, 58, 63], alternates=["C quartal(4)"],
       why="three stacked P4s: quartal alternate must appear")
add_nm([48, 49, 50], expect_top="C·Db·D", why="cluster fallback")
add_nm([60, 61, 62, 63], expect_top="C·Db·D·Eb")
add_nm([48, 49, 50], key="B", expect_top="B#·C#·D",
       why="cluster spelling follows the key rule (B major spells pc0 as B#, cf. sp-061)")

# --- roman: diatonic triads + sevenths, four major keys
MAJ_TRIADS = [("maj", "I"), ("min", "ii"), ("min", "iii"), ("maj", "IV"),
              ("maj", "V"), ("min", "vi"), ("dim", "vii°")]
MAJ_SEVENTHS = [("maj7", "Imaj7"), ("m7", "ii7"), ("m7", "iii7"),
                ("maj7", "IVmaj7"), ("7", "V7"), ("m7", "vi7"),
                ("m7b5", "viiø7")]
QUAL_TRIADS = ["I", "IIm", "IIIm", "IV", "V", "VIm", "VII°"]
QUAL_SEVENTHS = ["Imaj7", "IIm7", "IIIm7", "IVmaj7", "V7", "VIm7", "VIIm7b5"]
for keyname in ["C", "G", "Eb", "B"]:
    k = ALL_KEYS[keyname]
    for deg in range(7):
        root_pc = sp_pc(*k.degrees[deg])
        tid, rn = MAJ_TRIADS[deg]
        add_rn(voice(root_pc, T[tid]), keyname, rn)
        tid7, rn7 = MAJ_SEVENTHS[deg]
        add_rn(voice(root_pc, T[tid7]), keyname, rn7)
for deg in range(7):
    k = ALL_KEYS["C"]
    root_pc = sp_pc(*k.degrees[deg])
    add_rn(voice(root_pc, T[MAJ_TRIADS[deg][0]]), "C", QUAL_TRIADS[deg],
           convention="quality")
    add_rn(voice(root_pc, T[MAJ_SEVENTHS[deg][0]]), "C", QUAL_SEVENTHS[deg],
           convention="quality")

# --- roman: minor keys (harmonic frame: V and vii° from raised 7th)
MIN_TRIADS = [("min", "i", 0), ("dim", "ii°", 2), ("maj", "III", 3),
              ("min", "iv", 5), ("maj", "V", 7), ("maj", "VI", 8),
              ("dim", "vii°", 11)]
for keyname in ["Am", "Cm", "F#m"]:
    tonic_pc = sp_pc(*ALL_KEYS[keyname].tonic)
    for tid, rn, off in MIN_TRIADS:
        add_rn(voice((tonic_pc + off) % 12, T[tid]), keyname, rn)
for tid, rn, off in [("m7", "i7", 0), ("m7b5", "iiø7", 2),
                     ("maj7", "IIImaj7", 3), ("m7", "iv7", 5),
                     ("7", "V7", 7), ("maj7", "VImaj7", 8),
                     ("dim7", "vii°7", 11)]:
    add_rn(voice((9 + off) % 12, T[tid]), "Am", rn)
add_rn(voice(7, T["maj"]), "Am", "VII",
       why="G major in Am: natural-minor subtonic degree, no prefix")
add_rn(voice(7, T["7"]), "Am", "VII7")

# --- roman: inversions with figures (key of C)
add_rn([52, 60, 67], "C", "I6")
add_rn([55, 60, 64], "C", "I64")
add_rn([59, 62, 65, 67], "C", "V65")
add_rn([50, 55, 59, 65], "C", "V43")
add_rn([53, 55, 59, 62], "C", "V42")
add_rn([57, 60, 65], "C", "IV6")
add_rn([48, 50, 53, 57], "C", "ii42")
add_rn([52, 60, 67], "C", "I6", convention="quality")
add_rn([59, 62, 65, 67], "C", "V65", convention="quality")

# --- roman: secondary dominants and leading-tone chords (key of C)
add_rn(voice(2, T["7"]), "C", "V7/V", why="D7 in C, never II7")
add_rn(voice(2, T["maj"]), "C", "V/V")
add_rn(voice(9, T["7"]), "C", "V7/ii")
add_rn(voice(4, T["7"]), "C", "V7/vi")
add_rn(voice(11, T["7"]), "C", "V7/iii")
add_rn(voice(0, T["7"]), "C", "V7/IV",
       why="C7 = I with m7 -> secondary wins over borrowed reading")
add_rn([54, 60, 62, 69], "C", "V65/V", why="D7/F# in C")
add_rn(voice(6, T["dim7"]), "C", "vii°7/V")
add_rn(voice(1, T["dim7"]), "C", "vii°7/ii")
add_rn(voice(8, T["dim7"]), "C", "vii°7/vi")
add_rn(voice(6, T["m7b5"]), "C", "viiø7/V")
add_rn(voice(2, T["7"]), "C", "V7/V", convention="quality")
add_rn(voice(9, T["7"]), "G", "V7/V", why="A7 in G")
add_rn(voice(7, T["7"]), "F", "V7/V", why="G7 in F")
add_rn(voice(0, T["7"]), "F", "V7",
       why="C7 in F is plain diatonic V7, not secondary")

# --- roman: borrowed / chromatic (key of C)
add_rn(voice(5, T["min"]), "C", "iv", why="borrowed iv")
add_rn(voice(0, T["min"]), "C", "i", why="parallel-minor tonic")
add_rn(voice(8, T["maj"]), "C", "bVI")
add_rn(voice(10, T["maj"]), "C", "bVII")
add_rn(voice(3, T["maj"]), "C", "bIII")
add_rn(voice(10, T["7"]), "C", "bVII7")
add_rn(voice(8, T["maj7"]), "C", "bVImaj7")
add_rn([53, 61, 65, 68], "C", "bII6", why="Neapolitan: Db/F")
add_rn(voice(1, T["maj"]), "C", "bII")
add_rn(voice(5, T["min"]), "C", "IVm", convention="quality")
add_rn(voice(10, T["maj"]), "C", "bVII", convention="quality")
add_rn(voice(7, T["9"]), "C", "V9", why="extended keeps symbol tail")
add_rn(voice(2, T["m11"]), "C", "ii11")

# --- roman: None cases
add_rn([60, 64], "C", None, why="dyad: no RN")
add_rn([60], "C", None)
add_rn([60, 61, 62], "C", None, why="cluster: no RN")

# ---------------------------------------------------------------------- write


def dump(name, vecs):
    with open(os.path.join(HERE, name), "w") as f:
        json.dump(vecs, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{name}: {len(vecs)}")


dump("spelling.json", spelling)
dump("naming.json", naming)
dump("roman.json", roman)
assert len(spelling) >= 200, len(spelling)
assert len(naming) >= 300, len(naming)
assert len(roman) >= 100, len(roman)
print("counts OK (>=200/300/100)")
