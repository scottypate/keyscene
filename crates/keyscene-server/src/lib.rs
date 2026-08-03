//! keyscene-server: the OBS overlay server.
//!
//! Requirements (PLAN.md §3.5): serves the overlay SPA + WebSocket event
//! stream on 127.0.0.1 only. Multiple simultaneous overlay pages with
//! different configs. Design leaves room for a token later; no auth in v1.

use std::net::{IpAddr, Ipv4Addr};

/// The overlay server must never bind to anything but loopback.
pub const BIND_ADDR: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
