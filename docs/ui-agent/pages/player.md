# Player Page Contract

- Purpose: immersive and reliable video playback.
- Visual scope: only explicitly requested visual/control changes; use existing approved player baseline.
- Preserve: playback engine, source switching, quality selection, seeking, keyboard/touch controls, auto-hide lifecycle, resume state, and all player event bindings.
- Do not change stream resolution, source ranking, API, or playback state ownership as a side effect of visual work.
- Responsive: safe areas, orientation, touch targets, control visibility, and overlays must be tested on real devices when device-specific.
- Acceptance: play/pause, seek, source switch, quality change, idle control fade, touch wake, pause persistence, errors, desktop/tablet/phone.
