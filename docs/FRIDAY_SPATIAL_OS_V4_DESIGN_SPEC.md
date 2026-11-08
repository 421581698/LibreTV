# LibreTV · FRIDAY SPATIAL OS V4
## UI Design Specification — Apple-inspired Minimalism

**Status:** First implementation specification  
**Branch:** `feature/friday-spatial-os-v4`  
**Scope:** Homepage (light/dark), Friday assistant states, responsive player (desktop/iPad/iPhone)  
**Design intent:** Calm, content-first, native-feeling product UI. Apple-inspired in hierarchy, restraint, typography and interaction—not a copy of Apple UI.

---

## 1. Non-negotiable design decisions

1. No sci-fi HUD, starfields, neon, holographic panels, orbiting navigation, or oversized central assistant.
2. Friday is always reachable but visually secondary. On the homepage, the default assistant is a **small golden sigil button in the upper-right content area**, not a hero object.
3. Film and episode artwork owns the visual hierarchy. Friday must never cover posters, playback controls, subtitles, or important player content.
4. Use native-feeling surfaces: solid or subtly translucent materials, restrained borders, soft shadows, consistent radii, generous whitespace.
5. Keep the existing Canvas 2D gold-sigil renderer, ASR/TTS/VAD lifecycle, Task Runtime, source search, player, and decoded-quality evidence. V4 changes presentation and composition—not those engines.
6. Real recommendation data and existing poster URLs remain the source of truth. No fabricated content in production UI.
7. Light and dark themes share the same information architecture and spacing system.

## 2. Design tokens

| Token | Light | Dark |
|---|---|---|
| App background | `#F5F5F7` | `#111214` |
| Primary surface | `#FFFFFF` | `#1C1D20` |
| Secondary surface | `#ECEDEF` | `#26282C` |
| Primary text | `#1D1D1F` | `#F5F5F7` |
| Secondary text | `#6E6E73` | `#A1A1A6` |
| Separator | `rgba(60,60,67,.14)` | `rgba(235,235,245,.16)` |
| Friday accent | `#C9963D` | `#E0B35D` |
| Success | `#248A4B` | `#35B66A` |
| Error | `#C83C36` | `#FF625A` |

- Typography: system UI stack; Chinese fallback `PingFang SC`, then `Noto Sans SC`; no decorative sci-fi fonts.
- Type scale: 12 / 14 / 16 / 20 / 28 / 36 / 48 px. Use 48 px only for a hero title on wide desktop.
- Radius: 8 px controls, 12 px cards, 16 px large media surfaces, 999 px pills.
- Spacing base: 4 px; common intervals 8 / 12 / 16 / 24 / 32 / 48 px.
- Motion: 160–240 ms for controls; 280–420 ms for layout transitions; respect `prefers-reduced-motion`.
- Avoid blur as a default surface treatment. Use it only where content genuinely passes behind a control.

## 3. Deliverable A — Homepage, light and dark

### Shared information architecture

- Top navigation: LibreTV mark; 首页 / 影视 / 动漫 / 直播 / 资源 / 我的; compact search, history, settings and profile actions.
- Main hero: one real featured title with artwork, title, concise metadata and two actions (立即观看 / 更多详情). Hero artwork is dominant; text sits in a legible gradient-safe region.
- Friday entry: a small 40–48 px gold-sigil control near the right edge of the hero or in the utility rail. A small status dot may indicate activity. No permanent speech bubble.
- Below hero: 今日推荐, 继续观看, and other existing recommendation sections, using real data and existing navigation/detail behavior.
- Voice/text entry: compact, discoverable input row; it must not become a full-width translucent HUD. On narrow screens it may become a sticky bottom input, with safe-area padding.
- Four spaces remain accessible through ordinary, consistent navigation—not four floating corner cards.

### Light theme

- Background `#F5F5F7`; white content surfaces; dark readable text.
- Use generous whitespace and low-contrast separators instead of heavy card borders.
- Hero media can extend edge-to-edge within the content frame; text uses a subtle dark scrim only when required for contrast.
- Posters keep consistent aspect ratio and use restrained corner radius; hover/focus reveals actions without changing card geometry.

### Dark theme

- Background `#111214`; surfaces `#1C1D20` and `#26282C`; text remains high contrast.
- Preserve the same hero dimensions and poster grid as light theme.
- Avoid black-on-black cards, excessive gradients, gold outlines around every item, or glowing edges.
- Gold is reserved for Friday, primary playback emphasis, and small active-state indicators.

### Responsive layout

- Desktop ≥ 1200 px: centered content max-width 1440 px; hero 16:7 to 16:8; poster row 6–8 visible cards depending on viewport.
- Tablet 768–1199 px: hero 16:9; 4–5 posters visible; utility controls consolidate before labels disappear.
- Phone < 768 px: compact navigation; hero 16:9 with title/actions below or over a contrast-safe lower gradient; 2–2.4 posters visible; Friday becomes a 40 px floating/inline affordance that never covers title or primary action.
- iPhone safe areas must be respected; sticky voice input must not cover the bottom poster row or player controls.

## 4. Deliverable B — Friday assistant states

### Shared shell

- Default footprint: 40–48 px button on homepage; 32–40 px when docked beside an active task or player.
- Expanded assistant surface is user-invoked and compact (target width 320–400 px desktop; full-width bottom sheet on phone). It is not permanently open.
- The existing Canvas 2D renderer remains inside the button/surface. CSS must size the renderer through its wrapper; do not replace its drawing engine.
- Text status and transcript are outside the canvas, accessible to screen readers, and do not rely on color alone.

### State specifications

| State | Sigil treatment | Supporting UI | Interaction |
|---|---|---|---|
| IDLE | Small, calm gold animation | “Friday” label only when space allows; no speech bubble | Tap/click starts existing voice toggle |
| LISTENING | Subtle amplitude response; no large rings | “正在聆听…” and live transcript in compact surface | Tap again stops/commits recognition using existing controller |
| THINKING | Slightly faster but restrained motion | “正在思考…” with one-line intent summary when available | No duplicate task start |
| EXECUTING | Keep sigil small; show task progress in a separate task row/card | Current step, progress and cancel/retry actions only when supported by runtime | Existing Task Runtime owns execution/cancellation |
| SPEAKING | Gentle motion synchronized with audio where available | Short response subtitle; avoid persistent chat bubble | Existing TTS interruption path remains authoritative |
| ERROR | Stop decorative motion; use accessible error color/icon | Plain-language error and a recovery action | Do not silently restart microphone or TTS |

- Voice state and task state remain separate state dimensions.
- No UI event may directly start/stop ASR, TTS, VAD or task execution outside the existing controller/runtime contract.
- Focus, escape-to-close, keyboard access, permission-denied state, and reduced-motion behavior are required.

## 5. Deliverable C — Player, desktop / iPad / iPhone

### Shared player hierarchy

1. Video surface is always primary.
2. Controls appear on interaction and remain readable over the video.
3. Title/back navigation and source/quality controls live outside the subtitle-safe area.
4. Quality evidence panel is compact and distinguishes measured decoded height from source/playlist claims.
5. Friday is a small 32–36 px entry point near a safe corner; expanded assistance must move outside the video or use a dismissible sheet.
6. No assistant overlay may intercept play/pause, seek, volume, captions, fullscreen, AirPlay/cast, or source-switch controls.

### Desktop ≥ 1200 px

- Main video 16:9, centered, max-width 1440 px.
- Optional right-side details/source panel 300–360 px; collapsible without resizing the video unexpectedly.
- Playback controls align to a consistent bottom control rail; timeline has a generous hit target.
- Friday sits in the player toolbar or a dedicated side utility area, never over subtitles.

### iPad 768–1199 px

- Landscape: video-first layout; source/details panel becomes a collapsible drawer.
- Portrait: video at top, controls directly beneath; details and source list below in normal flow.
- Touch targets at least 44 × 44 px; avoid hover-only affordances.
- Friday stays a small toolbar action; expanded assistant appears as a sheet that does not cover the playback control rail.

### iPhone < 768 px

- Portrait: video uses available width at 16:9; controls and source/quality details flow below.
- Landscape/fullscreen: hide nonessential chrome; controls remain touch-accessible and fade only after inactivity.
- Minimum 44 × 44 px touch targets; safe-area insets for bottom controls.
- Friday is a small toolbar or below-player action. Never float above the video center or overlap subtitles.
- Assistant expansion uses a bottom sheet below/after the video when possible; playback remains active and controls remain reachable.

## 6. Component boundaries

Suggested V4-only implementation root:

```
src/components/spatial-os-v4/
  home/
    SpatialHome.tsx
    HomeHero.tsx
    RecommendationRails.tsx
    FridayEntry.tsx
  friday/
    FridayAssistantButton.tsx
    FridayAssistantSurface.tsx
    FridayStatePresentation.ts
  player/
    ResponsivePlayerShell.tsx
    PlayerUtilityRail.tsx
    QualityEvidenceSummary.tsx
  navigation/
    PrimaryNavigation.tsx
  tokens/
    spatial-os-v4.css
```

- V4 components consume existing data and lifecycle APIs; they do not duplicate stores or runtimes.
- The legacy homepage and current player remain available until V4 parity and regression checks pass.
- Do not import or mount the old V1 `FridaySpatialOS` shell as the V4 root.

## 7. Acceptance checklist

### Homepage
- [ ] Light and dark themes have identical information architecture.
- [ ] Friday is visibly available but smaller than primary film content.
- [ ] No starfield, HUD, neon, floating corner-space cards, or oversized orb.
- [ ] Real recommendation data, posters, detail modal, search and navigation continue working.
- [ ] No duplicate Friday entry point or duplicate header controls.

### Friday
- [ ] IDLE / LISTENING / THINKING / EXECUTING / SPEAKING / ERROR each have distinct, calm presentation.
- [ ] Existing Canvas 2D renderer is reused.
- [ ] Existing ASR/TTS/VAD/interrupt lifecycle remains the sole lifecycle owner.
- [ ] Task progress is projected from the existing Task Runtime.
- [ ] Reduced motion, keyboard, screen-reader and permission/error behavior are covered.

### Player
- [ ] Desktop, iPad landscape/portrait, and iPhone portrait/landscape layouts are covered.
- [ ] Friday never obscures video controls or subtitles.
- [ ] Actual decoded-quality evidence remains distinguishable from declared source quality.
- [ ] Player, captions, source switching, fullscreen and cast behavior regressions are tested.

### Release boundary
- [ ] CI green on the V4 branch.
- [ ] Preview visual review on desktop and tablet.
- [ ] iPhone Safari acceptance reported separately from CI.
- [ ] No merge to `main` and no production deployment without separate explicit approval.

---

**This specification is the implementation contract for the first V4 pass.** Any visual revision must preserve the non-negotiable decisions above unless the user explicitly changes them.
