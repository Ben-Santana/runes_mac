# Runes / Band Studio
Question: what is the band collecting right now?
Face: an isometric electrode bracelet and eight stacked ink traces, on white.
Data: eight unsigned ADC channels at 2048 Hz, 16 samples per batch; gyro wire values;
orientation w,x,y,z; gestures with raw enum codes; host timestamps and distinct device clocks;
battery, hand, checked device fields, trust status, queue stats, discontinuities.
Jobs: discover, choose a device, explicitly enroll if needed, connect, inspect, record, disconnect.
No hardware values are invented. The browser preview offers an explicitly labeled simulation.
Composition: 216px sidebar + fluid instrument canvas with 32px gutters; content =
main signals + 24px gutter + 300px device rail, with a shared bottom edge.
Palette: white #fff, ink #191919, muted #696969, rules #e8e8e8; chart hue overridden
by the user's monochrome instruction. Geist loaded locally. 24px page title, 16px section
heads, 14px body, 12px captions. Tight 6px controls, 8px panels. No shadows at rest.
Motion: 200ms control transitions; 350ms entrance; Hairline's 700ms item tweens.
Reduced motion disables entrance effects and lands Hairline changes immediately.
Hairline concept: eight rounded electrode pods loop around the wrist; a pointer lifts the
nearest pod, with neighboring pods answering by distance. It uses the unchanged kernel.
MotionSites examples studied: prosthetics-hero and tech-forward, for monochrome restraint,
object identity and precise motion; app composition follows Taste's achromatic ledger.

QA: Taste inspector passes at 1440, 768 and 390px. Remaining advisory notes:
11–12px type is reserved for dense instrument readouts and metadata; no text is below 11px.
The gesture well reserves three event rows, keeping its action stable as events arrive.
Hairline validation passes: fits the frame, stable rest/hover, readout, no browser errors;
31% rest coverage. Its small ring and raised neighboring electrode remain legible.

## Motion shortcuts redesign

Direction: Achromatic ledger, seed 1646729374, with the dealt no-sidebar shell. No redraws. The screen answers “What does each movement do on my Mac?” The product’s face is the familiar Mac keycap, with modifier symbols and a tactile lower border; the six gesture-to-shortcut rows are the signature element. Existing Geist assets stay local.

The main job is assigning a key combination, directly from each row. Recording is inline and keyboard-only. Clicking a keycap listens for a combination, shows held modifiers as keycaps, and saves automatically when the full combination is released. Escape, clicking outside, or losing window focus cancels; the × control clears an existing assignment. There is no dialog or explanatory copy. Each motion starts unassigned and off; saving enables it, cancellation leaves it alone, and removing a shortcut disables it. Changes persist on this Mac. There is no invented device or usage data.

All legacy inspectors remain under Device test, entered from the final section in Device settings. Shortcut execution is suspended in settings, device tests, the connection dialog, and the shortcut editor. Demo packets never enter the native shortcut engine.

Visual QA: reviewed desktop, tablet, and phone screenshots, including the editor. Final inspector: zero failures at 1440, 768, 390; one warning for small secondary text at 390. The Mac desktop screen uses 13–14px labels; 11–12px is reserved for descriptions and saving/status notes. Compared with the original, navigation is reduced to two destinations, all six assignments fit in the first desktop viewport, and the main screen contains no diagnostic data. Critique: the largest block answers the primary question; content edges align; chrome remains neutral; enabled totals are derived from assignments; unassigned keys are explicit; mobile rows stack the shortcut beneath the motion. No charts or legends are needed. Remaining limitation: hardware gesture timing and macOS permission behavior require a connected-band trial.

Inline simplification QA: keyboard capture, modifier preview, Option-produced symbols, persistence, cancellation, removal and responsive layout pass. Inspector has zero failures and one desktop whitespace warning: the six-row settings list deliberately keeps open space between motion labels and shortcut controls, as requested, rather than adding content.
