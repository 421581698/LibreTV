# UI Agent Acceptance Contract

## Definition of done

### 1. Scope integrity
- [ ] Changes stay within assigned page/component and supporting tests.
- [ ] Existing routes, data sources, business logic, player, Friday runtime, and persistence remain intact unless explicitly in scope.
- [ ] Removing Friday's floating UI does not remove backend, tools, voice/runtime, or player integration.
- [ ] UI Studio is a visual workspace, not a chat-first interface or floating assistant.
- [ ] No unrelated formatting/dependency churn.

### 2. Design-system compliance
- [ ] Root DESIGN.md version recorded.
- [ ] Relevant page contract read and referenced.
- [ ] Semantic color, typography, spacing, surface, and component tokens used.
- [ ] Missing tokens proposed, not silently invented.
- [ ] External references attributed and adapted; no wholesale brand cloning.
- [ ] Design preview updated when tokens/reusable component recipes change.
- [ ] Exceptions include rationale and scope.

### 3. Design quality
- [ ] Clear hierarchy and consistent typography.
- [ ] Dimensions/spacing follow documented tokens.
- [ ] Light/dark themes readable.
- [ ] Loading, empty, error, focus, disabled, pressed states covered where relevant.
- [ ] Reduced motion respected.
- [ ] Contrast and focus indicators reviewed.

### 4. Responsive behavior
- [ ] Desktop 1440x900.
- [ ] Tablet 1024x1366.
- [ ] Phone 390x844.
- [ ] No unintended overflow, clipping, overlap, hidden primary actions.
- [ ] Fixed elements respect safe areas.
- [ ] Touch targets preferably >=44x44 CSS px.

### 5. Functional behavior
- [ ] Primary actions work by pointer and keyboard.
- [ ] Touch interactions usable.
- [ ] Existing routes, data, persistence, and navigation not regressed.
- [ ] Console errors and failed requests reviewed.
- [ ] UI Studio shows real backend capability status; no fake execution states.

### 6. Automated verification
- [ ] TypeScript.
- [ ] ESLint.
- [ ] Unit tests.
- [ ] Production build.
- [ ] Focused browser tests.
- [ ] Screenshot comparison and visual findings reviewed.

### 7. Deployment/device evidence
- [ ] Preview deployed from exact reviewed commit.
- [ ] Preview route opened and behavior checked.
- [ ] Real iPhone Safari checked for iOS behavior.
- [ ] Real iPad Safari checked when tablet behavior is in scope.

## Status vocabulary

- **PASS:** direct evidence exists and is linked/summarized.
- **FAIL:** check ran and failed.
- **NOT RUN:** check was not executed.
- **BLOCKED:** prerequisite missing.

Never convert NOT RUN/BLOCKED into PASS. CI green does not imply Preview, browser, visual, or device acceptance.
