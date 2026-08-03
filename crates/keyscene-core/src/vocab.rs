//! Chord vocabulary, embedded from data/chords.json (spec §3, PLAN §3.2:
//! definitions live in data files inside the binary, never fetched).

use crate::pitch::{is_tension, ivl, Ivl};
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct RawFile {
    templates: Vec<RawTemplate>,
}

#[derive(Deserialize)]
struct RawTemplate {
    id: String,
    symbol: String,
    weight: i32,
    intervals: Vec<RawIv>,
}

#[derive(Deserialize)]
struct RawIv {
    i: String,
    #[serde(default)]
    opt: bool,
    #[serde(default)]
    suf: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Maj,
    Min,
    Dim,
}

#[derive(Debug)]
pub struct Entry {
    pub name: String,
    pub ivl: Ivl,
    pub opt: bool,
    pub suf: String,
    pub tension: bool,
}

#[derive(Debug)]
pub struct Template {
    pub id: String,
    pub symbol: String,
    pub weight: i32,
    pub entries: Vec<Entry>,
    pub required_mask: u16,
    pub full_mask: u16,
    pub family: Family,
    pub has_m3: bool,
}

static VOCAB: OnceLock<Vec<Template>> = OnceLock::new();

pub fn vocab() -> &'static [Template] {
    VOCAB.get_or_init(|| {
        let raw: RawFile = serde_json::from_str(include_str!("../data/chords.json"))
            .expect("data/chords.json is invalid");
        raw.templates.into_iter().map(build).collect()
    })
}

fn build(raw: RawTemplate) -> Template {
    let entries: Vec<Entry> = raw
        .intervals
        .into_iter()
        .map(|e| {
            let iv = ivl(&e.i).unwrap_or_else(|| panic!("unknown interval {}", e.i));
            Entry {
                tension: is_tension(&e.i),
                name: e.i,
                ivl: iv,
                opt: e.opt,
                suf: e.suf,
            }
        })
        .collect();
    let mut required_mask = 0u16;
    let mut full_mask = 0u16;
    let mut has_m3 = false;
    let mut has_p5 = false;
    let mut has_d5 = false;
    for e in &entries {
        full_mask |= 1 << (e.ivl.semis % 12);
        if !e.opt {
            required_mask |= 1 << (e.ivl.semis % 12);
        }
        match e.name.as_str() {
            "m3" => has_m3 = true,
            "P5" => has_p5 = true,
            "d5" => has_d5 = true,
            _ => {}
        }
    }
    let family = if has_m3 && has_d5 && !has_p5 {
        Family::Dim
    } else if has_m3 {
        Family::Min
    } else {
        Family::Maj
    };
    Template {
        id: raw.id,
        symbol: raw.symbol,
        weight: raw.weight,
        entries,
        required_mask,
        full_mask,
        family,
        has_m3,
    }
}

impl Template {
    pub fn has_interval(&self, name: &str) -> bool {
        self.entries.iter().any(|e| e.name == name)
    }
}
