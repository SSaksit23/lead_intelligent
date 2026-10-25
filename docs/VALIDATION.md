# Foundation validation

25 October 2026 · initial foundation validation with synthetic local data

| Check | Result |
|---|---|
| TypeScript strict checking | Passed |
| Normalization, mapping ambiguity, Thai CSV/XLS/XLSX, CRM sample, identity, CSV safety and passwords | 8 unit tests passed |
| Real Postgres migration install and rerun | Passed using disposable native Postgres 18 |
| Crash after first committed row, job resume and repeated confirmation | Passed; no duplicated timeline rows |
| Shared-phone review, merge, reversal, rejection, authored note, unknown business date | Passed |
| Authenticated endpoints, expired sessions, cross-origin rejection and tenant isolation | Passed |
| Filtered screen/export parity | Passed |
| Seven-day original deletion and profile personal-data deletion | Passed |
| Logical snapshot restored to a separate empty Postgres database | Passed; counts reconciled and non-empty restore refused |
| Next.js production build | Passed using webpack |
| Headless browser acceptance | Passed: login, language switch, XLSX upload/preview/mapping/confirmation, worker completion, profile/note, duplicate rejection and overview |
| Desktop/mobile render | Captured in `test-results/`; inspected during implementation |
| Production dependency audit | Zero reported advisories at implementation check |

## Required before a hosted pilot

- Validate the same flow against an isolated Neon environment and the intended service account/storage configuration.
- Reconcile representative approved real CRM exports, especially source-ID semantics, formatted numeric phones and unusual namelist layouts. Unknown headers require manual mapping.
- Set up HTTPS, secure cookies, database and file permissions, persistent supervised worker/web processes, backup storage and retention.
- Exercise provider-level recovery and establish measured recovery objectives at the intended data volume.
- Complete owner UAT and set operational monitoring for job failures/age and source reconciliation.

Docker Desktop's engine was unavailable during initial implementation. Native Postgres provided real SQL transaction testing instead. Build/test execution required normal process/filesystem permissions because the Windows sandbox blocked Next build directories and Postgres WAL initialization. This document records the initial foundation checks; later Neon integration and feature checks are documented in the application and its test suite.
