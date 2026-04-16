---
name: unified chunk roadmap (uiux pass v2)
overview: "Fresh sequential roadmap for current UI/UX polish pass before new implementation."
todos:
  - id: uiux-chunk1-action-flow
    content: "Chunk 1: Action flow and raise UX"
    status: completed
  - id: uiux-chunk2-state-clarity
    content: "Chunk 2: Turn, bet, and pot readability"
    status: completed
  - id: uiux-chunk3-seat-hierarchy
    content: "Chunk 3: Seat information hierarchy consistency"
    status: completed
  - id: uiux-chunk4-dev-tools-compact
    content: "Chunk 4: Dev/log controls compact and stable"
    status: completed
  - id: uiux-chunk5-layout-stability
    content: "Chunk 5: Fixed POV and anti-reflow hard lock"
    status: completed
  - id: uiux-chunk6-responsive-pass
    content: "Chunk 6: Responsive fit and no-overlap pass"
    status: completed
  - id: uiux-chunk7-bot-step-ux
    content: "Chunk 7: Bot step mode usability and feedback"
    status: completed
  - id: uiux-chunk8-qol-finish
    content: "Chunk 8: Final UX cleanup and acceptance pass"
    status: completed
  - id: uiux-chunk9-visual-system
    content: "Chunk 9: Visual system consistency pass"
    status: completed
  - id: uiux-chunk10-feedback-motion
    content: "Chunk 10: Interaction feedback and micro-motion"
    status: completed
  - id: uiux-chunk11-accessibility-input
    content: "Chunk 11: Accessibility and input ergonomics"
    status: completed
  - id: uiux-chunk12-error-connection-ux
    content: "Chunk 12: Error and connection UX"
    status: completed
  - id: uiux-chunk13-onboarding-recovery
    content: "Chunk 13: Session onboarding and recovery UX"
    status: completed
isProject: false
---

# Unified Execution Roadmap (UI/UX Pass v2)

Execution rule: strict sequential gating. Only the active chunk is counted as progress.
Status rule: no chunk starts until prior chunk is fully accepted.

## Chunk 1 - Action Flow and Raise UX
- Goal: make action-taking fast and intuitive with minimal cursor travel.
- Planned scope:
  - [x] Keep raise/bet confirm anchored in one interaction zone.
  - [x] Add keyboard confirmation path for amount actions.
  - [x] Improve disabled-state clarity for action buttons.
  - [x] Ensure slider + presets never make core action controls jump.

## Chunk 2 - Turn, Bet, and Pot Readability
- Goal: make game state obvious at a glance without extra text clutter.
- Planned scope:
  - [x] Finalize turn indicator balance (visible, not distracting).
  - [x] Lock committed-bet marker locations "in front of player" across seats.
  - [x] Keep total pot placement stable between board and players.
  - [x] Trim remaining redundant status copy in action area.

## Chunk 3 - Seat Information Hierarchy Consistency
- Goal: standardize seat content ordering and readability across all seats.
- Planned scope: 
  - [x] Confirm consistent order: cards -> stack -> player name.
  - [x] Ensure dealer and blind markers follow common poker conventions.
  - [x] Tune stack badge contrast and spacing for quick scan.
  - [x] Validate hierarchy in 2-player, mid-ring, and full-ring layouts.

## Chunk 4 - Dev/Log Controls Compact and Stable
- Goal: keep dev affordances available but visually lightweight in default view.
- Planned scope:
  - [x] Maintain fixed-size preview toggles regardless open/closed state.
  - [x] Keep bot controls always visible with clean disabled states.
  - [x] Reduce visual noise of helper text while preserving clarity.
  - [x] Ensure open panels do not cause neighboring toggle geometry drift.

## Chunk 5 - Fixed POV and Anti-Reflow Hard Lock
- Goal: eliminate perceived camera movement caused by UI expansion.
- Planned scope:
  - [x] Keep top table POV in a fixed ratio/height band.
  - [x] Restrict panel growth to internal scroll regions.
  - [x] Prevent stage width/height shifts from toggles and content changes.
  - [x] Validate fixed-frame behavior during repeated open/close interactions.

## Chunk 6 - Responsive Fit and No-Overlap Pass
- Goal: keep layout usable and non-squished across common desktop/laptop/tablet sizes.
- Planned scope:
  - [x] Tune breakpoints for seat, board, and dock spacing.
  - [x] Eliminate overlap/spill between bets, cards, and dock content.
  - [x] Keep controls reachable without awkward scrolling where possible.
  - [x] Verify readability in compact and comfort density modes.

## Chunk 7 - Bot Step Mode Usability and Feedback
- Goal: make "paused-time" bot stepping predictable and explicit.
- Planned scope:
  - [x] Confirm no auto action leaks while in step mode.
  - [x] Keep Go-next-action behavior reliable via button and hotkey.
  - [x] Improve step readiness feedback wording and visibility.
  - [x] Validate mode transitions (auto <-> step) under active hands.

## Chunk 8 - Final UX Cleanup and Acceptance Pass
- Goal: run final polish sweep and lock acceptance criteria for UI/UX phase.
- Planned scope:
  - [x] Resolve remaining high-friction UI complaints from live testing.
  - [x] Align final microcopy with concise poker-client conventions.
  - [x] Perform end-to-end user flow checks (join, play, raise, step bot, next hand).
  - [x] Record residual risks and "next after UI/UX" handoff list.

**Residual risks / handoff:** No persistent identity or reconnection beyond refresh; `Math.random` deck not crypto-grade; host role is first-joiner only; multi-tab same seat not enforced server-side.

## Chunk 9 - Visual System Consistency Pass
- Goal: make the UI feel cohesive instead of incrementally patched.
- Planned scope:
  - [x] Normalize spacing scale across table, docks, and control groups.
  - [x] Standardize border-radius and shadow depth levels.
  - [x] Consolidate repeated color usage into consistent intent groups.
  - [x] Align typography scale for status, controls, and helper text.

**Note:** Introduced `:root` design tokens (`--nr-space-*`, `--nr-radius-*`, semantic colors); applied to shell spacing and connection banner. Further migration of hard-coded values can continue incrementally.

## Chunk 10 - Interaction Feedback and Micro-Motion
- Goal: improve perceived responsiveness without adding visual noise.
- Planned scope:
  - [x] Add subtle press/commit feedback for core actions.
  - [x] Tune hover/focus transitions to a consistent timing curve.
  - [x] Ensure confirm actions have clear success state cues.
  - [x] Keep motion optional/respect existing motion pause behavior.

**Note:** Primary/top/action-dock buttons use shared duration/easing; `prefers-reduced-motion` trims seat pulse and press nudge; UI motion pause unchanged.

## Chunk 11 - Accessibility and Input Ergonomics
- Goal: make the table usable for keyboard-first and mixed-input users.
- Planned scope:
  - [x] Improve focus ring visibility and keyboard traversal order.
  - [x] Verify text and control contrast in all key states.
  - [x] Increase small tap/click target sizes where needed.
  - [x] Expand keyboard shortcuts coverage for core gameplay actions.

**Note:** `:focus-visible` ring on interactive controls; `sr-only` + visible shortcut line in action dock; coarse-pointer min 44px on dev toggles and preflop edit; hotkeys: Space/C check, F fold, L call, R raise, B presets, Space advances bot step when applicable.

## Chunk 12 - Error and Connection UX
- Goal: reduce confusion during transient failures and reconnect scenarios.
- Planned scope:
  - [x] Add concise in-UI messaging for reconnecting/disconnected/error states.
  - [x] Distinguish user-action errors from network/system errors.
  - [x] Ensure recovery steps are visible and actionable in-context.
  - [x] Validate no critical state is hidden behind dev-only surfaces.

**Note:** Main WebSocket can be remounted via **Reconnect** (epoch); offline banner shows endpoint URL; server errors use heuristic categories (action / room-session / system) with dismiss; blocked sends while disconnected surface a client notice (not dev-log-only).

## Chunk 13 - Session Onboarding and Recovery UX
- Goal: make first-time join and mid-session recovery smoother for non-technical players.
- Planned scope:
  - [x] Improve first-join guidance (seat, start, action expectations).
  - [x] Clarify host/non-host controls and responsibilities.
  - [x] Add stronger seat reclaim/rejoin guidance after refresh/disconnect.
  - [x] Validate complete "friend joins and plays" flow with minimal explanation.

**Note:** Added an always-visible “Join and rejoin guide” in `Table Controls` with seat-state summary, action expectations, host-role clarity, and one-click rejoin actions (quick mode P1/P2 or preferred seat in custom mode).

