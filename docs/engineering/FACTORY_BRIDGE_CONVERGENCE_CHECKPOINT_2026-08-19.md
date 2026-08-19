# Factory Bridge Convergence Checkpoint — 2026-08-19

## Decision

The eight non-website Factory bridge rows in the authoritative backlog are closed at the local product boundary. No bridge takes ownership from W73, creates a universal asset database, starts Factory implicitly, or grants publication authority.

Mobile approval is terminally classified as `LOCAL_ENVELOPE_COMPLETE / CONDITIONAL_MOBILE_CLIENT`: the desktop creates a validated, expiring, replay-safe approval envelope, but the absent Android/iOS field client is not represented as working.

## Closure matrix

| Backlog row | Result | Product evidence | Boundary |
|---|---|---|---|
| Artifact dual state | LANDED | Factory editor writes `工件修订台账.ndjson`, emits a readable diff card and changes the prior review state to `RE_REVIEW_REQUIRED` | A save never approves its own revision |
| Human/AI locked-bible coauthoring | LANDED | Pending AI proposal and an intervening human edit become a three-way conflict card; human may preserve the manual version or explicitly accept AI | No automatic overwrite or silent merge |
| Feed anywhere into Factory | LANDED | Global/ribbon/editor/file-tree command imports the selected asset as a W74-compatible material envelope | `automaticStart=false`, `executionAuthorized=false` |
| Dashboard number drill-down | LANDED | All seven health metrics plus monthly usage/quota cards open the closest source artifact or original `工厂群.md` / cost ledger | Aggregates are navigation, not new facts |
| Mobile approval | CONDITIONAL TERMINAL | Local request schema validates digest, expiry, replay and `human:*` Authority; Desk writes `手机审批包.json` | `fieldClientAvailable=false`, `CONDITIONAL_MOBILE_CLIENT` |
| Universal drag / workshop card to block reference | LANDED | Artifact buttons export `application/x-mazz-live-reference`; Markdown inserts W63 `{{ref:asset!anchor}}` syntax | The artifact is referenced, never copied; no universal model |
| Async instruction mailbox L0–L3 | LANDED | L0 chat, L1 clarification, L2 review/legislation and L3 explicit dispatch share the existing command gate | `automaticExecution=false`; L3 requires the user submission that dispatches it |
| Usage actual / estimate / settlement / monthly reconciliation / quota gray state | LANDED | Provider non-stream and compatible SSE usage are captured as `provider-reported`; W68 estimate, manual settled actual and unknown remain separate; monthly view exposes variance and quota | Unknown is never zero, tokens are never currency, absent quota is gray |

## Changed surfaces

- `renderer/modules/factory/bridge-runtime.js`: deterministic bridge schemas, validation and fail-closed decisions.
- `renderer/modules/factory/index.js`: global material intake, Provider usage capture, revision ledger and forced re-review.
- `renderer/modules/factory/desk.js`: conflict cards, L0–L3 mailbox, draggable artifact references, metric drill-down, accounting view and mobile envelope.
- `renderer/modules/markdown/index.js`: native W63 live-reference drop handling.
- `main/factory-sse.js`, `main/main.js`, `preload/bridge.js`: Provider-reported token usage evidence without changing chat return values.

## Verification

- `npm run build` — PASS.
- `node tests/contract/factory-bridge-convergence.test.mjs` — 8/8 PASS.
- `node tests/unit/factory-sse.test.mjs` — 7/7 PASS after adding Provider usage coverage.
- W68c, W73f and W63/W75 adjacent contracts — PASS.
- `node tests/e2e/factory-bridge-convergence.mjs` — PASS in real Electron:
  - feed envelope found; automatic execution false;
  - artifact revision ledger written and review status changed;
  - human/AI conflict surfaced and manual text preserved;
  - mobile client gate remained conditional and unauthorized;
  - live reference inserted into Markdown;
  - 18 drill-down metrics/actions visible;
  - renderer page errors: 0.
  - main-process stdout/stderr captured; fatal/uncaught/type/reference errors: 0;
  - screenshot visually inspected: accounting modal, conflict/review cards and the honest `CONDITIONAL_MOBILE_CLIENT` card are readable and unobstructed.
- Final repository suite after convergence fixes: `217/217` test files PASS.

Machine evidence: [`evidence/FACTORY_BRIDGE_RUNTIME.json`](./evidence/FACTORY_BRIDGE_RUNTIME.json) and [`evidence/FACTORY_BRIDGE_RUNTIME.png`](./evidence/FACTORY_BRIDGE_RUNTIME.png).

## Remaining external gates

These are not local code backlog and must not be rewritten as PASS:

- a real Mobile client build, signed package, device and store acceptance;
- Claude Code authentication and live session, deferred by the maintainer;
- a real Blender installation and real `.blend` lifecycle;
- code signing certificate, cross-machine/physical-device matrices and W86 independent field-safety review;
- W69 website/publication/marketplace/payment/account/public distribution surfaces, explicitly excluded from this convergence.
