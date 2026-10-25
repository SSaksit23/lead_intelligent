# GO365 Lead Intelligence — Foundation + follow-up workspace

A separate owner-only application built with Next.js, TypeScript, Drizzle migrations and Postgres. Import CRM spreadsheets, inspect profiles and travel history, review duplicate identities, add notes and export the filtered people list. Existing Tour CRM and AI Marketing Team applications are unchanged.

## Database connection

GO365 stores application records in Postgres. Set `DATABASE_URL` in the ignored `.env` file; use `MIGRATION_DATABASE_URL` for a direct migration connection when the runtime URL is pooled. Keep any operational source database separate from the GO365 application database. Sessions are not copied during a database move.

To import **new** operational customer or group pairs later, run `scripts/sync-operational-neon.ts` with `OPERATIONAL_DATABASE_URL` set to the source `neondb` connection and `OPERATIONAL_SYNC_CONFIRM=IMPORT`. It selects only customer names, phone, birth date, gender, agency, remark and group trip metadata; passport and citizen ID fields are excluded. The sync is additive: existing customer/group pairs are skipped, while corrections to an existing source row require explicit review and a later update workflow. It does not provide live replication. Keep the source connection credential out of `.env` and command output.

Local development Postgres is supported. Store backups outside version control and protect them under your retention policy. Original uploaded files remain under restricted `storage/` and follow a seven-day cleanup schedule. A hosted deployment needs an external restricted file store before imports can run there.

The next release adds a Thai-first follow-up queue, inbound LINE webhook, evidence-based dashboard and funnel, and owner-defined AI segments. The interface uses the locally served Noto Sans Thai font (SIL Open Font License in `public/fonts/OFL.txt`). No outbound LINE messages are sent.

## Customer connection graph

The Dashboard and each customer profile show a bounded graph projected from GO365 records, including imported operational Neon source rows. Node types are person, trip, agency name, import file, and approved or manually assigned segment. Select a node to inspect each edge and its source row or membership evidence; select a person on the same trip to open their profile. The graph intentionally does not infer family, friendship, or identity from a shared phone, name, agency, or trip. The authenticated `GET /api/people/:id/graph` endpoint is tenant scoped and returns a limited neighborhood for interactive use.

## Start locally (PowerShell)

Requires Node.js 22.14+ (Node 24 tested) and either Docker Desktop or the supplied native development Postgres runner.

```powershell
Set-Location 'path\to\lead-intelligence'
npm ci
Copy-Item .env.example .env  # first setup only; do not overwrite an existing .env
docker compose up -d
```

If Docker's engine is unavailable, run `npm run db:local` in a separate terminal instead. It starts real Postgres on the local address in `.env`, stores its development cluster under `storage/local-postgres`, and stops with Ctrl+C. Do not run both database options on the same port. Native Postgres is development/test tooling, not the hosted deployment method.

Then apply migrations and create your administrator. There is no default username/password and no public registration. Setup refuses to create another account after the first exists.

```powershell
npm run db:migrate
$env:ADMIN_USERNAME = Read-Host 'Administrator username'
$adminSecure = Read-Host 'Administrator password (14–256 characters)' -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecure).Password
try { npm run setup } finally {
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:ADMIN_USERNAME -ErrorAction SilentlyContinue
  Remove-Variable adminSecure -ErrorAction SilentlyContinue
}
npm run dev
```

Open [the local workspace](http://127.0.0.1:3000). In another terminal in this project run:

```powershell
npm run worker
```

`next dev` reads `.env`; CLI scripts use Node's `--env-file=.env`. Set `APP_ORIGIN` to the exact browser origin. `localhost` and `127.0.0.1` are different origins: use the URL above or change the configuration consistently.

## First import

Synthetic examples are provided in `samples/go365-synthetic.csv`, `.xls` and `.xlsx`. Regenerate with `npm run fixtures`.

To populate a **local** workspace for inspection after creating the owner account, run this once. It only accepts a loopback database and returns the existing result if repeated.

```powershell
$env:DEMO_SEED = 'true'
try { npm run seed:demo; npm run seed:line-demo } finally { Remove-Item Env:DEMO_SEED -ErrorAction SilentlyContinue }
```

1. Sign in; Thai is the initial language and the top-right button switches to English.
2. Open Imports, choose a file and keep the same **source namespace** for exports from the same CRM.
3. Select the sheet/header, inspect sample values, and explicitly map permitted columns. Header suggestions are exact Thai/English synonyms adapted from Tour CRM; unfamiliar headers are never silently guessed.
4. Validate the mapping. Review valid, invalid and potentially duplicate row counts; download the error CSV if needed. Changing a mapping requires another validation before confirmation.
5. Confirm valid rows. The worker processes them durably; the screen refreshes while queued/processing. Failed imports can be retried without repeating completed rows.
6. Open People or Duplicate review. A phone alone, a name-only match or conflicting identifiers requires review. Merge and rejection require a reason. Reverse a merge from the profile's merge history.
7. Open Follow-up tasks to inspect the synthetic LINE inquiry. Mark it done or reopen it. Add a manual task with an optional due date from any profile.

## LINE intake

Set `LINE_CHANNEL_SECRET` and `LINE_DESTINATION_ID` in `.env` from your LINE Developers Messaging API channel. Provide a public HTTPS endpoint at `POST https://YOUR_HOST/api/line/webhook` and enable webhooks in LINE Developers. The localhost URL is only for the local preview. The webhook verifies the HMAC signature against the exact request bytes before parsing, checks the destination, and records each `webhookEventId` once. The worker processes accepted events and retries interrupted work. Text messages create a reply task. Follow, unfollow and postback events appear in the timeline; the app sends no replies.

LINE user IDs create separate contact profiles. The app does not assume a LINE user and CRM customer are the same person. On a profile, search for a known person, confirm the match and record a reason to link them. The link is reversible in merge history. The synthetic demo uses a distinct demo destination and does not indicate a real LINE connection.

## Dashboard, funnel and AI segments

The Dashboard shows people, open follow-ups, pending segment proposals, stage counts and segment membership counts. Funnel stages come from recorded events: identified people are **Aware**, a LINE enquiry moves them to **Interested**, and a LINE enquiry without newer message/note activity for 30 days is **Dormant**. **Quoted** and **Booked** require their own verified events; spreadsheet trip participation is never treated as a booking. The current release does not infer **Qualified**, revenue, margin, CLV or payment from incomplete exports, so those stage counts remain zero until their source data exists.

You can define segments in Thai or English, manually assign them from a profile, and remove assignments. AI classification is an optional worker job requested from a profile and then queued on new LINE messages or notes. It now uses the OpenAI Responses API with `store:false`. Set `OPENAI_API_KEY` in the server-only `.env`, set `AI_SEGMENT_ENABLED=true`, and restart the worker and web app. A ChatGPT subscription does not supply an API key to this standalone app. The worker sends at most 20 recent text events per person and the owner-written segment definitions; email addresses and likely phone numbers are redacted. Free text may still contain personal details. Model output is a proposal, checked against an exact evidence quote and shown for owner approval before membership changes. Every run and decision is recorded; a failed run remains visible. The default model is `gpt-5-mini` and can be changed with `OPENAI_MODEL`.

On Windows, run `powershell -File scripts/configure-openai.ps1` from the project folder to enter a key with hidden input. The script stores the key under local AppData, outside the project, and puts only that file path in `.env`. Restart GO365's web process and worker afterward. Do not paste an API key into chat or put it in client-side code.

The AI Segments screen also previews cohorts found by mutual k-nearest neighbors (`k=3`) from recorded trips, LINE messages and open tasks. When OpenAI is configured, the owner can create discovered segments: the app computes membership locally and sends only aggregate cohort summaries and frequently shared tour labels to OpenAI for names and short descriptions. It records the model and cohort key in the audit log and skips the same cohort on later runs. This is descriptive grouping, not a prediction of value, payment, age, gender or identity.

The current app stores B2C people and agency references. Adding B2B agency accounts requires a separate schema and import workflow; sales report bookings are not imported.

The synthetic demo creates two `· demo` segment definitions and one explicitly demo-assigned membership so the screens can be inspected without a model key. This is not an AI classification. Real model inference has not been validated until a key and permitted test data are supplied.

Limits: 10 MB, 10,000 data rows, 100 columns, 20 sheets, 5,000 characters per cell; header selection is within the first 40 rows. Preview displays up to 200 validated rows; counts include all rows. Dates accept `YYYY-MM-DD` or day-first `DD/MM/YYYY`; Buddhist years are normalized. Missing dates and dashes remain unknown. Preserve contact IDs and leading zeroes as text in Excel.

**Passenger-list fields:** mapping version 2 accepts birth date (`d.o.b.`), gender (`sex`), agency name (`agency`) and remark (`remark อื่นๆ`). `M`/`F`, male/female and ชาย/หญิง normalize to controlled values; a nonempty unrecognized value or impossible birth date is flagged before confirmation. The full agency cell remains in source provenance. For a clear `code // UPPERCASE NAME` pattern, the name is extracted; mixed or unfamiliar formats stay unknown rather than guessed. Birth date, gender and agency name are available on the person profile and CSV export. Remarks remain tied to their original import row and timeline; the people export labels its remark column `latest_remark`. National ID and passport columns remain excluded. The model segmentation worker does not send imported remarks to the model.

Re-uploading byte-identical files returns the original batch, even with a different filename. A revised export is a new batch. Source customer IDs are namespaced by the selected source. Exact, nonconflicting source IDs can link automatically; email plus matching name can also link. Shared phone/name candidates remain separate until reviewed. Agency codes never identify a person automatically.

## Safety and data behavior

- Session secrets are random, hashed in Postgres, HttpOnly, SameSite=Strict, and expire after eight hours. Passwords use salted scrypt. A durable global owner-login limiter allows ten attempts per 15-minute window.
- All owner APIs require authentication except login. The LINE webhook is authenticated by its channel signature. Owner mutations require the configured Origin. Tenant scope is applied in every user-facing data operation.
- Uploaded originals live outside `public/`, under `STORAGE_DIR`. The worker removes them after seven days, checks retention each minute, and cleans expired sessions. Keep the worker running for cleanup.
- Normal processing appends imported timeline events. A row's processing and its associated records commit together; the durable job is created in the same transaction as import confirmation.
- Merge decisions link records without rewriting imported events. A source with active merged children cannot itself merge; reverse those merges first. This keeps reversal deterministic.
- Deleting a profile also deletes its merged members, identities, sources, participation, notes/events, related reviews/merges and retained original files. Its staged rows are scrubbed. Related active imports must finish before deletion. Export audit filter details are cleared to avoid retaining search PII. A later deliberately imported, changed export can recreate data.
- Downloaded CSVs and prior backups are external copies: delete them according to your retention policy. Backups must be protected and reconciled with deletion actions before any recovery to service.
- CSV exports share the people query and sorting, use UTF-8 BOM and neutralize spreadsheet formulas. Notes record the authenticated author and system timestamp.
- Travel history indicates participation only. The foundation does not infer booking/payment status, financial value or lead quality.

## APIs and contracts

All APIs are under `/api`, with JSON errors and `Cache-Control: no-store`. Request bodies follow `src/lib/contracts.ts`; new mappings use version 2, while existing version 1 imports remain readable. Browser mutations send Origin automatically.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Username/password login; session cookie |
| GET / POST | `/auth/me`, `/auth/logout` | Current owner / invalidate session |
| GET | `/overview` | Counts and recent imports |
| GET / POST | `/imports` | List batches / multipart upload (`file`, `source`) |
| GET | `/imports/:id` | Batch, job, validated row preview and sheet suggestions |
| POST | `/imports/:id/mapping` | `{version:1,sheet,headerRow,columns}`; zero-based indices |
| POST | `/imports/:id/confirm`, `/imports/:id/retry` | Durable acceptance / retry failed work |
| GET | `/imports/:id/errors` | Invalid row number and field errors as CSV |
| GET | `/people?q=&agency=&source=` | Search name/phone/email, agency substring, exact source |
| GET / DELETE | `/people/:id` | Profile / delete with `{confirm:"DELETE"}` |
| POST | `/people/:id/link` | Link to `{targetId,reason}` after owner confirmation |
| GET / POST | `/tasks` | List tasks / create `{personId,title,dueAt?}` |
| POST | `/tasks/:id` | Set `{status:"open"|"done"}` |
| POST | `/line/webhook` | Signed inbound LINE webhook; public endpoint |
| GET | `/dashboard` | Stage and segment counts with person-level funnel evidence |
| GET / POST | `/segments` | Definitions, proposals and runs / create owner definition |
| POST | `/people/:id/segment-run` | Queue optional AI classification |
| POST | `/people/:id/segments` | Manually assign `{segmentId}` |
| POST | `/segments/:proposalId/decision` | Owner approve or reject a model proposal |
| DELETE | `/memberships/:id` | Close a current membership |
| POST | `/people/:id/notes` | Authored note `{body}` |
| GET / POST | `/reviews`, `/reviews/:id` | Queue / `{action:"merge"|"reject",targetId?,reason}` |
| POST | `/merges/:id/reverse` | Reverse an active merge |
| GET | `/export/people?q=&agency=&source=` | CSV using the screen's query |

## Verification

```powershell
npm run typecheck
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:browser
```

Integration and browser tests create their own disposable native Postgres clusters with generated test credentials and synthetic records. They do not use your `.env` database or real credentials. They require permission to start native processes; Windows sandbox restrictions may require running from a normal terminal. Browser tests use port 3105 and leave screenshots in `test-results/`.

Verified during implementation: eight unit tests; real Postgres migration rerun, interrupted-row resume, idempotency, review/merge/reversal/rejection, notes, API authorization/session expiry, tenant isolation, CSV parity, retention deletion, logical restore and profile deletion; production build; browser login, language switch, XLSX intake through worker completion, profile note, shared-phone rejection, desktop/mobile screenshots. See `docs/VALIDATION.md` for final evidence and outstanding pilot checks.

## Backup and recovery

Pause imports during an operational recovery. Create a private logical snapshot:

```powershell
npm run backup -- create backups/go365-private.json
```

This captures a consistent transaction snapshot of application data, source provenance and audit. It deliberately excludes sessions, login-limit state and short-lived original files. It contains customer data and password hashes: restrict access and encrypt backups at rest through your storage system.

To rehearse recovery, point `.env`'s `DATABASE_URL` at an **isolated empty database**, migrate it, and restore:

```powershell
npm run db:migrate
$env:RESTORE_CONFIRM = 'EMPTY_DATABASE'
try { npm run backup -- restore backups/go365-private.json }
finally { Remove-Item Env:RESTORE_CONFIRM -ErrorAction SilentlyContinue }
```

Restore refuses a non-empty application database and commits atomically. Processing leases are reset for resume. Sign in again after recovery; sessions are not restored. Compare people/import/event counts and a representative profile before enabling the web/worker. Reapply deletions that occurred after the backup. For a hosted pilot, also rehearse provider-level restore or `pg_dump`/`pg_restore` against your chosen Postgres service; this implementation verified application-level logical recovery.

## Hosted pilot and Neon gate

The app was first implemented and tested locally. Configure an isolated database for validation before a hosted pilot. The administrator is created by the setup command.

Before a hosted pilot:

1. Configure an isolated Neon database/branch and rerun migrations, representative import/retry, query parity and recovery with approved sample data. Native Postgres tests are not a substitute for this environment check.
2. Deploy web and worker as separate supervised processes; use TLS, `COOKIE_SECURE=true`, the exact HTTPS `APP_ORIGIN`, and private persistent `STORAGE_DIR`. Install production dependencies with `npm ci --omit=dev`; run migrations in the build/release stage where development tooling is available.
3. Put nginx in front with a request-body limit of 11 MB. Bind Next to loopback; restrict OS/database credentials and storage permissions. `mode` flags on files do not configure Windows ACLs: restrict the storage directory to the service account yourself on Windows.
4. Run secure administrator setup, then smoke-test login, import, review, export, deletion and restart recovery. Reconcile source and imported counts with a real sanitized CRM export.
5. Monitor failed jobs, job age and the worker process. The UI exposes job status, attempts and safe failure messages through the batch API; raw database errors/customer content are not written into routine logs.

Representative real-export UAT remains a release gate. Optional AI segment runs and inbound LINE intake are available when configured; there are no quotations or outbound messages.

## Reuse and engineering notes

Tour CRM's header vocabulary, first/last-name mapping, contact normalization and duplicate-review workflow informed the TypeScript importer. Its customer CSV is exercised as a regression fixture. Passport/national-ID fields and the legacy lead score are not ported. Marketing Team informed the evidence/provenance and human-decision boundary; no runtime marketing dependency was introduced.

Schema lives in `src/db/schema.ts`; generated migrations and snapshots are committed under `drizzle/`. User-data repositories use parameterized postgres-js transactions. Drizzle's migration client is isolated because Drizzle customizes JSON serialization. The durable jobs table acts as the transactional outbox: leases expire after five minutes, work commits per row, and failed jobs require an operator retry. Only one worker needs to run for this release.

Webpack is selected explicitly to avoid Windows/OneDrive junction failures encountered with Turbopack. Production dependencies were checked with `npm audit --omit=dev`; SheetJS comes from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). Keep the lockfile and review package updates before rollout.
