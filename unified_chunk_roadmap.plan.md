---
name: unified chunk roadmap (workspace copy)
overview: "Workspace-local copy of the active roadmap so links open correctly from chat and editor."
todos:
  - id: chunk1-rules-correctness
    content: "Chunk 1: NLH rules correctness"
    status: completed
  - id: chunk2-deterministic-tests
    content: "Chunk 2: Deterministic rule test harness"
    status: completed
  - id: chunk3-client-pot-clarity
    content: "Chunk 3: Client hand-state transparency"
    status: completed
  - id: chunk4-server-refactor
    content: "Chunk 4: Server deep refactor"
    status: completed
  - id: chunk5-client-refactor
    content: "Chunk 5: Client deep refactor"
    status: completed
  - id: chunk6-css-cleanup
    content: "Chunk 6: CSS system cleanup"
    status: completed
  - id: chunk7-stability-pass
    content: "Chunk 7: Stability and playtest hardening"
    status: completed
  - id: chunk8-deploy-readiness
    content: "Chunk 8: Deploy readiness"
    status: completed
isProject: false
---

# Unified Execution Roadmap

This is the readable working tracker. The top `todos` block stays compact for tooling. Detailed progress is tracked below.
Execution rule: strict sequential gating. Only the active chunk is counted as progress.

## Completion Snapshot
- Status: all 8 chunks completed in sequence.
- Scope delivered: rules correctness, deterministic tests, client clarity, server/client refactors, CSS cleanup, stability pass, and deploy runbook.
- Verification baseline:
  - server rules checks pass via `npm run test:rules -w server`
  - client bot decision check passes via `npm run test:bot-decision -w client`
  - health check returns `200` at `/health`

## Residual Risks
- Runtime state is still in-memory; server restart clears active room state.
- No full browser E2E automation yet; hardening relies on deterministic scripts + manual smoke flows.
- Deploy target is still private/home-game scale, not hardened for public multi-tenant traffic.

## Chunk 1 - NLH Rules Correctness
- Goal: finalize all-in behavior, side-pot resolution, and action-eligibility runout.
- Progress:
  - [x] Short-stack all-in call behavior verified.
  - [x] Preflop pending action initialization fixed for blinds.
  - [x] Add assertion for short all-in raise reopening behavior.
  - [x] Verify folded-seat side-pot eligibility edge case.

## Chunk 2 - Deterministic Rule Test Harness
- Goal: make payout/rules checks repeatable and assertion-based.
- Progress:
  - [x] Simulation upgraded to deterministic wait/assert flow.
  - [x] Multi-way side-pot amount + eligibility assertions added.
  - [x] Add split-pot + odd-chip assertion case.
  - [x] Add fold-before-showdown side-pot eligibility case.

## Chunk 3 - Hand-State Transparency (Client)
- Goal: make main/side pot state obvious at a glance.
- Progress:
  - [x] Compact main/side pot summary line added.
  - [x] Advanced detail view added for eligibility/winners.
  - [x] Copy polish for all-in/no-action streets.
  - [x] Readability pass in compact and comfort density.

## Chunk 4 - Server Deep Refactor
- Goal: reduce monolith size while preserving behavior.
- Progress:
  - [x] Hand evaluator extracted to module.
  - [x] Pot resolution extracted to module.
  - [x] Extract action validation/execution module.
  - [x] Extract round progression/transition module.

## Chunk 5 - Client Deep Refactor
- Goal: split `App.jsx` into focused components/hooks.
- Progress:
  - [x] Extract socket/session hook.
  - [x] Extract board/seats/table components.
  - [x] Extract hand-status subcomponent from action dock.
  - [x] Extract pot-clarity subcomponent from action dock.
  - [x] Extract advanced hand-context subcomponent from action dock.
  - [x] Extract action dock controls component (action buttons + slider).
  - [x] Isolate derived selectors from render.

## Chunk 6 - CSS System Cleanup
- Goal: make styles layered and maintainable.
- Progress:
  - [x] Reorganize CSS by concern.
  - [x] Remove stale/duplicate rules.
  - [x] Normalize naming.
  - [x] Fix responsive collisions.

## Chunk 7 - Stability + Playtest Hardening
- Goal: detect and fix regressions after refactors.
- Progress:
  - [x] Run deterministic suite and record output.
  - [x] Manual 2-player and 3-player representative sessions.
  - [x] Validate bot auto and step mode behavior.
  - [x] Fix regressions and rerun checks.

## Chunk 8 - Deploy Readiness
- Goal: make deploy/setup and operations repeatable.
- Progress:
  - [x] Finalize runtime config/env docs.
  - [x] Write troubleshooting runbook.
  - [x] Verify end-to-end deploy rehearsal.
  - [x] Define post-deploy sanity checklist.

