# No Rake

## How this repo was built (human vs AI)

**Blunt version:** Expect **nearly all—or all—of the code, config, and docs** in this repository to be **authored by AI coding agents** (Cursor, etc.). The human maintainer’s job is mainly **direction**: goals, constraints, taste, “yes/no” on behavior, and occasional manual fixes. If you use or fork this project, treat it like **untrusted AI output** until you have reviewed it yourself.

**Granular split (typical; not a legal claim—just how we work):**

| Area | Human | AI agent |
|------|--------|----------|
| What to build, priorities, poker rules intent | Primary | — |
| Architecture / stack *suggestions* and tradeoffs | Guided (human picks or approves) | Often drafted first |
| Source code, tests, scripts, CI config, boilerplate | Rare direct edits | **Almost always** |
| README, comments, commit messages unless noted | Mostly drafted by AI; human may tweak | **Mostly** |
| Running the app locally, production deploy, secrets | Human must do real-world steps | May propose commands |
| Security / correctness | Human responsible for *verifying* | No warranty |

**Living document:** This section is meant to stay honest as the project grows. When something meaningful changes (e.g. you write a subsystem by hand, or ship v1), **edit the snapshot below** and bump the date.

**Snapshot — 2026-04-04**

- **Lines of production code written by hand by a human (estimate):** ~0% so far (README wording may be human-tweaked; code: none yet).
- **Primary agent/tooling:** Cursor (and similar) with the maintainer prompting and accepting edits.
- **Review habit:** Light by default; assume gaps.

---

Virtual, **no real-money** Texas hold’em for private home games with friends and family: room links, play chips, and tooling improvements over typical free tables (e.g. auto top-off, custom bet sizing—planned as development continues).

**Status:** Early / pet project. Not intended as a polished consumer product yet.

## Name

- **Display name:** No Rake  
- **Repository & package slug:** `no-rake`

“No rake” means the host isn’t taking a cut—this is social poker, not a house game.

## License

TBD.
