# REPORT — FWAI hackathon, 2026-09-18/19

## Status per part

**hello-agent static page: DONE**
- evidence: `webfetch http://localhost:8123/` returned `<h1>My agent <span>works</span></h1>`; server reported `status: ready, port 8123`.

**Global n8n MCP server in Kilo config: DONE**
- evidence: `Config file validated successfully.`; `initialize` -> `STATUS: 200`, `n8n MCP Server 1.2.0`; `tools/list` -> `STATUS: 200`, 54 tools.

**Email reply to Kumar: NOT SENT (draft only)**
- evidence: draft produced in chat. Still needs Kumar's actual point and two real time slots.

**Sample sheet data (CSVs): DONE**
- evidence: `Enquiries.csv` (5 rows) and `Rejected.csv` (4 rows) written and read back.

**n8n workflow `Enquiry Intake — Validate & Log`: DONE and LIVE**
- evidence: `workflowId IG9zBhnHyeDgCXbU`; published, active version `14f50c4a-012f-4243-b4ac-8931c5881dbf`;
  form at `https://azrock.app.n8n.cloud/form/enquiry` fetched 200 with correct fields.

**End-to-end test (form -> Google Sheet): DONE**
- evidence: `VALID=200 BADPHONE=200 NOBUDGET=200`; executions 4/5/6 routed correctly; sheet read back confirmed rows.

**Concurrent-append bug: DONE (found, fixed, re-verified)**
- evidence: see "What broke" below.

**Daily digest script `digest.js`: DONE**
- evidence: `node digest.js` -> 5 stories, `Saved: D:\...\digest.html`; `digest.html` 7,794 bytes with
  5 `What happened:` and 5 `What it means for my clients:` lines and no fallback banner.

**8am schedule `daily-digest-schedule.xml`: WRITTEN, NOT ENABLED**
- evidence: XML valid, UTF-16 BOM `255,254`, `StartWhenAvailable=true, WakeToRun=true`, command
  `C:\Program Files\nodejs\node.exe`. A throwaway test task imported the XML (`SUCCESS`, `Next Run Time: 20-09-2026 08:00:00`,
  `Status: Ready`) and was then deleted. The real task has not been created.

**Email delivery via Composio (Gmail): DONE and VERIFIED**
- evidence: `node digest.js` printed `Emailed the digest to azrockon456@gmail.com via Composio (Gmail).`
  (only printed when composio returned `successful: true`), and a mailbox read-back via `GMAIL_FETCH_EMAILS`
  returned messageId `1a0b81bb9129c4d6`, subject `Daily Digest - small business AI India - 19 Sep 2026`,
  labels `UNREAD, SENT, INBOX`, `Content-Type: text/html`.

## What broke and how I fixed it

**1. n8n workflow: two concurrent form submissions lost a sheet row.**
Executions 5 and 6 both reached `Save Rejected Enquiry` with `status: success`, but the `Rejected` tab held only one
of the two rows. Ruled out: broken append (a later single submission appended fine), wrong routing (the execution's
`lastNodeExecuted` and output were correct), wrong credential/document (identical to the working node).
Cause: n8n's default append computes the target row by reading the sheet first, so two overlapping runs both picked
the same row and the later write overwrote the earlier. Fix: `useAppend: true` on both append nodes, republished, then
proved with two simultaneous submissions that both rows land.

**2. Digest summaries were cut mid-sentence.**
First run with a key produced `...so your edge narrows to custom workflows,` and `...so`. Cause: `parseTwoLines`
matched line-by-line, and the model wrapped sentences across lines. Fix: collapse newlines before parsing, and raise
`max_tokens` from 220 to 400. Rerun produced five complete pairs.

**3. Composio send refused: `APIKey_InsufficientPermissions` (403, code 812).**
The first key had no `tool_execution` scope; both `GMAIL_SEND_EMAIL` and a probe (`GMAIL_GET_PROFILE`) returned 403
with the same slug. Fix: a new project key with `tool_execution` write. Probe then returned `STATUS: 200`.

**4. After the scope fix, Gmail returned `401 UNAUTHENTICATED`.**
The key worked but the Gmail token was dead. Cause: the earlier reconnect happened before the auth-config scope Save,
which invalidated that grant. Fix: minted a fresh hosted connect link (`POST /connected_accounts/link` -> 201), deleted
the stale broken connection, and completed Google consent. New connection `ca_WfYIjC7x7OcI` -> ACTIVE, probe
`successful: true`, send succeeded.

## Claims ledger

- hello-agent page renders "My agent works" -> `webfetch http://localhost:8123/`.
- n8n MCP config valid, server live, 54 tools -> config validation + `initialize`/`tools/list` 200.
- Workflow created (6 nodes) and published -> `create_workflow_from_code`, `publish_workflow success: true`.
- Both tabs exist, data imported correctly -> `sheetsSearch` gids + read-back execution 2.
- Validation routes correctly -> executions 4/5/6 and their `Save *` outputs.
- Concurrent row loss occurred, then was fixed -> execution 7 read-back (missing row) vs simultaneous-test read-back (both rows).
- Digest built from India-edition Google News, deduped, top 5 -> terminal output + `digest.html`.
- Email sent and delivered -> script success line (gated on `successful === true`) + `GMAIL_FETCH_EMAILS`
  messageId `1a0b81bb9129c4d6`, labels `UNREAD, SENT, INBOX`.
- Schedule XML valid and importable -> UTF-16 probe `XML OK` + throwaway `schtasks` import `SUCCESS`, then deleted.

UNVERIFIED / not yet proven:
- The real 8am task is not created, so "runs at 8am" and "catches up after sleep" are untested end to end.
- Wake-timer power setting (`WakeToRun`) was not confirmed against the active power plan.
- AI path with an OpenRouter key (`sk-or-`) was never exercised; only the DeepSeek path was.
- Only two concurrent submissions were tested; behaviour above two is untested.
- Backup JSON is a snapshot, never re-imported to prove it round-trips.

## What I would tell the next person

1. Two live artifacts exist: n8n workflow `IG9zBhnHyeDgCXbU` (form `https://azrock.app.n8n.cloud/form/enquiry`) and
   the daily digest script `digest.js` with `digest.html`.
2. `useAppend: true` on the n8n Sheets nodes is load-bearing — without it concurrent submissions lose rows.
3. In `digest.js`, `MODEL`, `OPENROUTER_MODEL`, `COMPOSIO_USER_ID` and `DIGEST_TO` are the only lines you need to touch.
   The Composio user id is `pg-test-718bd6ee-70fb-4d5d-91bd-8f05b3722fc8` (not "default"); the connected address is
   `azrockon456@gmail.com`.
4. Secrets live in `key.txt` (DeepSeek) and `composio-key.txt` (Composio) in plain text, as the member asked. Both were
   also pasted into the chat transcript, so rotate them if that transcript is ever shared. No secret appears in
   `digest.js`, `digest.html` or the schedule.
5. If Gmail tools start returning 401 again, the connection's grant has expired: mint a fresh link with
   `POST /api/v3/connected_accounts/link` and complete Google consent. Changing an auth config's scopes invalidates
   existing grants, so always reconnect *after* editing scopes.
6. The digest's Google News query is `small business AI India` on `hl=en-IN&gl=IN&ceid=IN:en`; the trade/industry was
   read as small business owners (SMBs) in Bengaluru and across India.
7. Not done on purpose: the schedule is not enabled, and the reply to Kumar is still a draft.
