# beli-mcp-plus

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Model Context Protocol](https://img.shields.io/badge/MCP-server-6E56CF)](https://modelcontextprotocol.io)

An [MCP](https://modelcontextprotocol.io) server for [Beli](https://beliapp.com).
**Log in once**, then search places, rank reviews, manage photos, and bookmark
places from any MCP client (Claude Code, Claude Desktop, Cursor, VS Code, etc.).

> Unofficial. Built on a reverse-engineered private API (app v9.3.1); Beli makes
> no compatibility guarantee. Use with your own account and rate-limit politely.

## Install / run

> **`beli-mcp-plus` is not published to npm yet**, so `npx beli-mcp-plus` will
> not work. Run it from a clone, as below. Note that `npx beli-mcp` (no
> `-plus`) installs the **upstream** project this is forked from — a different
> server that does not have this fork's tools or its live-verified API
> constants. Don't use it expecting this one.

```bash
git clone https://github.com/ek30gold/beli-mcp-plus
cd beli-mcp-plus
npm install
npm run build
```

That produces a self-contained `packages/mcp-server/dist/cli.js`. Verify it:

```bash
node packages/mcp-server/dist/cli.js --help
node packages/mcp-server/dist/cli.js probe   # read-only API diagnostics
```

### Claude Code

```bash
claude mcp add beli -- node /ABSOLUTE/PATH/TO/beli-mcp-plus/packages/mcp-server/dist/cli.js
```

Add `--scope user` to make it available in every project rather than just the
current one:

```bash
claude mcp add --scope user beli -- node /ABSOLUTE/PATH/TO/beli-mcp-plus/packages/mcp-server/dist/cli.js
```

Check it with `claude mcp list`, or `/mcp` inside a session.

### Claude Desktop / Cursor

Claude Desktop reads `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`). Cursor
reads `~/.cursor/mcp.json`. Both take the same shape:

```jsonc
{
  "mcpServers": {
    "beli": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/beli-mcp-plus/packages/mcp-server/dist/cli.js"]
    }
  }
}
```

Use an absolute path — these clients do not inherit your shell's working
directory. Restart the client after editing.

Once the package is published, the same config becomes
`"command": "npx", "args": ["-y", "beli-mcp-plus"]` (on Windows,
`"command": "cmd", "args": ["/c", "npx", "-y", "beli-mcp-plus"]`).

### Any other MCP client

The server speaks **stdio** and needs no arguments — point any MCP-compatible
client at `node <path>/dist/cli.js`. Tools carry `readOnlyHint` annotations, so
clients that distinguish read from write tools will do so correctly.

No credentials go in the config — authenticate once with the `login` command
(below). You can log in with **either an email or a phone number** (E.164).

## Log in once

`beli-mcp-plus` authenticates with a **one-time browser login** — no credentials
in any client config, works the same for every MCP client:

```bash
node packages/mcp-server/dist/cli.js login
```

This opens a small **localhost** page in your browser, you enter your Beli email
or phone + password, and it's validated against Beli before the session is saved. Only
**tokens** are persisted (to `~/.beli/session.json`, mode 0600) — your password
is never stored. A single login lasts ~7 days (the refresh token lifetime); the
20-minute access token is refreshed automatically.

```bash
node packages/mcp-server/dist/cli.js whoami    # show the saved user id
node packages/mcp-server/dist/cli.js logout    # clear the saved session
```

> `logout` clears the local session file only. It does not revoke the tokens
> server-side — the refresh token remains valid on Beli until it expires (~7
> days). Don't share the session file.

The login server binds to loopback only, uses an ephemeral port + a one-time
nonce, rejects forged `Host` headers (anti DNS-rebinding), and exits after you
sign in (or after 5 minutes).

Once logged in, point any MCP client at the server with no secrets in its config:

```jsonc
{
  "mcpServers": {
    "beli": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/beli-mcp-plus/packages/mcp-server/dist/cli.js"]
    }
  }
}
```

### Headless / CI

For non-interactive environments, set `BELI_EMAIL` (or `BELI_PHONE`) +
`BELI_PASSWORD` and `login` will authenticate without opening a browser. Set
`BELI_NO_BROWSER=1` to never attempt to launch a browser.

### VS Code (secure prompt, no hardcoding)

VS Code can prompt for credentials and store them in its secret storage via
input variables, then run a one-time headless login:

```jsonc
// .vscode/mcp.json
{
  "inputs": [
    { "id": "beli-email", "type": "promptString", "description": "Beli email" },
    { "id": "beli-password", "type": "promptString", "description": "Beli password", "password": true }
  ],
  "servers": {
    "beli": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/beli-mcp-plus/packages/mcp-server/dist/cli.js"],
      "env": { "BELI_EMAIL": "${input:beli-email}", "BELI_PASSWORD": "${input:beli-password}" }
    }
  }
}
```

Log in with **either an email or a phone number** (E.164) — use `BELI_PHONE`
instead of `BELI_EMAIL` for the latter.

## Tools

| Tool | Kind | Description |
|------|------|-------------|
| `search_places` | read | Place typeahead near a location (Google Places). |
| `find_business` | read | Resolve a name+location to a Beli `business_id`. |
| `business_detail` | read | Full business details by id. |
| `get_been` | read | A user's ranked "Been" list. |
| `get_want_to_try` | read | A user's "Want to Try" bookmarks. |
| `search_list` | read | Search/filter Been or Want-to-Try by name, city, neighborhood, cuisine, price, score. |
| `rank_place` | **write** | Create a ranked review (score is computed by Beli). |
| `upload_photo` | **write** | Upload a photo for a business from a local file. |
| `list_photos` | read | List your photos for a business. |
| `delete_photo` | **write** | Soft-delete a photo. |
| `bookmark` / `unbookmark` | **write** | Add/remove from "Want to Try". |
| `draft_*` | local | Compose a review offline and `draft_submit` it atomically. |
| `get_recs` | read | Your Beli recommendations. Paged (`offset`/`limit`) — the list runs to tens of thousands of items. |
| `login` / `logout` / `auth_status` | session | Sign in, clear the local session, or report who is signed in. |
| `beli_doctor` | read | Diagnostics: host reachability, session/auth state, and endpoint probes. |

### A note on `search_list`

Filtering runs **client-side**: the tool fetches the category's list via
`get-ranking` / `get-bookmark` and filters in process. So each call costs one
full-category fetch, and only the fields those endpoints return can be filtered
on. Beli's own `filter-list` endpoint would do this server-side, but the
`list_field` value that selects each personal list has never been established —
see `docs/api-discovery.md`.

Rows missing the field a bound is set on are excluded rather than kept. A score
bound therefore returns nothing from Want to Try, which has no scores.

### Behind a proxy

Node's `fetch` ignores `HTTPS_PROXY` unless told. The server installs proxy
support automatically when the optional `undici` dependency is present; without
it, set `NODE_USE_ENV_PROXY=1` (Node >= 22.21). If a proxy is configured and
neither is available the server warns on startup rather than silently bypassing
it — requests that bypass a proxy fail in ways that look like the API is down.

## Diagnostics

```bash
node packages/mcp-server/dist/cli.js probe
```

Runs read-only checks against the Beli API — host reachability, session/auth
state, the accepted `category` values, resolved discovery-endpoint fields,
facet configs, and the recs endpoints' response shape — and prints a report
(also written to `probe-report.json`). Never mutates your account. The same
checks are available as the `beli_doctor` MCP tool. See also
`node packages/mcp-server/dist/cli.js --help`.

### Completing API discovery

`probe --emit-discovered` regenerates `packages/contract/src/discovered.ts`
from a live run: `list_field` values for each personal list, the category
values the API actually accepted, observed facet keys, and the recs response
shape. Each value carries CONFIRMED (with the evidence quoted) or UNRESOLVED.

Resolution is by **id-overlap** against `get-ranking` and `get-bookmark`, never
by how plausible a name looks — a field called `BEEN` that returns the bookmark
list is reported as Want-to-Try. A candidate that overlaps both lists too evenly
to separate is reported AMBIGUOUS and left unresolved, and anything the probe
could not establish is emitted as `null`, never as a guess.

## Write safety

Write tools mutate your real account. By default they are **gated**: either start
the server with `BELI_ALLOW_WRITES=1`, or pass `confirm: true` on each write call.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `BELI_PHONE` | – | E.164 phone (headless/CI login only) |
| `BELI_PASSWORD` | – | account password (headless/CI login only; never stored) |
| `BELI_NO_BROWSER` | `0` | set `1` to never launch a browser during login |
| `BELI_ALLOW_WRITES` | `0` | set `1` to allow writes without per-call confirm |
| `BELI_HOME` | `~/.beli` | base dir for session + drafts |
| `BELI_SESSION_PATH` | `$BELI_HOME/session.json` | session file path |
| `BELI_MIN_INTERVAL_MS` | `350` | politeness throttle between API calls |
| `BELI_PROBE_OUTPUT` | `./probe-report.json` | where `probe` writes its machine-readable report |
| `NODE_USE_ENV_PROXY` | – | set `1` on Node >= 22.21 to route requests through `HTTPS_PROXY` |

## License

MIT
