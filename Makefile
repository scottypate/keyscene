# Developer entry points. The real work lives in cargo and the npm
# workspace under ui/ — these targets just remember the incantations
# (see "Building from source" in README.md).

.PHONY: help dev run test test-rust test-ui test-wasm lint check build build-ui setup clean

# Pinned by ui/package-lock.json; also works in CI where cargo-tauri
# isn't installed.
TAURI = ../../ui/node_modules/.bin/tauri

help:
	@echo "make dev       run the app locally (vite on :1420 + tauri dev, hot-reloading UI)"
	@echo "make test      full local test harness (Rust workspace + UI typecheck & unit tests)"
	@echo "make check     typecheck everything without running tests"
	@echo "make lint      rustfmt --check + clippy -D warnings"
	@echo "make test-wasm engine tests on wasm32-wasip1 (needs wasmtime)"
	@echo "make build     production installers (.dmg / .msi / NSIS) via tauri build"
	@echo "make build-ui  build ui/studio/dist (embedded in the app at compile time)"
	@echo "make setup     install UI dependencies (npm ci)"
	@echo "make clean     remove build artifacts and node_modules"

# Hot-reloading local run: vite serves the UI, the Tauri shell opens a
# window against it. Vite is cleaned up when tauri dev exits; Ctrl-C
# stops both. `exec` makes $! the vite process itself, not a wrapper
# shell the kill would miss.
dev: ui/node_modules
	@(cd ui/studio && exec ../node_modules/.bin/vite) & VITE=$$!; \
	cd crates/keyscene-app && $(TAURI) dev; \
	kill $$VITE 2>/dev/null || true

run: dev

test: test-rust test-ui

# cargo test compiles keyscene-app, which embeds ui/studio/dist —
# the UI must exist first.
test-rust: build-ui
	cargo test --workspace

test-ui: ui/node_modules
	cd ui && npm run check && npm test

# WASM parity: the engine passes the identical suite on wasm32-wasip1
# (runner configured in .cargo/config.toml; needs wasmtime).
test-wasm:
	cargo test -p keyscene-core --target wasm32-wasip1

# clippy/check compile keyscene-app too, so they need the UI dist
# just like test-rust does.
lint: build-ui
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings

check: build-ui
	cargo check --workspace
	cd ui && npm run check

build-ui: ui/node_modules
	cd ui && npm run build

# The app embeds ui/studio/dist at compile time; tauri.conf.json's
# beforeBuildCommand builds the UI first.
build: ui/node_modules
	cd crates/keyscene-app && $(TAURI) build

setup: ui/node_modules

ui/node_modules: ui/package-lock.json
	cd ui && npm ci
	touch ui/node_modules

clean:
	cargo clean
	rm -rf ui/node_modules ui/studio/dist
