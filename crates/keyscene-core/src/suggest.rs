//! Assistive key suggestion via Krumhansl–Kessler profiles (spec §6).
//! Suggestion only — the user confirms; manual selection always wins.

use crate::key::{Key, KEY_NAMES};

const KK_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KK_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/// Correlate weighted pc input against all 24 keys; top 3, deterministic.
pub fn suggest_keys(pc_weights: &[f32; 12]) -> Vec<(Key, f32)> {
    let mut scored: Vec<(usize, Key, f32)> = KEY_NAMES
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let key = Key::from_name(name).unwrap();
            let profile = if i < 12 { &KK_MAJOR } else { &KK_MINOR };
            let tonic = key.tonic.pc() as usize;
            let rotated: Vec<f32> = (0..12).map(|j| profile[(j + 12 - tonic) % 12]).collect();
            (i, key, pearson(pc_weights, &rotated))
        })
        .collect();
    // score desc; ties: majors before minors, then tonic pc asc — the
    // KEY_NAMES index encodes exactly that order for our layout
    scored.sort_by(|a, b| {
        b.2.partial_cmp(&a.2)
            .unwrap_or(core::cmp::Ordering::Equal)
            .then_with(|| {
                let rank = |i: usize, k: &Key| (i >= 12, k.tonic.pc());
                rank(a.0, &a.1).cmp(&rank(b.0, &b.1))
            })
    });
    scored.into_iter().take(3).map(|(_, k, s)| (k, s)).collect()
}

fn pearson(x: &[f32; 12], y: &[f32]) -> f32 {
    let n = 12.0f32;
    let mx = x.iter().sum::<f32>() / n;
    let my = y.iter().sum::<f32>() / n;
    let mut num = 0.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    for i in 0..12 {
        num += (x[i] - mx) * (y[i] - my);
        dx += (x[i] - mx).powi(2);
        dy += (y[i] - my).powi(2);
    }
    if dx == 0.0 || dy == 0.0 {
        return 0.0;
    }
    num / (dx * dy).sqrt()
}
