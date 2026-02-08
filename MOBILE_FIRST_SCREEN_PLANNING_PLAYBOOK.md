# Mobile-First Screen Planning Playbook

This document is the operating model for planning screens in this project.

## 1) Platform Roles (Source of Truth)

Use this before planning any screen:

| Platform | Role | Must Own | Should Avoid |
| --- | --- | --- | --- |
| Mobile app | Primary product experience | Daily tracking, quick logging, scanner, integrations, notifications, planner | Admin-heavy tables, dense analytics-only views |
| Web app | Companion mirror and management surface | Reflection, account setup, history browsing, team/admin workflows | Becoming the only place to perform daily core actions |

Decision rule:
- If user does it daily or on-the-go, it belongs on mobile first.
- Web can mirror it, but mobile cannot depend on web UI for core value.

## 2) Planning Sequence (Industry-Style)

Plan in this order for every initiative:

1. Define user jobs.
2. Define outcomes and constraints.
3. Map end-to-end flows (wireflow).
4. Build screen inventory (core/support/rare).
5. Define nav model.
6. Define states per screen (loading/empty/error/offline).
7. Define data contract + event instrumentation.
8. Slice release vertically by flow.

## 3) User Jobs for This Product

- Track health status for today in under 10 seconds.
- Add food/workout/plan items in minimal taps.
- Keep wearable data fresh and trustworthy.
- Review trends and take action.
- Manage profile and permissions safely.

## 4) Navigation Model (Current Target)

Mobile bottom tabs (max 5):
- Home
- Planner
- Scan
- Mirror (temporary companion)
- Settings

Rules:
- High-frequency actions must be no deeper than 2 levels.
- Prefer inline add and chips over deep modal chains.
- Reserve full-screen modals for camera, auth, and high-focus tasks.

## 5) Screen Inventory (V1)

| ID | Screen | Platform | Priority | Job | Entry Points | Success Event |
| --- | --- | --- | --- | --- | --- | --- |
| M-HOME | Home dashboard | Mobile | P0 | Read today status quickly | App open, tab tap | `home_viewed` |
| M-PLANNER | Weekly planner | Mobile | P0 | Plan workouts/meals quickly | Tab tap | `planner_item_added` |
| M-SCAN | Native scanner | Mobile | P0 | Log food rapidly | Tab tap, CTA | `food_logged_from_scan` |
| M-SET | Settings | Mobile | P1 | Permission and sync control | Tab tap | `settings_updated` |
| M-MIRROR | Web mirror container | Mobile | P2 (temporary) | Access remaining web-only flows | Tab tap | `mirror_opened` |
| W-DASH | Web dashboard | Web | P2 | Companion reflection | Browser nav | `web_dashboard_viewed` |

Priority classes:
- P0: Required for release.
- P1: Important but can follow.
- P2: Companion/backlog.

## 6) Flow Templates (Use for Every Feature)

Use one row per flow:

| Flow ID | Flow Name | Start Screen | Steps | Target Taps | Failure Path | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | Quick workout add | M-PLANNER | Select day -> tap quick chip | <=2 | retry inline | Mobile |
| F-002 | Quick meal add | M-PLANNER | Select day -> tap meal chip | <=2 | retry inline | Mobile |
| F-003 | Manual sync | M-HOME | Tap sync | 1 | background retry + banner | Mobile+Backend |
| F-004 | Food scan log | M-SCAN | Scan -> confirm -> save | <=3 | rescan/error UI | Mobile+Backend |

Tap budget rules:
- Daily actions: <=2 taps
- Weekly planning actions: <=3 taps
- Settings actions: <=4 taps

## 7) Screen Spec Checklist (Definition of Ready)

A screen can start implementation only if all are defined:

- Screen purpose in one sentence.
- Primary action and secondary actions.
- Input and output data contract.
- Loading/empty/error/offline states.
- Analytics events (view, primary action, failure).
- Accessibility notes.
- Copy reviewed (short and action-oriented).

## 8) Screen State Requirements

Every screen must include:

- Loading state.
- Empty state with clear CTA.
- Error state with retry path.
- Offline behavior or last-known-data behavior.
- Sync freshness indicator where data timeliness matters.

## 9) Instrumentation Baseline

Required events per core screen:

- `screen_viewed`
- `primary_action_tapped`
- `action_succeeded`
- `action_failed`

Required attributes:
- `screen_id`
- `flow_id`
- `latency_ms` (if network/data action)
- `source` (manual/background/wearable/webhook)

## 10) Vertical Slice Release Plan

Build in this order:

1. Slice A: Home + Sync freshness + Manual sync.
2. Slice B: Planner quick-add and weekly flow.
3. Slice C: Native scanner end-to-end food log.
4. Slice D: Settings and permission hardening.
5. Slice E: Replace remaining mirror dependencies.

Each slice must include:
- UI
- Data/API
- Error handling
- Analytics
- QA checklist

## 11) Governance Rules

- No new web-only core flows without explicit exception.
- Any new daily action must have a mobile-first UX spec.
- If a screen adds >3 taps for a core flow, redesign before ship.
- Weekly review: flow drop-off, time-to-action, sync freshness failures.

## 12) Weekly Planning Ritual

Use this each sprint:

1. Review previous week analytics.
2. Pick 1-2 flows with highest friction.
3. Update flow map and tap budget.
4. Ship one vertical slice.
5. Validate with real users and telemetry.

