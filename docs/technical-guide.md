# Neural technical and experiment guide

A local Electron instrument for Meta Neural Band data. React + TypeScript + Tailwind,
with an isolated Python bridge using `meta-neural-py==0.1.0a1`.

## Run

```sh
npm install
python3.12 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
npm run desktop
```

Or create the Python environment with `uv venv --python 3.12 .venv` and
`uv pip install --python .venv/bin/python -r python/requirements.txt`.
Set `BAND_PYTHON` to override the Python executable.

`npm run dev` opens the browser preview at http://127.0.0.1:5190. Use **Explore demo**
to inspect simulated streams. Bluetooth requires the Electron app.
`npm run build && npm start` runs the compiled production interface in Electron.
Run `npm run package:mac` on Apple Silicon to create `release/Neural-0.1.0-arm64.dmg`.
The app bundles Python and its dependencies. Drag Neural to Applications. This local
build is ad-hoc signed and is not notarized; if blocked, allow it in System Settings
→ Privacy & Security → Open Anyway. Requires macOS 13 or later on Apple Silicon.

## Connect

1. Put the band into pairing mode and choose **Connect band → Scan for bands**.
2. Select the intended device. Use **Connect with saved identity** if already enrolled.
3. For a new identity, expand **First time with this band?** and explicitly enroll.
   Enrollment opens Meta sign-in and changes ownership. The optional missing-key
   compatibility checkbox defaults off; sessions using it show unverified proof.
4. macOS may request Bluetooth access. Live transport requires macOS and compatible
   hardware. The package is experimental and its hardware validation is limited.

## Data

- Eight unsigned 16-bit ADC EMG channels: 2,048 samples/s, 16 samples/batch.
- Gyroscope values in wire units; orientation in wire order w,x,y,z. Axes and
  physical unit conversion are uncalibrated. The right-hand visual applies normalized w,x,y,z quaternions directly around the wrist, with +X toward the fingers, +Y toward the thumb and +Z toward the back of the hand. Hold the hand flat with fingers forward and use Center hand to set a neutral wrist frame; subsequent rotations use inverse(neutral) × current, then map sensor Y to hand X and sensor X to hand −Y, preserving yaw about Z. Physical sensor mounting axes still require hardware verification. Motion uses visual traces without numerical readouts.
- Gestures preserve raw enum codes, derived actions, and synthetic flags.
- Device info, battery, hand, band-proof status, discontinuities, queue counters.
- Event inspector keeps the latest 100 packets; charts keep 2,048 samples/channel.
  Pausing freezes the display only; acquisition continues.
- JSON snapshots export the current bounded display history, not a full session.
- Host monotonic timestamps and distinct device clock domains remain separate.
  Queue drops are local; device packet-loss measurement is not validated.

## Checks

```sh
npm run build
.venv/bin/python -m unittest discover -s tests
```

The Python tests use real package model types and verify serialization
and cancellation cleanup without touching Bluetooth or enrollment.

## Design

White ground, ink traces, locally bundled Geist, quiet outlines and an interactive
isometric electrode figure. `band.js` is the figure source; `public/hairline/kernel.js`
is the unchanged Hairline kernel. `hairline-band.html` is a standalone bench with
intensity, theme and tour controls. The app mounts the same figure in a compact host.
See [design notes](design.md) for the composition and data decisions.

Browser smoke check (with Google Chrome installed and the dev server running):
`npm run test:ui`. Set `TEST_ELECTRON=1` to also check production Electron startup,
sandboxed preload and Python bridge readiness; build first. `CHROME_PATH` can override
Chrome's location and `PREVIEW_URL` can override the default local preview URL.


The dedicated **Gesture inspector** retains the latest 200 gesture events independently
of the general sensor buffer, with finger/action filters, a finger highlight, and full packet details.

Gesture rows now distinguish **Raw gesture**, **Derived interaction**, and **Both layers**.
A derived-only packet uses its derived label instead of displaying its raw `unknown` field.
Press → button down → hold recognized and release → button up → hold ended are separate
stages; a directional gesture can also have a derived direction event. Each selected event
explains its role, and the Layer filter isolates raw or derived packets. Original fields,
codes, timestamps, and synthetic flags remain unchanged.

### Motion shortcuts (macOS)

The home screen assigns six motions to keyboard shortcuts. Click a keycap and press a keyboard combination to assign it inline. Hold the keys together; the full combination saves when you release them and enables the motion. Escape or clicking outside cancels; × clears an assignment. Each row has an independent toggle. Assignments are saved locally and start empty.

In the desktop app, enable Accessibility in **Device settings → Open Accessibility settings**, then connect your band. The native Python helper sends the assigned key combination to the foreground app. Shortcuts pause while editing, in Device settings, and in Device test. Demo mode only previews data and never sends keyboard events.

**Device test** is at the bottom of Device settings and contains Live signals, Event inspector, and Gesture inspector.

Tap and rotate means an index tap followed within 650ms by a wrist orientation change of more than 25 degrees. Index taps wait through that window when rotation is enabled (300ms otherwise) so a double tap or rotation can replace the single tap. Raw and derived gesture layers are coalesced to avoid duplicate actions. The current key map uses macOS ANSI virtual key positions; other keyboard layouts need device validation.

Verification: `npm run build`, `npm run test:python`, `npm run test:ui`, and `node scripts/motions-smoke.mjs`.

While automatic connection is enabled, Neural scans for nearby bands. A single discovered band connects automatically using its saved identity; multiple bands open the connection picker. No bands leaves the app disconnected. Explicit manual connection, disconnect, or demo actions cancel pending startup auto-connection.

### Connection recovery and shared ownership

Connect never invokes enrollment. Missing credentials, rejected identity, trust timeout, permission failures, and protocol failures pause for explicit recovery. Transport failures retry at 1, 2, and 4 seconds, then pause. Canceling Meta sign-in also pauses the UI's automatic discovery/connect loop, persistently across launches.

Manage connection lists saved and eligible pending identities by public host fingerprint. Existing Keychain accounts are stable credential records; Bluetooth UUIDs are transport aliases. A user-selected new address is associated only after authentication. Compatibility authenticates the host without proving the band's identity, so address association remains a user-confirmed physical selection. Saved identities are the default; pending candidates never silently replace them.

Explicit ownership enrollment is separately confirmed and can invalidate the shared identity on another device. A known band public key is preserved when passed into that ceremony. Missing-key compatibility remains an expected supported mode.

Disconnect pauses automatic connection and waits for worker cleanup before reporting local closure. The target device must still prove that its Bluetooth connection, host authentication, and subscription work. This is a manual handoff, not a cross-device ownership protocol.

### Optional saved Meta password

In Device settings → App behavior, enable **Save Meta password on this Mac**, enter
both your Meta email/phone number and password, then choose **Save to Keychain**.
This is off by default. The credentials are stored in macOS Keychain under
`org.neural.meta-login.v1`, separately from your band identity, and are never written
to app preferences or Git. Use **Forget Meta password** (or switch the setting off)
to delete them. This does not remove your band identity.

During enrollment, Neural attempts password sign-in in an isolated login window.
Password filling is restricted to `https://auth.meta.com`. If automatic entry fails,
the window appears after 12 seconds so you can finish sign-in, verification or a
CAPTCHA. Credentials are attempted once per enrollment; Meta can still require
interactive verification. macOS may ask for Keychain access. Live Meta password
sign-in must be verified with your account; automated tests do not sign into Meta.

### Hold to adjust

Edit a standalone hold or a combo whose final gesture is a hold, then choose the
dial button in the action toolbar. Choose rotation or gyroscope movement on an
X/Y/Z axis, assign decrease and increase actions, and set sensitivity from 1
(fewer repeats) to 10 (more repeats). The movement and left/right shortcut keycaps stay inline in the shortcut column.
Clicking the dial opens the custom movement dropdown; hover the movement to adjust
sensitivity. Assigning both directions saves and enables a new assignment automatically;
later edits save inline. Click either direction's keycap to record keys or choose
macOS actions, API calls, or Neural profile actions from the same action toolbar.
Use the small + beside a direction to append actions into a sequence. Existing
keyboard-only adjustments remain compatible. Each movement step executes the
selected action or sequence through the regular delivery path. Adjustment is an exclusive action rather than
a step in an action sequence. Changing the combo so it no longer ends in a hold
removes its adjustment and disables it.

Complete the gesture and keep the final finger held. Signed movement accumulates
into complete shortcut presses; stationary orientation does not repeat. Release
the final hold to stop. Each hold starts from a fresh orientation. Suspension,
profile/configuration changes, disconnection, or a sensor gap over 500 ms cancel
the session. Output is limited to 20 presses/s with a maximum burst of four; excess
presses are discarded, never queued after release. Gyroscope movement integrates
uncalibrated wire values with a noise threshold; it does not measure translation.
Physical axes and sensitivity require a connected-band trial.

Verification: `node scripts/adjust-smoke.mjs` and the Python adjustment tests cover
setup, shortcut recording, persistence, invalid final gestures, repeat counts,
direction reversal, release, sensor gaps, suspension, and output limits.

### Native handwriting on the Neural Band

Open **Device settings → Open device test → Model experiments → Handwriting**,
then choose **Start handwriting**. Write a short word with your index finger on a
surface and inspect the live text. On supported firmware, this uses the consumer band's onboard model;
it does not download weights or expand eight EMG inputs to sixteen. Stop ends the
test; Clear text resets the output. A session stops automatically after two minutes.

The bridge discovers `data-collection` and `data-collection-model` by exact name,
snapshots their original values, and saves a recovery journal before changing any
settings. It verifies collection `1`, model `5`, and inference stream flags `4`,
`22`, `23`, then accepts pipeline `3` packets with 100 finite, normalized log scores.
CTC collapse and editing gestures produce text only inside the test page. Keyboard
and mouse shortcuts are blocked while testing or awaiting recovery.

Stopping, leaving the page, or disconnecting attempts to restore and verify the
original settings and handwriting stream flags. A failed restoration retains
`model-lab/native-handwriting-restore.json` under the app's user-data directory.
Reconnect the same band to retry recovery before another test. Do not delete this
journal while restoration is pending. Other sensor stream flags are preserved.
Unsupported firmware or malformed output stops the test and reports the failure.
Descriptors are queried only in the firmware's one-based `1..count` range; index
zero can disconnect this band. A read-only check of this band's 27 descriptors
found `data-collection` at 19 and `data-collection-model` at 20. Connection/read
failures are surfaced directly rather than misreported as missing settings.
After an L2CAP disconnect, use **Connect** again; an old failed session is cleared
before reconnecting.

Protocol reference: [Rokid Lumen native handwriting](https://github.com/beyondlevi/rokid-lumen/blob/main/NEURALBAND.md#handwriting)
and its MIT-licensed `model_capture.rs` / `handwriting.rs`, themselves crediting
Kinesis. Character order and consumer editing gestures remain experimental.
Verification includes recovery after a lost write acknowledgment, reconnecting
with a persisted journal, CTC/edits/gaps, stream preservation, and mocked browser
start/stop/clear. Recognition on this physical band has not yet been validated.

### Optional handwriting and hand-pose experiments

Open **Device settings → Open device test → Model experiments**, then choose
**Hand pose**, or select **Use the older research checkpoint instead** inside
**Handwriting**. The research setup has an **Install model** option that
creates a shared isolated Python environment in Electron's user-data `model-lab`
folder, downloads pinned Meta source and official pretrained checkpoints, verifies
the checkpoint archive SHA-256, and runs a CPU forward pass before marking it ready.
The Bluetooth Python environment is unchanged. Internet is required for installation;
allow around 2 GB of disk space and several minutes on the first install. These
optional dependencies are tested on Apple Silicon with Python 3.12 and macOS 26;
the pinned SciPy wheel requires macOS 14 or later. Installing them on older systems
may fail and is not validated. Cancel stops the installer and its child processes;
a failed installation can be retried. No model downloads happen at app startup.

Connect the real band, record 3–12 seconds, finish recording, then choose **Run
model**. Demo streams are excluded. EMG remains separate from the bounded display
history. Unexpected formats, delivery stalls, discontinuities and device timestamp
gaps discard the capture. Raw capture files are private and temporary, deleted when
leaving model tests or shutting down normally. Inference runs in a subprocess so
model imports and computation cannot block Bluetooth acquisition. Installation can
continue when you navigate away; active inference and capture are cancelled.

These are **experimental 16-channel checkpoint baselines, not trained eight-channel
models**. Choose repeating each channel twice or interleaving neighboring averages.
Both retain channel order, remove DC, high-pass at 40 Hz, and resample 2,048 → 2,000 Hz.
The 0.2008 µV/count conversion is an unverified estimate for this hardware. Sensor
geometry, polarity and gain have not been validated against the research wristband.
Neither mapping reconstructs the missing measurements or establishes accuracy.
Handwriting includes resting context padding, greedy CTC text decoding and optional
reference-text character error rate (including case and spaces). Hand pose uses
`regression_vemg2pose.ckpt`, requires no measured initial pose, and provides playback
of all 20 joint angles in degrees; exported angles are radians. No global hand position
or fingertip trajectory is inferred. Results can be exported as JSON.

The research handwriting protocol holds the fingers together as if holding an
imaginary pen, which differs from tracing solely with the index finger. A trained
adaptation and accuracy evaluation still require labeled data and separate recording
sessions. These pages do not train or fine-tune weights. Do not treat decoded text
or predicted articulation as validated input to other apps.

Sources: [handwriting](https://github.com/facebookresearch/generic-neuromotor-interface)
(CC BY-NC 4.0), [hand pose](https://github.com/facebookresearch/emg2pose)
(CC BY-NC-SA 4.0). The optional releases are for noncommercial research.

Verification: `node scripts/model-tests-smoke.mjs`, Python `test_model_lab` tests,
and real checkpoint installation / CPU inference in a temporary isolated environment.
Hardware recognition accuracy remains untested.

Hand-pose results now include an articulated hand view driven by the same playback
frame as the angle readouts. The inference subprocess converts predicted angles to
21 3D landmarks using Meta's UmeTrack generic hand and skinning code. Palm, oblique
and side camera views change only the rendering. The wrist stays fixed; the drawing
shows articulation rather than world position. Run the pose model again to generate
geometry for an older result; no model-weight reinstall is needed. Geometry was
checked against Meta's reference forward kinematics across eight poses.

Input-contract investigation (October 30, 2026): both research datasets contain
16-channel signed float32 EMG. The pose input convolution is `[256, 16, 11]`;
handwriting computes six bands of channel-pair features and projects 816 values to
64 features. A short official-data check found nonpositive matrix eigenvalues when
channels were repeated; the handwriting repeat mapping is now rejected in both the
UI and runtime. Interpolation remains unvalidated. The pose repeat baseline remains
available. Synthetic expansion does not establish channel location or polarity.
The handwriting test also substitutes zero-padded context for real preceding EMG;
it does not reproduce the research recording protocol in full.

The original device reverse-engineering notes and saved sensor audit agree on eight
channels, 16 samples/batch and 256-byte payloads, with ~7,812.5 µs batch spacing.
Enabling raw EMG does not request a channel subset. No alternate sixteen-channel
stream has been established. Meta's official Project Aria encoding-zero decoder
uses the same time-major little-endian uint16 packing. Its calibration implementation
supports gain/reference/bit-width-dependent conversion; our 0.2008 µV/count value
still has not been confirmed from this band's calibration parameters.
Sources: [official decoder](https://github.com/facebookresearch/projectaria_tools/blob/main/core/data_provider/players/NeuralBandBatchPlayer.cpp),
[official calibration](https://github.com/facebookresearch/projectaria_tools/blob/main/core/calibration/NeuralBandEmgCalibration.cpp),
[pose input units](https://facebookresearch.github.io/neuroai/neuralbench/tasks/emg/pose.html).

Firmware compatibility check (October 30, 2026): this physical band's setting
replies omit protobuf default-zero scalars. Its collection boolean is an empty
field-8 wrapper when false; its model selector is a uint32 in field 4, not the
newer firmware's enum in field 11. The parser accepts both verified value shapes
and requires a wrapper. Writes use the corresponding uint32 field 3 or enum
field 10. The model selector descriptor explicitly advertises range 1–4, with
current value 4; the documented consumer handwriting procedure requires model 5.
The native test now checks that range and refuses to mutate unsupported firmware.
Having settings with the expected names alone does not establish model support.

### Air gesture experiment

Open **Device settings → Open device test → Air gestures → Single gesture test**. Draw a single stroke, hold your elbow still with your hand palm down and your forearm pointing forward, and select **Center forearm**. Check the live preview: X is pitch, Y is forearm roll and Z is yaw in this neutral pose. Select **Record air gesture**, repeat the stroke, then **Finish and compare** (12 second limit).

The test rotates a unit-length forearm vector with relative orientation and projects the wrist position onto the neutral X/Z plane, with Y pointing forward. Full quaternion composition makes local pitch after a 90° roll become sideways motion; pure forearm roll does not move the estimated wrist. No acceleration integration or model download is used. Shape comparison resamples by arc length, centers and uniformly scales both strokes, then uses constrained dynamic time warping. The recorded stroke is rotated from −100° to +100° in 1° increments; the best score, rotation angle and aligned overlay are shown. Overall rotation is ignored; starting point, aspect ratio and stroke order still matter. The adjustable similarity threshold is experimental, not an accuracy probability. Elbow motion, band fit and orientation drift affect results; physical accuracy needs validation with the band. Invalid/stale streams and captures with too little motion cannot receive a score. Captures remain in memory until leaving the tab.

Run the local preview and `npm run test:air` for synthetic orientation, geometry/matching, drawing, stream interruption and responsive UI checks.

Run `npm run test:air:math` without a server to check palm-down coordinate mapping, pitch after ±90° roll, roll with a tilted forearm, and centering from a nonidentity orientation.

### Air gesture engine

The **Gesture engine** mode in Air gestures lets you draw and name multiple templates, stored locally on this Mac. Center your forearm palm down and forward, then double-tap your index finger. That starts a two-second orientation recording; additional taps during capture are ignored. The capture is compared with every saved drawing, allowing alignment from −100° to +100° in one-degree steps. The highest-scoring drawing is recognized only if its score meets the **Minimum similarity** slider; otherwise the result is **No gesture recognized**. All candidate scores and the closest aligned overlay remain visible for inspection. Interrupted streams and recordings with insufficient movement are rejected. No Mac actions are attached to these experimental matches.

Run `npm run test:air:engine` to build and test the engine in Chrome with intercepted local assets. It starts no preview server.


### Air gestures in motion assignments

Add a gesture combo, then choose **Air gesture** from a step's gesture menu. An air step must immediately follow a non-air step; it cannot start a combo or follow another air step. Choose **Draw manually** or **Use band** in the radial-style editor and set its **Minimum similarity** and **Time to perform** (0.5–10 seconds). The checkmark saves; Escape or the close button cancels. Click the shape's edit control to change it later.

The preceding gesture automatically centers the forearm and starts a fixed orientation recording. Keep your elbow still, start with your palm down and forearm forward, and perform the shape within its recording window. No separate centering is needed. Shapes preserve stroke order while allowing translation, scale and ±100° rotation, matching the device test's math. Stream gaps over 0.5 seconds, missing orientation and insufficient motion reject the recording.

Enabled candidates sharing inputs compete together. Each uses its own recording window and similarity minimum; recognition waits for the longest competing window and selects the highest qualifying score. Exact ties use the stable combo ID. Disabled previews cannot delay or take an enabled mapping. The winning step can finish a combo or continue to subsequent gestures; its assigned shortcut or action runs through the existing background engine. Shapes and settings are saved with their profile, and the live gesture viewer shows each shape.

Run `node scripts/air-feature-smoke.mjs` with the local preview running for drawing, band capture, persistence and responsive editor checks. Run `env -u PYTHONHOME .venv/bin/python -m unittest tests.test_air_gestures` for recognition, competition, validation and stream interruption checks.


Enable **Device settings → Air gesture cursor preview** to see a solid dark circle around your mouse while an enabled air gesture is being recorded. The white stroke uses the recognizer's actual recording, starts at the circle's center, and zooms out as needed while keeping that origin fixed. The initial scale is 53 logical pixels per unit of projected wrist motion. It follows the cursor across displays, never takes focus, and lets mouse clicks pass through. The preview is off by default and disappears on completion, cancellation, suspension, disconnect, or an interrupted stream. Turn it off to remove the overlay window and stop preview telemetry.

Run `node scripts/air-cursor-smoke.mjs` with the preview running for the circle, scaling, cleanup and settings checks. `node scripts/air-cursor-native-smoke.mjs` verifies the actual Electron main-process code with an isolated shell, without touching desktop windows or saved preferences.


The cursor preview is 72 logical pixels in diameter. When recognition finishes, it fills from the center: purple for success and white for failure, then disappears. **Device settings → Sounds → Air gesture results** controls the success/failure cues and is enabled by default; the fills appear even when sounds are off. The global Sounds switch and volume also apply.
