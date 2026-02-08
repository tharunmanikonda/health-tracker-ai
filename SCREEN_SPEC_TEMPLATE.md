# Screen Spec Template

Use this template for every new or redesigned screen.

## 1) Metadata

- Screen ID:
- Screen Name:
- Platform: `mobile` | `web` | `both`
- Priority: `P0` | `P1` | `P2`
- Owner:
- Last Updated:

## 2) Purpose

- User job solved:
- Why this screen exists:
- Primary success outcome:

## 3) Entry + Exit

- Entry points:
- Exit points:
- Back behavior:

## 4) Information Architecture

- Primary section:
- Secondary section:
- Hidden/advanced section:

## 5) Actions

- Primary action:
- Secondary actions:
- Destructive actions:
- Tap budget target:

## 6) Data Contract

- Required API/data sources:
- Request cadence:
- Freshness requirement:
- Fallback data behavior:

## 7) States

- Loading:
- Empty:
- Error:
- Offline:
- Sync in progress:

## 8) Validation + Rules

- Input validation rules:
- Permission rules:
- Rate limiting / throttling rules:

## 9) Analytics

- `screen_viewed` payload:
- `primary_action_tapped` payload:
- `action_succeeded` payload:
- `action_failed` payload:

## 10) Accessibility + UX Quality

- Minimum touch targets:
- Typography constraints:
- Contrast requirements:
- Keyboard and screen reader notes:

## 11) QA Checklist

- [ ] Happy path works.
- [ ] Empty state has actionable CTA.
- [ ] Error state has retry.
- [ ] Offline behavior is defined.
- [ ] Analytics emits correctly.
- [ ] Performance acceptable on low-end device.

## 12) Release Plan

- Feature flag:
- Rollout plan:
- Rollback plan:
- Post-release metrics to monitor:

