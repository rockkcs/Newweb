# WORKLOG — FWAI hackathon, session of 2026-09-18/19

`<what I did> -> <the command I ran> -> <what it actually printed>`

## 1. hello-agent static page
- Created `hello-agent/index.html` -> `Test-Path -LiteralPath "hello-agent"` -> `False` (absent before)
- Served it -> `python -m http.server 8123` (workdir `hello-agent`) -> `status: ready, port 8123`
- Verified it -> `webfetch http://localhost:8123/` -> returned `<h1>My agent <span>works</span></h1>`

## 2. Global n8n MCP server in Kilo
- Read global config -> `read C:\Users\admin\.config\kilo\kilo.jsonc` -> `{ "$schema": "https://app.kilo.ai/config.json" }`
- Wrote the `mcp.n8n` remote block -> `write` -> `Config file validated successfully.`
- Verified reachable -> `POST https://azrock.app.n8n.cloud/mcp-server/http` initialize -> `STATUS: 200`, `n8n MCP Server 1.2.0`
- Listed tools -> `tools/list` -> `STATUS: 200`, 54 tools

## 3. Email draft
- One reply drafted for client "Kumar" in chat. Two slots remain placeholders. Nothing sent.

## 4. Sample sheet data
- Wrote `enquiry-intake-sheets/Enquiries.csv` (5 rows) and `Rejected.csv` (4 rows) -> read back -> headers match the workflow columns

## 5. n8n workflow build
- `n8n_validate_workflow` -> `{"valid": true, "nodeCount": 6}`
- `n8n_create_workflow_from_code` -> `workflowId IG9zBhnHyeDgCXbU`

## 6. Wire to the real spreadsheet
- `n8n_explore_node_resources sheetsSearch` -> `Enquiries` gid `1414337461`, `Rejected` gid `1938164257`
- Set documentId -> `appliedOperations: 2`; attach credential + pin gids -> `appliedOperations: 4`

## 7. Verify imported data
- Temp reader execution `2` -> Enquiries rows 2-6, Rejected rows 2-5, matched the CSVs; archived

## 8. Publish and live test
- `n8n_publish_workflow` -> `success: true`
- `webfetch https://azrock.app.n8n.cloud/form/enquiry` -> 200, correct fields
- 3 test submissions -> `VALID=200 BADPHONE=200 NOBUDGET=200`; exec 4/5/6 routed correctly
- Read back -> Enquiries rows 7,8; Rejected row 6; **TEST Bad Phone missing**

## 9. Bug found and fixed (concurrent append)
- Single later submission -> `RACECHECK=200` -> appeared at Rejected row 7, so append works
- Cause: n8n default append computes the row by reading first; two overlapping runs overwrote
- Fix: `useAppend: true` on both Sheets nodes -> `appliedOperations: 2`; republished
- Proof: two simultaneous submissions -> `A=200 B=200` -> both rows landed (8 and 9)
- Cleanup: deleted Rejected rows 8-9 -> execution 13 success -> read-back showed them gone

## 10. Save (first pass)
- `n8n_get_workflow_details` -> written to `n8n-workflow-enquiry-intake.backup.json`; temp workflows archived

## 11. Daily digest script and schedule
- Answers: model `deepseek-flash`, project root, Windows Task Scheduler, query `small business AI India`
- Environment -> `node --version` -> `v24.21.0`; node path `C:\Program Files\nodejs\node.exe`; user `desktop-2murhi0\admin`
- Wrote `digest.js` (Node built-ins only) and `daily-digest-schedule.xml`
- Converted schedule to UTF-16 -> `BOM bytes: 255,254`; `XML OK` -> `StartWhenAvailable=true, WakeToRun=true`
- First run without key -> fetched 5 stories, wrote `digest.html`, printed `Email is off: no composio-key.txt...`

## 12. First send attempt (no key) and parser fix
- Added key.txt -> `node digest.js` -> summaries appeared, but two were cut at a line wrap
- Fix: `parseTwoLines` now collapses newlines; `max_tokens` 220 -> 400
- Rerun -> all five summaries complete; `digest.html` 7,794 bytes, banner absent

## 13. Composio email step
- Added `emailDigest()` to `digest.js`: POST `https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL`,
  header `x-api-key`, body `{user_id, version:"latest", arguments:{recipient_email, subject, body, is_html:true}}`
- Subject = trade + date; body = the digest HTML; checks `successful`, prints `error` and stops if not true
- Missing key guard tested -> `Email is off: no composio-key.txt beside the script.`

## 14. Composio key blocker
- Lookup -> `GET /connected_accounts` -> user_id `pg-test-718bd6ee-70fb-4d5d-91bd-8f05b3722fc8`, `azrockon456@gmail.com`, ACTIVE
- Send -> 403 `APIKey_InsufficientPermissions` code 812 (`tool_execution` missing) on both send and probe
- New key `ak_Ei1...` -> probe `STATUS: 200` (scope fixed) but `successful:false`, Gmail `401 UNAUTHENTICATED`
- Cause: the scope Save on the auth config invalidated the grant made earlier

## 15. Reconnect Gmail, send, verify
- Minted hosted links via `POST /connected_accounts/link` -> 201; deleted the stale broken connection -> `{"success":true}`
- After consent: `ca_WfYIjC7x7OcI | ACTIVE | azrockon456@gmail.com`; probe -> `successful = True`
- `node digest.js` -> `Saved: ...digest.html` and `Emailed the digest to azrockon456@gmail.com via Composio (Gmail).`
- Verified in the mailbox via `GMAIL_FETCH_EMAILS` -> messageId `1a0b81bb9129c4d6`, subject
  `Daily Digest - small business AI India - 19 Sep 2026`, labels `UNREAD, SENT, INBOX`, `Content-Type: text/html`

## Left undone
- The 8am scheduled task is NOT enabled (the turn-on `schtasks` line has not been run by choice).
- Stale Composio connections `ca_yFX7CH5eGrHE` (INITIALIZING) and `ca_k3Sq9IajCZSR` (EXPIRED) not deleted.
- Schedule registration itself is untested end to end (test task was created under a throwaway name and deleted).
