# UI Agent Acceptance Contract

## Definition of done

A UI task is complete only when all applicable gates have explicit evidence.

### 1. Scope integrity
- [ ] Changes stay within the assigned page/component and supporting tests.
- [ ] Existing data sources, business logic, routes, player, Friday runtime, and persistence remain intact unless explicitly in scope.
- [ ] No unrelated formatting or dependency churn.

### 2. Design quality
- [ ] Clear visual hierarchy and consistent typography.
- [ ] Spacing and component dimensions follow documented tokens.
- [ ] Light and dark themes remain readable.
- [ ] Loading, empty, error, focus, disabled, and pressed states are covered where relevant.
- [ ] Reduced-motion preference is respected.

### 3. Responsive behavior
- [ ] Desktop 1440x900.
- [ ] Tablet 1024x1366.
- [ ] Phone 390x844.
- [ ] No unintended horizontal overflow, clipping, overlap, or hidden primary actions.
- [ ] Fixed headers/footers respect safe-area insets and do not cover content.

### 4. Functional behavior
- [ ] Primary actions work by pointer and keyboard.
- [ ] Touch interactions remain usable.
- [ ] Existing routes, data loading, persistence, and navigation are not regressed.
- [ ] Console errors and failed requests are reviewed.

### 5. Automated verification
- [ ] TypeScript.
- [ ] ESLint.
- [ ] Unit tests.
- [ ] Production build.
- [ ] Focused browser tests for changed interactions, when browser harness is available.

### 6. Deployment and device evidence
- [ ] Preview is deployed from the exact reviewed commit.
- [ ] Preview route is opened and behavior checked.
- [ ] Real iPhone Safari checked for iOS-specific behavior.
- [ ] Real iPad Safari checked when tablet-specific behavior is in scope.

## Status vocabulary

- **PASS:** direct evidence exists and is linked or summarized.
- **FAIL:** the check ran and failed.
- **NOT RUN:** the check was not executed.
- **BLOCKED:** the check cannot run because a prerequisite is missing.

Do not convert NOT RUN or BLOCKED into PASS. CI green does not imply Preview, browser, or device acceptance.
