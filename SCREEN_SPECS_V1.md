# Screen Specs V1 (Mobile-First)

This file is a filled version of `SCREEN_SPEC_TEMPLATE.md` for the first three core mobile screens:
- `M-HOME`
- `M-PLANNER`
- `M-SCAN`

---

## M-HOME

### 1) Metadata
- Screen ID: `M-HOME`
- Screen Name: `Home Dashboard`
- Platform: `mobile`
- Priority: `P0`
- Owner: Mobile + Backend
- Last Updated: 2026-02-08

### 2) Purpose
- User job solved: Check today status and force sync instantly.
- Why this screen exists: First-touch control center for daily health confidence.
- Primary success outcome: User sees fresh steps/calories/workouts/sleep and can sync in one tap.

### 3) Entry + Exit
- Entry points: App launch, tab tap on `Home`.
- Exit points: Planner tab, Scan tab, Mirror tab, Settings tab.
- Back behavior: Default app/tab behavior; no blocking modal.

### 4) Information Architecture
- Primary section: Health summary cards (steps, active calories, workouts, sleep).
- Secondary section: Sync CTA + scanner CTA.
- Hidden/advanced section: None on v1 home.

### 5) Actions
- Primary action: `Sync Now`.
- Secondary actions: `Open Scanner`, `Go to Planner`, `Open Web Mirror`.
- Destructive actions: None.
- Tap budget target: 1 tap sync, 1 tap scanner open.

### 6) Data Contract
- Required API/data sources:
  - `healthSyncService.getTodaySummary()`
  - `healthSyncService.syncHealthData(1, { preferIncremental: true })`
  - `backendSyncService.syncToBackend()`
  - `AsyncStorage[STORAGE_KEYS.LAST_SYNC_TIME]` for freshness label
- Request cadence:
  - initial load at app init
  - foreground refresh (>= 60s gap)
  - manual sync on button tap
- Freshness requirement: latest wearable data should be reflected after sync completes.
- Fallback data behavior: show last known local values + explicit sync failure alert.

### 7) States
- Loading: initial app init spinner/skeleton before `isInitialized`.
- Empty: valid empty is `0` metrics when no health data yet.
- Error: alert on sync failure (`Sync Failed`), keep previous data.
- Offline: sync fails gracefully; local summary remains visible.
- Sync in progress: button label `Syncing...`, action disabled.

### 8) Validation + Rules
- Input validation rules: no user text inputs on home.
- Permission rules: if no health permission, show health access prompt overlay and CTA.
- Rate limiting / throttling rules:
  - foreground refresh throttle (60s)
  - observer-driven sync in health service handles overlap/backoff.

### 9) Analytics
- `screen_viewed` payload:
  - `screen_id: "M-HOME"`, `has_permissions`, `is_syncing`, `last_sync_age_sec`
- `primary_action_tapped` payload:
  - `action: "manual_sync"`, `screen_id`, `has_permissions`
- `action_succeeded` payload:
  - `action: "manual_sync"`, `synced_records`, `latency_ms`
- `action_failed` payload:
  - `action: "manual_sync"`, `error_code`, `error_message`

### 10) Accessibility + UX Quality
- Minimum touch targets: >= 44px.
- Typography constraints: key values >= 20px, labels >= 12px.
- Contrast requirements: WCAG AA equivalent for summary and action buttons.
- Keyboard and screen reader notes: all actionable controls must have accessible labels.

### 11) QA Checklist
- [ ] Home summary loads after app init.
- [ ] Manual sync updates numbers and timestamp.
- [ ] Permission-denied path displays prompt.
- [ ] Sync failure does not clear current cards.
- [ ] Analytics events fire for view/sync success/failure.
- [ ] Works in both light and dark system themes.

### 12) Release Plan
- Feature flag: `mobile_priority_shell_enabled`.
- Rollout plan: internal -> beta -> 100%.
- Rollback plan: fallback to previous container shell.
- Post-release metrics to monitor:
  - manual sync success rate
  - sync latency p95
  - daily active users on Home

---

## M-PLANNER

### 1) Metadata
- Screen ID: `M-PLANNER`
- Screen Name: `Weekly Planner`
- Platform: `mobile`
- Priority: `P0`
- Owner: Mobile
- Last Updated: 2026-02-08

### 2) Purpose
- User job solved: Add and manage weekly workouts/meals with minimal taps.
- Why this screen exists: High-frequency planning should not require web or nested modals.
- Primary success outcome: user adds a workout/meal in <=2 taps.

### 3) Entry + Exit
- Entry points: Planner tab from bottom nav.
- Exit points: any other tab.
- Back behavior: tab-level navigation only.

### 4) Information Architecture
- Primary section: selected day card (workouts + meals + notes).
- Secondary section: quick chips and custom add fields.
- Hidden/advanced section: week overview rows for quick day switch.

### 5) Actions
- Primary action: quick add workout/meal chip tap.
- Secondary actions:
  - add custom workout
  - add custom meal
  - toggle workout status
  - delete workout/meal
  - edit notes
- Destructive actions: delete workout/meal.
- Tap budget target:
  - quick add <=2 taps
  - toggle <=1 tap
  - delete <=1 tap

### 6) Data Contract
- Required API/data sources:
  - `plannerStorage.loadPlanner()`
  - `plannerStorage.savePlanner()`
  - `plannerStorage.addWorkout/addMeal/toggle/remove/updateDayNotes`
  - Storage key: `@weekly_planner_v1`
- Request cadence:
  - load once on planner shell init
  - persist on each mutating action
- Freshness requirement: immediate local consistency (optimistic local save).
- Fallback data behavior: if storage parse/load fails, create empty planner safely.

### 7) States
- Loading: `Loading mobile experience...` while planner loads.
- Empty: “No workouts yet” and “No meals yet” with quick-add chips.
- Error: storage failures logged; screen falls back to empty planner.
- Offline: fully usable (local storage only).
- Sync in progress: unrelated to planner mutating actions.

### 8) Validation + Rules
- Input validation rules:
  - custom text trimmed
  - no empty item insertion
- Permission rules: none required for planner actions.
- Rate limiting / throttling rules: none needed (local persistence).

### 9) Analytics
- `screen_viewed` payload:
  - `screen_id: "M-PLANNER"`, `selected_day`, `workout_count`, `meal_count`
- `primary_action_tapped` payload:
  - `action: "planner_quick_add"`, `item_type`, `day`
- `action_succeeded` payload:
  - `action`, `item_type`, `day`, `new_total`
- `action_failed` payload:
  - `action`, `error_message`

### 10) Accessibility + UX Quality
- Minimum touch targets: chips/buttons >= 44px.
- Typography constraints: body >= 13px, titles >= 15px.
- Contrast requirements: text and chip states readable in dark/light.
- Keyboard and screen reader notes:
  - custom input fields focusable and labeled.
  - destructive buttons announced clearly.

### 11) QA Checklist
- [ ] Day switching keeps correct per-day data.
- [ ] Quick chips add items instantly.
- [ ] Custom add ignores empty text.
- [ ] Toggle + delete behave correctly.
- [ ] Notes persist across app restart.
- [ ] Empty planner fallback works when storage is invalid.

### 12) Release Plan
- Feature flag: `mobile_planner_v1`.
- Rollout plan: internal + dogfood first.
- Rollback plan: keep planner tab hidden and revert to prior shell.
- Post-release metrics to monitor:
  - planner add events/user/day
  - average taps per added item
  - planner retention day-7

---

## M-SCAN

### 1) Metadata
- Screen ID: `M-SCAN`
- Screen Name: `Native Barcode Scanner`
- Platform: `mobile`
- Priority: `P0`
- Owner: Mobile + Backend
- Last Updated: 2026-02-08

### 2) Purpose
- User job solved: Log food quickly by scanning barcode and confirming nutrition.
- Why this screen exists: camera/scanner reliability is mobile-native critical path.
- Primary success outcome: successful `food/log` save from scan flow.

### 3) Entry + Exit
- Entry points: `Scan` tab action, Home `Open Scanner` CTA.
- Exit points: close button, success auto-close, back to planner/home.
- Back behavior:
  - when product result shown: reset scanner to scan mode
  - global close exits scanner overlay

### 4) Information Architecture
- Primary section: camera viewport and scan guidance.
- Secondary section: product detail confirmation (image, macros, serving).
- Hidden/advanced section: none.

### 5) Actions
- Primary action: `Log Food` (after successful scan and lookup).
- Secondary actions: back/reset scan, close scanner.
- Destructive actions: none.
- Tap budget target:
  - scan to log <=3 taps (scan -> log -> auto close)

### 6) Data Contract
- Required API/data sources:
  - camera device + permission (`react-native-vision-camera`)
  - OpenFoodFacts lookup: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}`
  - Backend log: `POST ${API_BASE_URL}/food/log`
  - auth token: `AsyncStorage[STORAGE_KEYS.AUTH_TOKEN]`
- Request cadence: one lookup per scanned barcode, one log call on confirm.
- Freshness requirement: immediate post-log callback to refresh mobile state.
- Fallback data behavior:
  - product not found -> inline error + rescan
  - backend failure -> keep product screen + show retryable error

### 7) States
- Loading:
  - camera permission pending
  - lookup in progress
  - log in progress
- Empty: initial scan state waiting for code.
- Error:
  - camera denied
  - no camera device
  - product lookup/network fail
  - backend log fail
- Offline:
  - lookup and log can fail; display actionable message and retry.
- Sync in progress: independent; scan still usable.

### 8) Validation + Rules
- Input validation rules: barcode must exist before lookup.
- Permission rules: camera permission required.
- Rate limiting / throttling rules:
  - scanner processing gated by `isScanning` and `loading` to prevent duplicate requests.

### 9) Analytics
- `screen_viewed` payload:
  - `screen_id: "M-SCAN"`, `camera_permission_state`
- `primary_action_tapped` payload:
  - `action: "food_log_submit"`, `barcode`, `has_auth_token`
- `action_succeeded` payload:
  - `action: "food_log_submit"`, `barcode`, `latency_ms`
- `action_failed` payload:
  - `action`, `stage: "lookup" | "save"`, `error_message`, `http_status`

### 10) Accessibility + UX Quality
- Minimum touch targets: >= 44px for close/back/log buttons.
- Typography constraints: product title >= 18px, nutrition labels >= 12px.
- Contrast requirements: scan overlays/buttons meet dark-mode readability.
- Keyboard and screen reader notes:
  - buttons must be labeled (`Close scanner`, `Log food`, `Back to scan`).

### 11) QA Checklist
- [ ] Camera permission denied path is clear and recoverable.
- [ ] Successful barcode lookup shows product details.
- [ ] Unknown barcode returns clear message and resumes scanning.
- [ ] Log call sends auth header when token exists.
- [ ] Success state auto-closes and triggers callback.
- [ ] Scanner does not fire duplicate lookups for same frame.

### 12) Release Plan
- Feature flag: `native_scanner_primary`.
- Rollout plan: keep current scanner path only (already native).
- Rollback plan: disable scanner entrypoint and use manual food logging.
- Post-release metrics to monitor:
  - scan success rate
  - lookup failure rate
  - log success rate
  - time scan->log p95

---

## M-SET

### 1) Metadata
- Screen ID: `M-SET`
- Screen Name: `Settings`
- Platform: `mobile`
- Priority: `P1`
- Owner: Mobile + Backend
- Last Updated: 2026-02-08

### 2) Purpose
- User job solved: Control permissions and sync health safely.
- Why this screen exists: keeps trust controls explicit and reachable without leaving app.
- Primary success outcome: user can grant health permissions or run manual sync with clear status.

### 3) Entry + Exit
- Entry points: `Settings` tab.
- Exit points: any tab change.
- Back behavior: tab-level navigation.

### 4) Information Architecture
- Primary section: Health access status + grant action.
- Secondary section: Sync status + manual sync action.
- Hidden/advanced section: priority mode explanation and future settings expansion area.

### 5) Actions
- Primary action: `Grant Permissions` (if not granted).
- Secondary actions: `Run Manual Sync`.
- Destructive actions: none.
- Tap budget target: <=2 taps for permission CTA and <=1 tap for manual sync.

### 6) Data Contract
- Required API/data sources:
  - `hasPermissions` from app shell state.
  - `requestPermissions()` -> `healthSyncService.requestPermissions()`.
  - `onManualSync()` -> `healthSyncService.syncHealthData` + `backendSyncService.syncToBackend`.
  - `AsyncStorage[STORAGE_KEYS.LAST_SYNC_TIME]`.
- Request cadence:
  - load sync timestamp on render and after sync completion.
  - permission flow only on user action.
- Freshness requirement: sync timestamp should update immediately after successful manual sync.
- Fallback data behavior: if sync timestamp unavailable, show `Never synced`.

### 7) States
- Loading: inherited app init loader.
- Empty: permission unknown defaults to `Not granted`.
- Error:
  - permission request failure -> alert
  - sync failure -> alert
- Offline: manual sync may fail; keep current status visible and retry available.
- Sync in progress: button label `Syncing...`, disabled while active.

### 8) Validation + Rules
- Input validation rules: none (action-only screen).
- Permission rules:
  - health permissions are platform-managed.
  - if denied, user can retry from Settings path.
- Rate limiting / throttling rules:
  - manual sync prevented during active sync (`isSyncing` gate).

### 9) Analytics
- `screen_viewed` payload:
  - `screen_id: "M-SET"`, `has_permissions`, `last_sync_age_sec`
- `primary_action_tapped` payload:
  - `action: "grant_permissions"` or `action: "manual_sync"`
- `action_succeeded` payload:
  - `action`, `latency_ms`, `result_state`
- `action_failed` payload:
  - `action`, `error_message`

### 10) Accessibility + UX Quality
- Minimum touch targets: >= 44px for all action buttons.
- Typography constraints: section title >= 15px, body >= 13px.
- Contrast requirements: status and action text must meet AA in dark/light modes.
- Keyboard and screen reader notes:
  - announce permission state (`Granted` / `Not granted`) as explicit text.

### 11) QA Checklist
- [ ] Permission status reflects actual state after grant/deny.
- [ ] Manual sync runs and updates timestamp.
- [ ] Sync button disables during active sync.
- [ ] Failure alerts appear with retry path.
- [ ] Analytics events fire for view and actions.
- [ ] Works on both iOS and Android permission models.

### 12) Release Plan
- Feature flag: `mobile_settings_v1`.
- Rollout plan: enable with mobile-priority shell release.
- Rollback plan: hide settings tab and route permission to startup prompt only.
- Post-release metrics to monitor:
  - permission grant conversion
  - manual sync usage
  - sync failure rate from settings

---

## M-MIRROR

### 1) Metadata
- Screen ID: `M-MIRROR`
- Screen Name: `Web Mirror`
- Platform: `mobile` (embedding web)
- Priority: `P2` (temporary)
- Owner: Mobile + Web
- Last Updated: 2026-02-08

### 2) Purpose
- User job solved: access remaining web-only flows while mobile-native screens are being migrated.
- Why this screen exists: controlled transition path, not a permanent primary UX.
- Primary success outcome: user can complete web-only tasks without blocking mobile roadmap.

### 3) Entry + Exit
- Entry points: `Mirror` tab.
- Exit points: any tab change or scanner overlay.
- Back behavior: stays in mirror container; app-level tab switch exits.

### 4) Information Architecture
- Primary section: short context header (`Web Mirror`, companion notice).
- Secondary section: embedded `WebAppContainer`.
- Hidden/advanced section: bridge-level messaging handled internally.

### 5) Actions
- Primary action: interact with mirrored web content.
- Secondary actions: trigger native scanner from web bridge.
- Destructive actions: none at wrapper level.
- Tap budget target: 1 tap entry from tab; no extra wrapper friction.

### 6) Data Contract
- Required API/data sources:
  - `WebAppContainer` with React Native bridge.
  - web app URL from `WEBAPP_URL`.
  - optional health payload pushes via bridge from local DB.
  - auth token sync via AsyncStorage/localStorage bridge.
- Request cadence:
  - web content loads on mirror tab open.
  - bridge events on-demand from web/native actions.
- Freshness requirement: mirror should reflect latest synced backend data after native sync.
- Fallback data behavior: if web fails, show error/retry state from WebView container.

### 7) States
- Loading: webview loading.
- Empty: not applicable (web app decides).
- Error: web load error in container; retry via pull-to-refresh/reload.
- Offline: web may fail to load; native app remains usable outside mirror tab.
- Sync in progress: independent from mirror rendering.

### 8) Validation + Rules
- Input validation rules: delegated to web.
- Permission rules:
  - mirror should not bypass native permission prompts.
  - camera flows from web route `/scan` must hand off to native scanner.
- Rate limiting / throttling rules:
  - avoid duplicate sync requests from web + native by using current sync guards.

### 9) Analytics
- `screen_viewed` payload:
  - `screen_id: "M-MIRROR"`, `webapp_url`, `is_authenticated`
- `primary_action_tapped` payload:
  - `action: "mirror_opened"` and optional `action: "mirror_to_native_scan"`
- `action_succeeded` payload:
  - `action`, `latency_ms`
- `action_failed` payload:
  - `action`, `error_stage: "webview_load" | "bridge_message"`

### 10) Accessibility + UX Quality
- Minimum touch targets: native wrapper tabs/controls >= 44px.
- Typography constraints: wrapper header subtitle >= 12px.
- Contrast requirements: wrapper UI meets AA; web accessibility remains web-owned.
- Keyboard and screen reader notes:
  - mirror header should clearly announce this is companion mode.

### 11) QA Checklist
- [ ] Mirror tab opens web content successfully.
- [ ] Auth token sync works and user remains logged in.
- [ ] Native scanner handoff from mirrored scan route works.
- [ ] Webview error state is recoverable.
- [ ] Mirror does not block native tabs when web fails.
- [ ] Analytics events fire for mirror entry and failures.

### 12) Release Plan
- Feature flag: `web_mirror_tab_enabled`.
- Rollout plan: keep enabled during migration; review each sprint.
- Rollback plan: disable mirror tab if stability degrades.
- Post-release metrics to monitor:
  - mirror session share (% of mobile sessions)
  - mirror error rate
  - reduction trend (should decline as native parity grows)
