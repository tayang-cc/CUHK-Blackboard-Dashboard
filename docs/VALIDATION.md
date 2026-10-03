# Validation record — lms-cli

## 0.4.7 release preflight (resumable downloads, installer lookups) — 2026-10-04

Environment: macOS arm64, Node.js v25.7.0, fresh clone of `main` at the v0.4.6 release commit plus the changes below, developed on a branch and merged only after CI passed. Version metadata is aligned across the package, lockfile, CLI, Codex plugin and Claude Code plugin. Runtime changes: `src/upgrade.ts` (`download`), `install.sh` (`lms_fetch`) and `install.ps1` (latest-version lookup).

Motivation: 0.4.6 removed the fixed 180 s limit of `lms update`, but a connection reset still restarted the whole 176 MB download, and `install.sh` still ran every download under `curl --max-time 180`, which cannot finish the archive on a slow link (about 0.5 MB/s was measured on the test machine). `install.ps1` still resolved the latest version through the anonymous REST API.

- `download`: a network reset, a stall, a 5xx/408/429 answer or a short body is retried up to five times; each retry continues from the bytes on disk with `Range: bytes=N-`. The hash is recomputed over the partial file first. A server that answers 200 to a Range request restarts the file, a 416 or a `Content-Range` that does not start at N discards it. The total budget is shared by all attempts, the first attempt refuses to touch an existing file, an unrequested 206 or other client errors are final, and `Content-Length` is only compared when no `Content-Encoding` is present.
- `install.sh`: `--speed-limit 1024 --speed-time 60 --max-time 1800 -C -` with up to five attempts instead of `--max-time 180`.
- `install.ps1`: `Get-LmsLatestTag` reads the `Location` header of `github.com/zs-andy/lms-cli/releases/latest` through `HttpClient` with auto-redirect off and accepts only an exact stable tag URL; the REST API stays as a fallback.
- TypeScript check, build and **142 automated tests** passed locally (140 passed, 2 Windows-only tests skipped on macOS, none failed). New: ten resume tests (reset, stall, short body, ignored Range, 416, wrong Content-Range, Range kept across the CDN redirect, 5xx versus final errors, attempt limit, shared time budget, existing-file and size-cap guards), four `install.sh` download tests with a fake `curl`, and three `install.ps1` tests. As mutation checks, never sending Range fails six tests, not truncating after an ignored Range fails one and skipping the re-hash fails four. Production dependency audit reported **0 known vulnerabilities**. `npm pack --dry-run`: 105 entries.
- Real-network checks: (1) the new `download` fetched the published 176 MB v0.4.6 archive while the first response was cut at 20.0 MB; the second request carried `Range: bytes=20968652-`, the release CDN answered 206, and the final SHA-256 matched the published `SHA256SUMS.txt`. (2) `install.sh` without `--version`, with system curl 8.7.1, resolved the latest tag through github.com, downloaded with the new flags and installed successfully.
- The branch CI run (Verify and build on ubuntu, macOS and Windows) passed before merging. In the Windows job the two `install.ps1` tests were executed, not skipped: the parser accepted exact stable tag URLs and rejected thirteen others, and `Get-LmsLatestTag` resolved the real latest tag.
- Not verified for this version: a real link slower than 180 s end to end (the slow case is covered by simulated streams; the real run above was fast), `install.ps1` resume (not provided) and a full interactive `install.ps1` run without `-Version` outside CI, installers and checksums on the target platforms for this release, and macOS Developer ID signatures with Apple notarization. This preflight record is not evidence that a Release is public.

## 0.4.6 release preflight (slow-network update download) — 2026-10-04

Environment: macOS arm64, Node.js v25.7.0, fresh clone of `main` at the v0.4.5 release commit plus the change below. Version metadata is aligned across the package, lockfile, CLI, Codex plugin and Claude Code plugin. The only runtime change is the downloader in `src/upgrade.ts` (`download`).

Problem: `lms update` aborted every download after a fixed 180 s (`AbortSignal.timeout(180_000)`) and reported the resulting `TimeoutError` as `INTERNAL` ("Operation failed safely"). On the test machine a 20 s sample of the release archive ran at about 0.48 MB/s, so the 176 MB archive needs about six minutes; `lms update --yes` failed repeatedly there while the same archive downloaded fine with a resumable `curl`.

- The download now aborts only when no data has arrived for 60 s, or after 30 minutes in total. Any other failure (network reset, stall, total limit, archive over the size cap) is wrapped in an `LmsError` (`UPDATE_DOWNLOAD_FAILED`) that says the current version is unchanged and points to a manual download plus `install.sh --archive`. The abort signal is also passed to the stream pipeline, so a stalled body is cancelled even if the fetch implementation ignores the signal. URL checks, the trusted-host redirect policy, SHA-256 verification and the activation checks are unchanged.
- TypeScript check, build and **125 automated tests** passed; no failures or skipped tests. Seven are new (`test/download-limits.test.ts`): a slow but steady download longer than the stall limit succeeds with the right hash; a download that goes silent after two chunks is aborted soon after the stall limit with a clear error; a trickling download is stopped by the total limit; a stall while waiting for response headers is aborted; a network reset and an oversized archive map to `UPDATE_DOWNLOAD_FAILED`; the redirect policy is unchanged; the production limits are 60 s / 30 min. As mutation checks, disabling the stall detection fails two tests and rethrowing raw errors fails four. Production dependency audit reported **0 known vulnerabilities**. `npm pack --dry-run`: 104 entries.
- Real-network check: the new `download` fetched the published 176 MB v0.4.5 archive through the github.com to release-CDN redirect and its SHA-256 matched the published `SHA256SUMS.txt`. This run took 117 s because the connection was faster than during the failures, so it did **not** exceed the old 180 s limit; the slower-than-180 s case is covered only by the simulated-stream tests above.
- Not verified for this version: an end-to-end `lms update` across a real link slower than 180 s (releases up to 0.4.5 still carry the old updater, so the first upgrade to 0.4.6 may need a manual offline install on such links), `install.ps1` (unchanged), CI on the versioned commit, target-platform installers and checksums, and macOS Developer ID signatures with Apple notarization. This preflight record is not evidence that a Release is public.

## 0.4.5 release preflight (retry and quota-free installer lookup) — 2026-10-04

Environment: macOS arm64, Node.js v25.7.0, fresh clone of `main` at the v0.4.4 release commit plus the changes below. Version metadata is aligned across the package, lockfile, CLI, Codex plugin and Claude Code plugin. Runtime changes: `src/updates.ts` (retry policy) and `install.sh` (latest-version lookup). `install.ps1` is unchanged.

Motivation: on the test machine a direct Node `fetch` to the github.com release page failed once in twelve attempts with `ECONNRESET` (the other eleven succeeded, median 0.6 s), and one MCP update check in the 0.4.4 acceptance run fell back to the REST API after such a reset. Each fallback spends anonymous REST quota (60 per hour per IP) that shared addresses cannot spare. `install.sh` still asked the REST API for the latest version.

- Update check: a network failure (a `TypeError` from fetch) or an unexpected status on the web pages is retried once before the REST fallback. Timeouts and validation failures (untrusted redirect hosts, foreign repositories, prerelease tags, query strings) are never retried. Four new tests cover the retry, the asset-probe retry, the two-failure fallback, and the no-retry cases; as mutation checks, limiting the loop to one attempt fails three tests and retrying every error fails the no-retry test.
- `install.sh`: without `--version` the latest tag is read from the `Location` header of `github.com/zs-andy/lms-cli/releases/latest` by `lms_latest_tag`, which accepts only an exact `vX.Y.Z` tag URL on this repository over https; the previous REST lookup is kept as a fallback. Three new tests run the function from the script against HTTP/1.1 and HTTP/2 header shapes and fourteen rejected locations. Isolated end-to-end runs with a logging `curl` wrapper: (A) no `--version` resolved v0.4.4 through github.com only, installed and reported 0.4.4 with 0 requests to the REST API; (B) with the web lookup failing the script used the REST API and reached the v0.4.4 download; (C) with both lookups failing it stopped with the existing "No valid stable release found" error and installed nothing.
- TypeScript check, build and **118 automated tests** passed; no failures or skipped tests. Production dependency audit reported **0 known vulnerabilities**. `npm pack --dry-run`: 103 entries.
- Not verified for this version: `install.ps1` (unchanged and untested here), CI on the versioned commit, target-platform installers and checksums, and macOS Developer ID signatures with Apple notarization. This preflight record is not evidence that a Release is public.

## 0.4.4 release preflight (quota-free update check) — 2026-10-03

Environment: macOS arm64, Node.js v25.7.0, fresh clone of `main` at the v0.4.3 release commit plus the update-check change. Version metadata is aligned across the package, lockfile, CLI, Codex plugin and Claude Code plugin. The runtime change is limited to `src/updates.ts` (release lookup) and `src/upgrade.ts` (the downloader now reads the same trusted-host list).

Problem: the update check called the anonymous GitHub REST API, which allows 60 requests per hour per IP. On a shared or heavily used address the quota was exhausted (observed: HTTP 403 with `x-ratelimit-remaining: 0`), so the check reported "unavailable" and the user never saw the notice.

- The check now reads github.com pages first: `/releases/latest` redirects to the newest stable tag (one request when already up to date); only when a newer version exists, the installer for the current platform and `SHA256SUMS.txt` are probed in parallel (a download URL answers 302 when the asset exists and 404 when it does not, and no redirect is followed or file read). The REST API is a fallback only when these pages fail.
- Live check on the test machine while the anonymous API still answered 403: installed 0.4.1 → `available` 0.4.3 with the platform archive and checksum URL after 3 requests (5.6 s on this slow connection, 1.5–4.3 s per request); installed 0.4.3 and 9.9.9 → `current` / `ahead` after 1 request each. No request went to the REST API.
- TypeScript check, build and **111 automated tests** passed; no failures or skipped tests. Seven are new update-source tests: github.com-only lookup without REST requests, single-request up-to-date/ahead states, REST fallback, rejection of foreign hosts / foreign repositories / http / query strings / prerelease and traversal tags / foreign asset redirects (with no request to the untrusted host), missing installer or checksum reported instead of an install offer, and the no-stable-release redirect. The session tests were rewritten for the web source. As a mutation check, disabling the trusted-host validation makes the hostile-redirect test fail. Production dependency audit reported **0 known vulnerabilities** (the first attempt hit a transient registry error and was repeated).
- Not changed and still open: `install.sh` and `install.ps1` resolve the latest version through the anonymous REST API when no version is given. Not yet verified for this version: CI on the versioned commit, target-platform installers and checksums, and macOS Developer ID signatures with Apple notarization. This preflight record is not evidence that a Release is public.

## 0.4.3 release preflight (Claude Code plugin) — 2026-10-03

Environment: macOS arm64, Node.js v25.7.0, fresh clone of `main` at the 0.4.2 release commit plus the Claude Code plugin commit. Version metadata is aligned across the package, lockfile, CLI, Codex plugin and Claude Code plugin. The only runtime source change compared with 0.4.2 is the MCP session update check (`src/updates.ts`): the release request timeout is 6 s instead of 3.5 s, and a failed check is retried after 60 s instead of being cached for the whole session. Before this change a single slow request (observed: about 2.1 s against the 3.5 s limit, two failures in four consecutive MCP calls on the same machine) hid the update notice until the client restarted.

- TypeScript check, build and **104 automated tests** passed; no failures or skipped tests. Seven of them are new: three Claude Code plugin consistency tests (marketplace/plugin/package versions, the MCP command, and that the Codex plugin surface is unchanged) and four session update-check tests (single request per session, shared concurrent request, retry after a transient failure with no requests inside the retry window, and the `LMS_UPDATE_CHECK=0` opt-out). Production dependency audit reported **0 known vulnerabilities**.
- `claude plugin validate` accepted both `.claude-plugin/marketplace.json` and `plugins/lms-cli-claude`. In an isolated Claude Code configuration directory the plugin installed from the repository marketplace as `lms-cli@lms-cli` 0.4.3 and its `lms mcp` server reported connected. No school account, credential or course data was used.
- `npm pack --dry-run --ignore-scripts --json`: 101 entries, no vault data, profiles, environment files or dependency directory. The Claude Code plugin is distributed through the Git marketplace and is intentionally not in the npm tarball.
- Not yet verified for this version: CI on the versioned commit, target-platform installers and checksums, macOS Developer ID signatures with accepted Apple notarization, and the Claude Code plugin against a real school account. This preflight record is not evidence that a Release is public.

## 0.4.2 release preflight — 2026-09-29

Environment: macOS arm64, official checksum-verified Node.js v24.20.0 in an isolated build directory. Version metadata is aligned across the package, lockfile, CLI and plugin.

- TypeScript check, build and **97 automated tests** passed; no failures or skipped tests. Production dependency audit reported **0 known vulnerabilities** at verification time.
- The implementation commit `1a1b33b` passed all three Verify and build jobs (macOS, Ubuntu and Windows), including target-platform bundles and isolated installation checks, in run `36519467569`. The versioned release commit requires its own successful CI run before release publication.
- The local build uses the official development runtime, not the already distributor-signed installed Node binary: Hardened Runtime correctly refuses to load unrelated development native modules into that signed runtime. No signature or system security setting was disabled to run the source tests.
- Release artifacts must be built from the versioned source, match their SHA-256 entries, and pass installation checks. macOS distributables require Developer ID signatures and accepted Apple notarization. Artifact-specific results are recorded with the GitHub Release; this preflight record is not itself evidence that a new Release is public.

## Experimental school sign-in and Blackboard to-do — local branch, 2026-09-29

Environment: macOS arm64, Node.js v25.7.0. The fixes were ported onto main commit `8933a80`, retaining the 0.4.1 version, school discovery, setup/update behavior, and signed-release workflows. This is source-branch validation, not a newly published release or installer.

- TypeScript check and build: passed. Automated tests: **97 passed, 0 failed, 0 skipped**. Coverage includes opt-in encrypted login preferences, profile/platform/form isolation, split username/password steps, logout revocation, TOTP vectors, and real-to-do window splitting with error propagation.
- `npm run verify:auth`: all four offline Electron suites passed. Synthetic fixtures covered password fill without submission, one-shot automatic login, ADFS school-script buttons, cancellation during pending fill/submit, user takeover, Escape/cancel, popup cleanup, live opt-in/opt-out, compact single-window layout, resizing, origin/form guards, and renderer isolation. No real school credentials or network responses were used for these branch checks.
- `npm pack --dry-run --ignore-scripts --json`: passed; all 100 expected package entries were inspected. Required login preloads, school view, login store and TOTP modules are included; no vault, profiles, environment files or dependency directory is packaged.
- Prior source-worktree PolyU acceptance on the same date identified the Blackboard date-window limit and confirmed that the repaired 30-day look-back plus 14-day forward query returned two real to-do items. That live-school check was not repeated during this branch port; Canvas and other-school compatibility are not certified by the offline checks above.

Remember-password and automatic-login remain experimental and default off. Schools retain their native sign-in pages and authentication policies; CAPTCHA, push MFA and device checks are not bypassed. New signed installers, cross-platform acceptance and a published Release remain separate work.

## 0.4.0 CLI installation, discovery and updates — historical baseline, 2026-09-21

Environment: macOS arm64, Node.js v25.7.0. Tests used temporary state and synthetic profiles; no school credentials or course data were accessed.

- Full TypeScript check and build: passed. This supersedes the full-worktree type-check failure in the historical refactor record below.
- Automated tests: **74 passed, 0 failed, 0 skipped**. Coverage includes public directory boundaries, search timeouts/limits, explicit terminal selection, setup idempotency, multi-account defaults, CLI/MCP discovery, update checks, successful upgrade transactions, checksum and runtime-verification failure, untrusted redirects and rollback.
- Self-contained macOS arm64 CLI bundle: built with checksum-verified official Node and a prepared Electron authorization runtime. Relative framework links are preserved, and all archive entries pass the updater's extraction policy.
- Clean standalone installation: passed with no system Node in PATH and isolated home, school-state and Codex directories. Verified native module loading, no-login setup, offline school search, **17-tool MCP discovery**, real Codex local-plugin registration, repeat registration, rollback and reinstall. No graphical windows were opened.
- Interactive terminal setup: searched the local Chinese school alias, displayed the selected platform URLs/timezone, required explicit confirmation and returned profile-specific continuation commands without login windows.
- Live public Canvas directory search: name search returned institution domains including CityU and PolyU. No returned school domain was contacted and no configuration was saved.
- Public update check: returned `no-release` for the stable channel. Online installer downloads and a real published-version upgrade require matching stable Release assets; mocked-download transaction tests passed locally.
- Production dependency audit: **0 known vulnerabilities** at verification time.
- Agent skill and plugin validators: passed. POSIX installer/launcher syntax, package-content dry run and relative documentation links passed.
- Historical 0.4.0 inspection: the bundled upstream Electron runtime had an ad-hoc linker signature and was not suitable for the stable channel. The signed 0.4.1 process and results are recorded below.

The historical 0.4.0 record did not publish a stable release. Current signed-release validation is recorded below; cross-platform CI, physical Windows/Linux checks and permitted school SSO/MFA remain separate acceptance items. See [ACCEPTANCE.md](ACCEPTANCE.md) and [RELEASING.md](RELEASING.md).

## 0.4.1 signed macOS release candidate — 2026-09-21

Environment: macOS arm64, Node.js v25.7.0, Developer ID Application `Si Yi Lyu (N9DDMY3PQ3)`. No school credentials or course data were accessed.

- TypeScript build and automated tests: **77 passed, 0 failed, 0 skipped**.
- macOS standalone CLI: Node 24.20.0, Electron 44.4.3, native `.node` modules and Electron Framework/Helper code were signed with the same Developer ID identity, Hardened Runtime and Apple timestamps. The archive passed strict signature verification and updater archive checks.
- Apple notarization: standalone CLI submission `b353078c-0c9e-4396-8c0d-16e9cca2842c` returned **Accepted**. SHA-256: `fa18bb3b3c1d8d855638b6f2a1599c4babc5c7dc37efc0f03691cd7a7ebef9d2`.
- Authorization App: signed DMG and ZIP built from the same source. DMG notarization submission `54da178f-b185-4f91-8b06-107c3c18a924` returned **Accepted**; the ticket was stapled and validated with `xcrun stapler validate`, `spctl` and `codesign --verify --deep --strict`.
- The Apple notarization profile is stored in the local Keychain as `lms-cli`; no password or private key is stored in the repository.

The 0.4.1 signed artifacts are ready for a new stable Release after cross-platform assets and release metadata are attached. The existing v0.4.0 preview assets were not overwritten.

## Platform extension refactor — local working tree, 2026-09-21

Environment: macOS arm64, Node.js v25.7.0. This record is local verification, not a new CI run, release or additional institution certification.

- Changed CLI, MCP, worker, authorization and template entry points and their dependency graphs: TypeScript compilation passed.
- Offline tests (`node --import tsx --test test/*.test.ts`): **45 passed, 0 failed, 0 skipped**. Includes all previous checks plus registry ownership/validation, lazy runtime imports, environment cleanup, old vault-path compatibility and a synthetic third-platform registration in an isolated copy. The third-platform test verifies config, CLI, MCP schema, login metadata, source-isolated vault storage and nine overview calls with at most three concurrent reads, without editing core.
- Browser-based authorization-page check at a temporary loopback URL, 1280 × 720: passed using synthetic schools and a mock login bridge. Single/dual-platform selection and the submitted `exchange / blackboard` arguments were verified. No school login, remote content or real credentials were used. The rendered application had no errors or horizontal overflow.
- Package-content dry run (`npm pack --dry-run --ignore-scripts`): platform runtimes and extension docs included; no vault/profile files or node_modules included. This is not a clean installation or installer-build check.
- Relative links in README, CONTRIBUTING and the two new architecture/extension guides: **24 checked**.
- Historical full-worktree check: blocked by `src/updates.ts:77` (`TS2339`, `release.assets.find`) at this checkpoint. The complete 0.4.0 check above supersedes that result.

Not verified here: real-school SSO/MFA, additional platforms, physical Windows/Linux systems, mobile UI, new signed installers or fresh cross-platform CI. The records below describe earlier commits and must not be interpreted as CI results for this refactor.

## 0.3.0 multi-school preview — 2026-09-21

Local environment: macOS arm64, Node.js v25.7.0. Tests use synthetic profiles and isolated temporary state; no real school credentials or course records were read.

Cross-platform CI: [run 35522170197](https://github.com/zs-andy/lms-cli/actions/runs/35522170197) passed on macOS, Windows and Ubuntu for multi-school source commit `6561965`. All three jobs completed dependency installation, type checking, automated tests, production dependency audit, CLI packaging, app/installer packaging and artifact upload. These artifacts are CI builds, not a published Release or real-school acceptance.

- TypeScript type checking and build: passed.
- Automated tests: **36 passed, 0 failed, 0 skipped**. New coverage includes custom school setup, Canvas-only/Blackboard-only profiles, preserving the active profile, CLI/MCP profile creation and selection, 0.2.0 PolyU profile compatibility, tenant/origin-isolated connection caches, custom-host Cookie scoping, fresh reauthorization, scoped connection checks and safe dynamic school selection.
- Real Chromium/Electron authorization-page smoke test: passed with synthetic schools. Checked school switching, configured-platform filtering, correct login arguments, locked profile, empty state, hostile labels rendered as text and viewport fit. The rendered page was visually inspected; no school SSO was attempted.
- Plugin manifest and query Skill validation: passed. App, package, plugin and marketplace use `lms-cli`; the school emblem is replaced by an original neutral icon.
- CLI tarball build and package-content inspection: passed. No credentials, backup directories, node_modules or old school emblems are bundled.
- Clean tarball installation outside the source checkout: passed; custom-school initialization, `doctor`, 15-tool MCP handshake and real upstream schema discovery worked without credentials.
- macOS arm64 unpacked app build: passed with signing explicitly disabled. Its display name is `lms-cli`; the packaged Node-mode CLI and native-keyring module load passed. No new DMG/ZIP release, signing or notarization is claimed by this local check.
- Production dependency audit (`npm audit --omit=dev`): **0 known vulnerabilities** at verification time. This is not an independent security audit.
- Public MCP exposes **15 front-door tools**, including explicit local profile setup/selection and bounded live identity/course-list checks. Remote writes and raw requests remain denied.

### Limits of this validation

- This change does not certify any additional real institution. Schools' SSO/MFA, embedded-browser policies, feature permissions, Blackboard versions and special deployment paths need institution-specific acceptance.
- `lms check` verifies identity and course-list endpoints only; it cannot certify announcements, assignments, grades, files or every course.
- macOS local tests are not physical Windows/Linux acceptance. CI/offline packaging is separate from live school and OS-keychain acceptance.
- Version 0.3.0 source/package preparation is not a public npm publication, signed/notarized installer, release tag or published GitHub Release. Historical 0.2.0 artifacts must not be represented as multi-school builds.

See [SCHOOLS.md](SCHOOLS.md) and [ACCEPTANCE.md](ACCEPTANCE.md) for the remaining live checks.

## Historical record — 0.2.0 (PolyU-only release)

The following record describes the old release, not the current multi-school UI or compatibility promise.

Performed locally on 2026-09-20, macOS arm64.

Public-release CI: [run 35520037721](https://github.com/zs-andy/lms-cli/actions/runs/35520037721) passed on macOS, Windows and Ubuntu for the initial source release. It exercises dependency installation, type checking, offline tests, dependency audit, CLI packaging and platform-specific Electron packaging. It does not authenticate against PolyU.

- TypeScript build/type checking: passed.
- Automated tests: **27 passed, 0 failed, 0 skipped**. Includes PolyU-only routing, monochrome authorization-page checks, pure-emblem icon checks, profile validation, encrypted-vault boundaries, stale-session protection, cookie scoping, read-only allowlist, parameter limits, caching/deduplication, partial failures, task correction history, stable ICS UIDs, HTTP credential/redirect guards, real upstream MCP handshakes, CLI exit codes and Electron Node-mode/native-keyring loading.
- `npm audit` including development dependencies: **0 known vulnerabilities** at the time of this run. This is not a comprehensive security certification.
- Plugin manifest and skill validators: passed.
- Initial public source preparation: Gitleaks 8.30.1 found no leaks in the staged source export; README relative links and no-emoji check passed. This is a point-in-time scan, not a guarantee that all possible sensitive data patterns are detectable.
- Clean npm tarball installation outside the source checkout: passed; `lms doctor`, tool discovery, unauthenticated status, and real installed MCP handshake exercised.
- Installed MCP exposes **11 front-door tools** and a reviewed catalog of **55 upstream read tools** (Canvas 29, Blackboard 26). Raw requests and remote mutations are not exposed.
- Electron macOS arm64 application, DMG and ZIP build: passed, with code-signing identity explicitly disabled. Packaged application's Node-mode CLI and native keyring module load: passed (Electron Node v24.21.0). The CLI was also tested on Node v25.7.0.
- The npm tarball and macOS arm64 DMG/ZIP can be built locally. GitHub distribution uses a preview release; no public npm publication or notarization is claimed.

### Historical 0.2.0 unverified items / final acceptance

- New authorization vault intentionally starts empty. Existing PolyU prototype credentials and study state were not read, migrated or erased. A fresh login is needed once.
- The packaged authorization app was opened and visually checked on macOS arm64. Its own page is monochrome, PolyU-only and free of technical setup details. School SSO/MFA was not completed during verification.
- Windows and Linux CI builds/offline tests passed as linked above. Their installers, OS keychain interactions and actual school SSO have **not been manually accepted on physical Windows/Linux systems**.
- Independent `lms ask` invocation isolation was tested; a full live model-and-school query was **not run**. Use the installed Codex plugin or compatible signed-in Codex CLI for the acceptance cases.
- Other institutions' SSO/Canvas/Blackboard compatibility was not accepted for this release; the user-facing package is intentionally limited to PolyU until separate tenant testing is complete.

Use `ACCEPTANCE.md` for final real-account checks. A fast overview is bounded: it does not prove all historical notifications or linked attachments were read. There is no daily automation or third-party calendar subscription configured by installation.

The historical 0.2.0 distribution used the `polyu-lms` GitHub marketplace. Current multi-school source uses `lms-cli`; see the README migration instructions and avoid enabling multiple copies of the plugin.
