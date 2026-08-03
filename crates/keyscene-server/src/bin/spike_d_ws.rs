//! Spike D (PLAN.md Phase 0): axum WebSocket page updating at 60Hz from a
//! Rust tick loop — the skeleton of the OBS overlay server (§3.5).
//!
//! Run: `cargo run -p keyscene-server --bin spike_d_ws [port]`
//! Then open http://127.0.0.1:43117/ — the page shows a live 88-key strip
//! driven by the tick stream plus measured rate/jitter stats
//! (`window.__spikeStats` for headless verification).

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use tokio::sync::broadcast;

const TICK: Duration = Duration::from_micros(16_667); // 60 Hz

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(43117);
    let (tx, _) = broadcast::channel::<String>(256);
    tokio::spawn(tick_loop(tx.clone()));

    let app = Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("spike_d_overlay.html")) }),
        )
        .route("/ws", get(ws_upgrade))
        .with_state(tx);

    // Loopback only — never expose the overlay server on the network (§3.5).
    let addr = SocketAddr::new(keyscene_server::BIND_ADDR, port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind loopback");
    println!("spike-d: overlay page at http://{addr}/");
    axum::serve(listener, app).await.expect("serve");
}

/// The Rust-side 60Hz heartbeat. `Skip` on missed ticks: for a live overlay
/// a late frame is worthless — drop it rather than burst to catch up.
async fn tick_loop(tx: broadcast::Sender<String>) {
    let mut interval = tokio::time::interval(TICK);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let start = Instant::now();
    let mut seq: u64 = 0;
    loop {
        interval.tick().await;
        let _ = tx.send(format!(
            "{{\"seq\":{seq},\"t_us\":{}}}",
            start.elapsed().as_micros()
        ));
        seq += 1;
    }
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(tx): State<broadcast::Sender<String>>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| client(socket, tx.subscribe()))
}

async fn client(mut socket: WebSocket, mut rx: broadcast::Receiver<String>) {
    loop {
        match rx.recv().await {
            Ok(msg) => {
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    return; // client went away
                }
            }
            // Slow client skipped some ticks; keep streaming from live edge.
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}
