# Runes

Control your Mac with your Meta Neural Band. Turn finger gestures, holds, and wrist movements into keyboard shortcuts, app actions, and gesture combos.

![Runes desktop app](docs/desktop-demo.png)

## Download and install

**[Download Runes for Mac](https://github.com/Ben-Santana/runes/releases/latest)** · [All releases](https://github.com/Ben-Santana/runes/releases)

Runes requires an **Apple Silicon Mac, macOS 13 or later**, and a compatible Meta Neural Band. Intel Macs and other operating systems are not supported. Python and the Bluetooth dependencies are included in the app.

1. Download the `.dmg` from the latest release's **Assets** section.
2. Open it and drag **Runes** into **Applications**.
3. Launch Runes from Applications. Current builds are ad-hoc signed and aren't notarized by Apple. If macOS blocks opening the app, go to **System Settings → Privacy & Security → Open Anyway**.
4. Allow **Bluetooth** access when prompted, so Runes can hear from your iPhone. To send shortcuts or control the pointer, enable Runes in **System Settings → Privacy & Security → Accessibility**. You can open these settings from Device settings in the app.

Runes is an early release. Band firmware compatibility and gesture recognition still need broader hardware testing. Start with a few simple assignments and try them in an app where you can see their effect.

## Connect your iPhone

Runes on Mac receives your band's gestures from **Runes on your iPhone**. The iPhone holds the band; the Mac never connects to it directly.

1. On first launch, the Mac shows a code. Open Runes on your iPhone and scan it. Accept the Bluetooth request on iPhone if one appears.
2. That's it. Runes opens at login and runs in the menu bar, which shows **Connected to iPhone**, **iPhone not nearby**, or **Open Runes on iPhone once** (after the iPhone restarts or Runes was closed on it).

The link comes back by itself after Mac sleep, walking away, and app restarts. To add another iPhone or remove one, use **Device settings → iPhone**.

## Make it yours

- **Shortcuts and actions.** Click an assignment's keycap, hold a keyboard combination, and release to save it. You can also choose macOS actions, type text, call an API, or build an action sequence.
- **Gesture combos.** Combine gestures into a sequence to give the same fingers more jobs. Enable or disable individual assignments as you go.
- **Profiles.** Keep different assignments for different workflows, share assignments across profiles, and switch profiles from the app or a gesture.
- **Hold to adjust.** Assign a hold to a pair of actions, then rotate or move your wrist to repeat either direction. Release the hold to stop.
- **Pointer and radial menus.** Configure wrist-driven pointer movement or a radial menu for quick access to actions.
- **Cheat sheets.** Keep a profile's assignments visible while learning them.
- **Air gestures.** Add a drawn shape after a finger gesture in a combo. The finger gesture starts recording; perform the shape within its configured time window. These matches are experimental and work best with your elbow still and forearm pointing forward.

Assignments are saved locally. Shortcuts pause while editing, in Device settings, and in Device test. Accessibility permission is required for native input delivery to the foreground app.

## Inspect and troubleshoot

Open **Device settings → Open device test** to view the event and gesture inspectors and air gestures. Live EMG signals, model experiments and native handwriting need a direct band connection and are hidden for now. Snapshots export the bounded display history, rather than an entire recording session.

- **iPhone not nearby:** bring the iPhone within Bluetooth range and check Bluetooth on both. If it is nearby, open Runes on the iPhone once.
- **Connected but no gestures:** check in Runes on iPhone that the band is connected, then try index or middle taps.
- **Shortcuts don't run:** check Accessibility permission, that the assignment is enabled, and that you're outside the editor and device test views.

[Report a problem](https://github.com/Ben-Santana/runes/issues) with your macOS version, Mac model, app release, and steps to reproduce it. Don't include passwords, tokens, or private sensor captures.

## Privacy and experimental features

Band data is processed locally. Meta sign-in requires a network connection. API-call actions send requests to the endpoints you configure. Optional research models download only when you choose to install them.

Saving a Meta password is optional and off by default. If enabled, credentials are stored in macOS Keychain, separately from your band identity. Use **Forget Meta password** in Device settings to remove them.

Device test includes experimental air gesture, native handwriting, and research hand-pose/handwriting tools. Firmware support varies; native handwriting is refused on unsupported firmware. The research checkpoints were trained for sixteen EMG channels while this band exposes eight, so their outputs aren't validated for controlling other apps. Optional research checkpoints have noncommercial licenses and may require macOS 14 or later.

See the [technical and experiment guide](docs/technical-guide.md) for compatibility limits, model licenses, sensor formats, recovery behavior, and detailed verification notes.

## Develop

Install Node.js 22, Python 3.12, and Google Chrome (used to generate the app icon). For a distributable Python runtime, use [uv](https://docs.astral.sh/uv/).

```sh
npm ci
uv python install 3.12
uv venv --python 3.12 --managed-python .venv
uv pip install --python .venv/bin/python -r python/requirements.txt
npm run desktop
```

`npm run dev` starts a browser demo at `http://127.0.0.1:5190`; Bluetooth requires Electron. `BAND_PYTHON` overrides the development Python executable.

```sh
npm run build
npm run test:python
npm run test:air:math
npm run package:mac
```

The package command creates `release/Runes-<version>-arm64.dmg` with a bundled Python runtime. Build on an Apple Silicon Mac. Browser smoke scripts and hardware-specific checks are documented in the [technical guide](docs/technical-guide.md).

## Automatic releases

Every push to `main` runs the [macOS release workflow](.github/workflows/release-macos.yml): it installs dependencies, builds the app, runs Python and air-gesture math tests, packages and checks the bundled runtime, and publishes the DMG plus a SHA-256 checksum to GitHub Releases. Failed checks prevent publication.

Each release has a unique tag such as `v0.1.0-build.12` and keeps its own download. The most recently published release is available through the Download link above. The same files are also retained as workflow artifacts for 30 days. Use the workflow's **Run workflow** button on `main` to rebuild manually. Re-running a completed run replaces that run's release assets.

These are automatically published early builds, not Apple-notarized releases. No signing secrets are required for the current ad-hoc builds. Installing a newer version is manual: download its DMG, quit Runes, and replace the app in Applications.

## iPhone link internals

The link is a native helper (`native/phone-link`, built to `dist-electron/runes-phone-link` by `npm run build`) started by the Python bridge, which feeds its events into the same shortcut engine the band transport used. The protocol and pairing code are shared with the iPhone app; `scripts/sync-relay-wire.sh` copies them from `../runes_ios` and `npm run test:phone-link` fails if they drift. Design, packet format, safety rules and the hardware checklist: `RunesIOS/Documentation/MacLink.md`.

The direct band connection (`meta_neural_py`, enrollment, identity handoff) remains in `python/bridge.py` for development only. It is off unless `RUNES_DIRECT_BAND=1`, and the UI no longer exposes it.

Checks: `npm run test:python`, `npm run test:phone-link`, and with a preview running (`npx vite preview --port 5190`), `npm run test:connection`. The UI checks mock the bridge; hardware behavior needs the checklist.

## Signing and Accessibility

Ad-hoc signed builds get a new code identity on every update, so macOS forgets the Accessibility permission (and may ask again for Keychain access to the iPhone pairing). The fix is Developer ID signing plus notarization:

1. Enroll in the Apple Developer Program and create a **Developer ID Application** certificate.
2. Sign with the hardened runtime: `codesign --force --options runtime --timestamp --entitlements <entitlements.plist> --sign "Developer ID Application: …"`, signing nested binaries (`runes-phone-link`, the Python runtime's `.so`/`.dylib` files) before the app. The bundled Python needs `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation`.
3. Notarize and staple: `xcrun notarytool submit Runes.dmg --keychain-profile runes --wait`, then `xcrun stapler staple`.
4. In CI, import the certificate from an encrypted secret into a temporary keychain and store the notary API key as a secret.

With a stable Team ID, Accessibility and Keychain grants survive updates, and Gatekeeper no longer needs **Open Anyway**.
