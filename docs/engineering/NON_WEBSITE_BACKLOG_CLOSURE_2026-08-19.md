# Non-website Backlog Closure — 2026-08-19

## Decision

At product freeze `main@dba9f61`, every locally implementable item in the authoritative total table outside W69 website/publication/marketplace/account/payment/public-distribution scope has one terminal classification:

- `LANDED / COMPLETE` for implemented local product and runtime scope;
- `PREVIEW_SETTLED` where the formal product promise is intentionally reduced and visibly labelled;
- `CONDITIONAL_EXTERNAL_GATE` where completion requires a credential, platform, physical device, third-party tool/service or independent human authority that is absent from this repository.

There are no remaining ambiguous `OPEN`, `PARTIAL`, “未确认落地” or “以后再看” rows in the non-website local backlog. This does not convert external facts into fake passes and does not authorize W69.

## Closure ledger

| Domain | Terminal result | Evidence boundary |
|---|---|---|
| W62e continuous feed | COMPLETE | Three source types, health/scheduler/watcher, dimension routing and M0/M1/M2 gates; M2 never starts Factory implicitly |
| W63/W75 addressable evidence | COMPLETE LOCAL | Stable anchors, live references, bidirectional index and explainable retrieval; no universal graph database |
| W64 companion runtime | COMPLETE LOCAL | Explicit Player entry, timing/audio/frame gates, personas, routing, anti-spoiler and archives; external model/long-device soak remains conditional |
| W65 four-site resources | COMPLETE / FORMAL | Four strict adapters, session/pagination/fallback/health/catalog/aggregation/download queue; transient failures now preserve the eligible stale cache |
| W66 Agent Harness | LOCAL FOUNDATION COMPLETE | Kimi + Codex live activation and bidirectional safe handoff passed; Claude is maintainer-deferred, not a hidden local code row |
| W67 memory governance | COMPLETE / FORMAL | Snapshot/delta/budgets/accumulator caps/ResourceLedger/Surface reclamation; 8h and foreign-machine soak remain evidence gates |
| W68/W73 Factory runtime | COMPLETE / SEALED TO SPEC | Production Run, audit/rework, qualification/delegation, scheduler, economics, process assets, recovery and resource ownership |
| W70/W80 cognition and civilization kernels | COMPLETE LOCAL | File-first human authority and deterministic bounded propagation; no cognition/world universal database |
| W72/W74 asset, ingestion, feed and promotion | COMPLETE TO FROZEN SCOPE | Thin envelopes, provenance, external-tool protocol, materials and human-only promotion; publication excluded |
| W76–W78 multi-parent/shadow/multimodal | COMPLETE LOCAL | Node/Placement split, human promotion and addressable EPUB/PDF/media evidence |
| W79 external tool runtime | LOCAL RUNTIME COMPLETE | Sandboxed Blender adapter contract, packaged unavailable gate and lifecycle; real Blender run is `CONDITIONAL_TOOL_NOT_INSTALLED` |
| W81 operational history | COMPLETE LOCAL | Strict event ledger, episodes, recollection, lifecycle/retention and three pilot producers |
| W82a–h organizational compiler | COMPLETE LOCAL | Eight local slices, workflow library and intent UX; W69m public projection excluded |
| W83 danmaku | COMPLETE LOCAL | Media-clock scheduler, bounded Canvas runtime and local/AI tracks; W69 public event projection excluded |
| W84 production assets | COMPLETE LOCAL | Inspect-only envelope, profiles, migration/fork/signature/encryption/rights/sealed capability; marketplace excluded |
| W85 context/coverage | COMPLETE LOCAL | Addressable packages, supersession, zero silent obligation loss and Harness injection |
| W86a–d physical-production safety preconditions | COMPLETE SIMULATION/READ-ONLY | Safety Kernel, offline evidence and shadow planning produce zero controller commands/device writes; W86e stays external |
| Factory eight bridge rows | CLOSED | Revision/re-review, three-way Bible conflict, feed-anywhere, drill-down, mobile envelope, live-reference drag, L0–L3 mailbox and usage reconciliation |
| OCR / Archive | FORMAL | Cancellation/budget/security/recovery gates landed |
| Recorder / Plugins | PREVIEW_SETTLED | Honest capability/trust boundaries and cleanup landed; hardware matrix/process sandbox/signing are not claimed |
| Mobile / Updater | HIDDEN / CONDITIONAL | Local shells/contracts/security checks settled; native builds, stores, live signed feed and rollback need external infrastructure |

## Terminal non-commitments — removed from the active backlog

The following names remain useful design history but are not unfinished product promises. They may only return through a separately approved specification with new evidence; they cannot be revived by relabelling them as convergence debt:

- Task Capsule and SeatPackage: current W73 Run, W85 Context Package, Seat, Qualification, Delegation and AgentRulePack contracts already own the required boundaries.
- Universal Graph / Graph Bus / universal Asset or Event database: rejected in favour of file/asset truth, append-only event evidence and derived pairwise relations.
- Full SurfaceManager migration: rejected without a demonstrated P0/P1 ownership defect and a bounded single-surface proof of benefit.
- A second native declarative drawing engine or Blender UI clone: rejected; Mindmap/Slide/Draw remain product surfaces and external generation stays a W72/W79 Capability.
- A universal calculator/solver, “厂花” product shell, separate Showrunner shell and unified personality super-asset: not current commitments; bounded calculation, personas, doctrine and process assets already have separate owners.
- Human P2P co-watch rooms, Browser whole-series Harvest and additional Agent vendors beyond Kimi/Codex/Claude: archived candidates, not queued work.

This is a scope decision, not a claim that speculative software was implemented. It eliminates ambiguous backlog rows while preserving the design record.

## Final verification

- Build: PASS.
- Repository contracts/unit/roundtrip: `217/217` test files PASS.
- Factory true Electron: feed/revision/conflict/live-reference/dashboard/accounting/mobile envelope PASS; renderer errors `0`; main fatal logs `0`; screenshot visually inspected.
- OSS provenance: `CURRENT`.
- Windows release audit: root notices present, source maps `0`, PDB `0`, ten x64 native binaries staged in `app.asar.unpacked`.
- Packaged smoke: 20 lifecycle cycles for PTY, PanelWindow, WebContentsView, Torrent, Python, Viewer, Factory and Monaco; active resources return to baseline `2`.
- Isolated installer cycle: first install, same-version repair, protocol/file association launch, packaged smoke and silent uninstall PASS; product residue `0`.
- Installer: 133,944,620 bytes; SHA-256 `D9C6F2652A7C9E82EBF2C4C4FB1675C5EDF790A6F57A3F0AD72653F9C9B5F277`.
- `app.asar`: 259,562,374 bytes; SHA-256 `00797A7C48290253F3D1FD02B18AC61FFACE0BFB752F40B5AD9B38DC31B8A5B5`.

## Conditional external gates — not local backlog

1. W69 website/publication/marketplace/account/payment/public distribution: explicitly excluded by the maintainer.
2. Claude Code live authentication/session: `CONDITIONAL_DEFERRED` by maintainer choice.
3. Real Blender `.blend` lifecycle: `CONDITIONAL_TOOL_NOT_INSTALLED`.
4. Android/iOS build, signing, real devices and stores: `CONDITIONAL_PLATFORM_BUILD`.
5. Real updater HTTPS feed, signed old→new specimens, rotation/failure/rollback matrix: `CONDITIONAL_RELEASE_INFRASTRUCTURE`.
6. Public Windows code-signing certificate and reputation chain: `CONDITIONAL_SIGNING_CREDENTIAL`.
7. Foreign-machine/RDP/DPI/media-device/long-soak matrices: `CONDITIONAL_PHYSICAL_TEST_ENVIRONMENT`.
8. W86e independent regulatory/field-safety review: `CONDITIONAL_EXTERNAL_SAFETY_REVIEW`; no software test may waive it.

Historical checkpoints retain the truth of what was open at their own commit. Current status is governed by this closure ledger, the plan index and the external authoritative total table.
