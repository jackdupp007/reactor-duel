# Reactor Duel

A casual ship-to-ship battle game where you don't fly the ship: you run its reactor, moving power between shields, weapons and engines.

## Install on Android

1. On your phone, open this repo's **Releases** page and download `reactor-duel.apk` from the latest release.
2. Open the downloaded file. If Android asks, allow your browser or Files app to install unknown apps.
3. New builds install over the old one.

## How builds work

Every push to `main` runs the **Build Android app** workflow, which builds the app on GitHub's servers and attaches `reactor-duel.apk` to the `latest` release.

## Project layout

- `www/` is the game itself: `index.html`, Three.js in `lib/`, fonts in `fonts/`, and ship models in `models/`.
- `android/` is the Capacitor Android wrapper (landscape, full screen).
- `android/app/reactor-duel.keystore` is the signing key for this personal build, kept in the repo so every build can update the last one.
