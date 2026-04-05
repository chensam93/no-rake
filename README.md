# No Rake

Play-chip Texas hold’em for private tables (friends/family). Not real money; **no rake** as in no host cut—social stakes only. Target capabilities include room links, auto top-off, and configurable bet sizing. **Status:** pre-MVP / scaffold not landed yet.

## Stack

TBD.

## Development model

Implementation (source, tests, CI, most docs) is **LLM-generated under maintainer direction** (Cursor and similar). The maintainer sets product behavior, accepts or rejects changes, runs deploys, and holds secrets. **Third parties should review before relying on this codebase.**

| Responsibility | Maintainer | Coding agent |
|----------------|------------|----------------|
| Product rules, UX intent, poker semantics | Yes | — |
| Code, configs, boilerplate, most README text | Rare direct edits | Primary |
| Local run, hosting, env vars, production checks | Yes | Suggests only |
| Security and correctness validation | Maintainer | No guarantee |

Revise this section if the split changes materially.

**Snapshot (2026-04-04):** No application code committed yet. README only. Tooling: Cursor. Code review: minimal.

## License

TBD.
