# Beli API discovery (T5)

**Status: a live run on 2026-09-11 obtained API access and resolved most T5 questions.
See "What was determined (2026-09-11 live run)" below for current findings; one
question (the Recs `list_field` value) remains unresolved. Everything above that
section is the original 2026-09-10 run, kept as history — it describes a genuinely
different account state (the egress block that run hit), not a contradiction.**

Date of original run: 2026-09-10 (blocked; see below)
Date of live run: 2026-09-11 (see "What was determined" below)
Account: `ek30gold@gmail.com` (credentials present in env; used successfully as of the
2026-09-11 run)
App version reported by probe: 9.3.1

This document records a discovery run that **failed at the prerequisite stage**. It is
written down because a negative result is worth as much as a positive one, and because
the raw `probe-report.json` committed alongside it is, on its face, misleading (see
"A probe bug found along the way").

Nothing here should be read as evidence about Beli's API. It is evidence about the
network between this session and Beli.

## What blocked the run

All four Beli hosts are refused by the session's egress proxy with **HTTP 403 in
response to the CONNECT request**. That is an organization egress-policy denial. It is
not a Beli error, not DNS, and not a TLS problem — the tunnel is refused before any
bytes reach Beli.

```
CONNECT backoffice-service-t57o3dxfca-nn.a.run.app:443 HTTP/1.1
< HTTP/1.1 403 Forbidden
* CONNECT tunnel failed, response 403
```

The proxy's own status endpoint (`$HTTPS_PROXY/__agentproxy/status`) independently
recorded the same verdict for each of the four hosts:

```json
{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "backoffice-service-t57o3dxfca-nn.a.run.app:443" }
```

Blocked hosts (all four the project needs):

| Role     | Host                                                            | Result           |
|----------|-----------------------------------------------------------------|------------------|
| API      | `backoffice-service-t57o3dxfca-nn.a.run.app`                     | 403 on CONNECT   |
| ONBOARD  | `backoffice-service-onboarding-t57o3dxfca-nn.a.run.app`          | 403 on CONNECT   |
| RECS     | `backoffice-service-recs-t57o3dxfca-nn.a.run.app`                | 403 on CONNECT   |
| ACTIVITY | `activity-service-978733420956.northamerica-northeast1.run.app`  | 403 on CONNECT   |

This is a **selective allowlist**, not a general network outage. Control test:

| Host              | Result   |
|-------------------|----------|
| `api.github.com`  | HTTP 200 |
| `example.com`     | blocked  |
| `www.google.com`  | blocked  |

No attempt was made to route around the policy. TLS verification was not disabled and
`HTTPS_PROXY` was not unset.

## Why this is confusing, and the remedy

The session *is* running in the intended `Beli-mcp` environment
(`env_01X6ZMspH7KGLvABkfBqa1ue`), and `BELI_EMAIL` / `BELI_PASSWORD` are both correctly
set. So the environment was configured — but its Custom network allowlist is not in fact
admitting the four hosts.

Most likely causes, in order:

1. The allowlist entries were saved with a scheme, port, or trailing path
   (`https://host/`) rather than as bare hostnames.
2. The allowlist was edited after this container had already been provisioned, so the
   running container never picked up the policy.

Remedy: re-check the four entries in the `Beli-mcp` environment's network settings as
bare hostnames, then start a **fresh** session. See
<https://code.claude.com/docs/en/claude-code-on-the-web>.

## A probe bug found along the way

`probe-report.json` in this commit reports each host as `"error": "fetch failed"`, and
the human report prints `UNREACHABLE — fetch failed`. **That is a misdiagnosis.** The
hosts are blocked by policy, not unreachable.

The probe has egress-block detection (`packages/mcp-server/src/probe.ts:200`), but it
only fires when it receives a *response* carrying status 403 or 407. A proxy that
rejects the CONNECT tunnel never produces a response object at all — in Node it surfaces
as a thrown `TypeError: fetch failed`. So the detection branch cannot run in exactly the
situation it was written for, and the probe hides the remedy it was built to surface.

Second issue: the probe uses Node's built-in `fetch`, which ignores `HTTPS_PROXY`. This
run required `NODE_USE_ENV_PROXY=1` (supported on Node >= 22.21; this container has
22.22.2) for the probe to reach the proxy at all. Without that flag the requests bypass
the proxy entirely and fail with an unrelated error.

Both are diagnostics defects, not product defects. They were left unfixed because T5's
scope is explicitly limited to fact-finding. A later node should fix them: treat a
CONNECT-level failure as a candidate egress block, and give the client an explicit proxy
agent (or set the env flag).

## What was verified (local only)

| Check              | Result                                  |
|--------------------|-----------------------------------------|
| `npm install`      | clean                                   |
| `npm run build`    | clean                                   |
| `npm run typecheck`| clean                                   |
| `npm test`         | 76 tests / 13 files, all passing        |
| `probe` runs       | yes — executes and writes its report    |

The repository is ready. Re-running T5 unchanged after the allowlist is fixed is the
whole of the remaining work.

## What was determined (2026-09-11 live run)

The egress block described above was resolved before this run (a prerequisite fix,
`business.status` made nullable in the contract schema, unblocked JSON parsing of
`GET /api/get-ranking/` and `GET /api/get-bookmark/`, which had been failing and making
`list_field` look unresolvable). This run reached all four Beli hosts, authenticated
(user `902c99ec-31bb-4c2b-bb65-2bd8c6848b91`, app v9.3.1), and ran
`beli-mcp-plus probe --emit-discovered`, which wrote `packages/contract/src/discovered.ts`
and `probe-report.json` directly from the live findings below. Every CONFIRMED value in
`discovered.ts` was cross-checked against the quoted evidence in `probe-report.json`
before being accepted here — the evidence standard is ID-overlap against the reference
lists, never the plausibility of a candidate's name. (In this API the candidates
literally named `BEEN` and `WANT_TO_TRY` both return **zero rows** — the real field
values are `RANK` and `BOOKMARKED`, discovered only by overlap testing, not by name.)

**(a) Can `POST /api/filter-list/` serve the personal lists at all?** **YES —
CONFIRMED.** Both Been and Want to Try resolved with full-count overlap (see below).
`FILTER_LIST_SERVES_PERSONAL_LISTS = true` in `discovered.ts`.

**(b) `list_field` values, with overlap fractions:**

| List        | Resolved `list_field` | Overlap                                                        |
|-------------|------------------------|------------------------------------------------------------------|
| Been        | `RANK`                 | 388/388 (100%) returned ids appear in `GET /api/get-ranking/`    |
| Want to Try | `BOOKMARKED`           | 568/568 (100%) returned ids appear in `GET /api/get-bookmark/`   |
| Recs        | **UNRESOLVED**         | no candidate produced usable evidence (see below)                |

Every other candidate tried for the personal lists — `BEEN`, `RANKED`, `WANT_TO_TRY`,
`WANTTOTRY`, `BOOKMARK` — returned 200 with **zero rows**, giving no ids to test overlap
against and so no basis to confirm or rule them out either way.

For Recs specifically: `RECS`, `REC`, and `FRIEND_RECS` all returned 200 with zero rows
(same as above — no evidence either way); `TRENDING` failed with 503 (Service
Unavailable) and `RECOMMENDED` failed with 504 (upstream timeout) — both look like
transient upstream failures rather than rejected values, so they are worth re-probing
rather than treated as ruled out. No candidate is being reported as the Recs
`list_field` value. `discovered.ts` emits `LIST_FIELD.RECS = null` accordingly.

**(c) Live category enum.** All eight candidates the probe tried against
`GET /api/get-ranking/` returned 200 (none was rejected with 400/422):
`RES, BAR, BAK, BAKERY, DES, DESSERT, COFFEE, OTHER`. Note the nuance: "accepted" here
means only that the request did not error — `BAKERY`, `DESSERT`, `COFFEE`, and `OTHER`
each returned 0 results for this account, so the probe cannot distinguish "a real,
distinct enum value this account simply has nothing filed under" from "a value the
endpoint silently ignores." Only `RES` (388), `BAR` (97), and `BAK` (13) are backed by
actual returned rows.

**(d) Recs response shape.** `GET {RECS}/api/recs/{uuid}/` returned 200 with a
top-level array of 24,392 items — classified `curated-list` (a non-empty array, not a
map/object keyed by business id). `GET /api/rec-score/` returned 405 (Method Not
Allowed), so it was **not run** and its shape (e.g. a score map) remains undetermined.

**Facet keys** (informational, not part of the personal-lists question): 
`GET /api/filter-configs/` returned 200 with facet keys `CITY, GOODFOR, SCORE,
NUMFRIENDS, CUISINE, PRICECODE, BOROUGH, NEIGHBORHOOD, COUNTRY`. `POST
/api/filter-options/` — which would give the legal values inside each facet — failed
with 500 (Internal Server Error), so per-facet legal values remain unresolved.

**(e) What remains unresolved after this run:**

| Question                                                          | Status                              |
|---------------------------------------------------------------------|-----------------------------------|
| `list_field` value selecting **Recs**                                | **UNRESOLVED** — no candidate confirmed |
| Per-facet legal values (`filter-options`)                            | **UNRESOLVED** — 500 error         |
| `/api/rec-score/` response shape                                     | **UNRESOLVED** — 405, not run      |
| Whether `BAKERY`/`DESSERT`/`COFFEE`/`OTHER` are real distinct categories or silently-ignored values | **UNRESOLVED** — 0 rows either way |
| `TRENDING` / `RECOMMENDED` as `list_field` candidates                | **UNRESOLVED** — 503/504, transient failures, not tested to a conclusion |

None of these is filled with a guess. `discovered.ts` marks each as UNRESOLVED
(`LIST_FIELD.RECS = null`) rather than substituting a plausible-sounding value, per the
project's evidence standard: a wrong `list_field` would silently return the wrong list.

## Warning for the next node

*(This section is preserved from the original 2026-09-10 run for history. As of the
2026-09-11 live run above, the question it warns about has been positively answered —
`filter-list` DOES serve both personal lists — so the warning itself is now moot. It is
kept, unedited, below for context; do not read it as still describing the current
state.)*

Do **not** read this run as evidence that `filter-list` cannot serve the personal lists,
and do **not** default to a client-side fetch-and-filter backend on the strength of it.
That decision requires positive evidence that `filter-list` fails at the task. This run
produced no evidence either way. The question is untested, not answered.

---

## Follow-up: what was built while the API stayed unreachable (2026-09-10)

Two things happened after the run above, neither of which changes any finding.

### The probe now names the block

Both diagnostics defects described earlier are fixed. `detectEgressBlockFromError`
walks a thrown error's `cause` chain for undici's
`Proxy response (403) !== 200 when HTTP Tunneling`, and `errInfo` applies it
everywhere the probe renders an error, so login and refresh failures name the
policy too. `installProxySupport` makes the process actually use `HTTPS_PROXY`
(deferring to `NODE_USE_ENV_PROXY`, else undici's `EnvHttpProxyAgent`, else
warning loudly). A 502 from the proxy stays unclassified — an upstream failure
has a different remedy than an allowlist miss.

Verified against this session's live 403-on-CONNECT proxy: all four hosts now
report `BLOCKED BY EGRESS POLICY`, and the skip reasons point at the allowlist
instead of telling the reader to set credentials that are already set.

### List search is client-side, and `filter-list` stays pluggable

`search_list` filters the personal lists over the rows `GET /api/get-ranking/`
and `GET /api/get-bookmark/` return — endpoints that were already proven — with
the matching, sorting and paging done in process.

**This is not a finding that `POST /api/filter-list/` cannot serve the personal
lists.** That remains untested, exactly as the table above says. It is a choice
to stop blocking a shippable feature on an unknown that only live access can
resolve. The trade is explicit: one full-category fetch per call, and filtering
limited to the fields those endpoints return.

If and when `list_field` is established, a server-side backend can sit behind
the same `ListFilter` shape and be selected at runtime. Nothing in the current
code assumes the endpoint is unusable, and nothing should be read that way.

Two deliberate semantics worth knowing, both covered by tests: a row with no
price is excluded when a price bound is set, and a row with no score is excluded
when a score bound is set — so any score bound empties a Want-to-Try list, which
has no scores at all. Keeping such rows would report an unscored place as
clearing a score floor it was never measured against.

### Completing this document is now one command

`beli-mcp-plus probe --emit-discovered` generates
`packages/contract/src/discovered.ts` directly from a live run, so the overlap
evidence is never hand-transcribed into a confidence marker. Values the probe
cannot establish are emitted as `null`/UNRESOLVED.

Testing the discovery logic against a simulated API with known ground truth
found one defect worth recording, because it would have produced a confidently
wrong answer rather than a visible failure: a candidate returning a 50/50 mix of
Been and Want-to-Try ids cleared the 0.5 overlap threshold against both
references and was reported as being both lists at once. Resolution now requires
a decisive margin, and an inseparable candidate is reported AMBIGUOUS.

The same exercise showed a failed reference fetch was indistinguishable from an
empty list — both score zero overlap — so a `get-ranking` outage could have
misfiled the Been field. The report now says the reference was unavailable
instead of quoting a meaningless zero.

An `empty` recs response is likewise no longer reported as a confirmed shape: it
proves the call worked, not whether recs is a curated list or a score map.

