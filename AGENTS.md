# AGENTS.md

Guidance for AI agents (and humans) working on this repository.

## What this is

`paseo-github-prs` — a [Paseo](https://paseo.sh) plugin that shows GitHub pull requests in the Paseo sidebar: saved views backed by GitHub search queries, a list with CI/review badges, a detail panel with diffs/reviews/comments, and approve / merge / send-to-chat actions. All GitHub access goes through the `gh` CLI on the daemon machine; there is no token configuration in the plugin itself.

## Commands

```sh
npm run typecheck                # the only automated gate; there is no test suite
paseo plugin reload paseo-github-prs   # load changes into a running Paseo
paseo plugin logs paseo-github-prs     # server-side errors land here
```

CI (`.github/workflows/ci.yml`) runs the typecheck on pushes to `main` and on pull requests. A change is not done until `npm run typecheck` passes.

## Architecture

Three layers, each in its own directory. Respect the layering: shared never imports from client or server, and client and server never import from each other.

| Path | Role |
|---|---|
| `index.client.tsx` | client entry: registers the `prs` screen + sidebar row |
| `index.server.ts` | server entry: registers settings, wires RPC handlers |
| `shared/prs.ts` | zod schemas, `defineRpc`/`defineSettings` contracts, pure transforms |
| `client/` | React Native UI (`prs-screen.tsx` list, `detail.tsx` detail panel, `format.ts` colors/time) |
| `server/` | daemon-side handlers (`github.ts` = `gh` CLI calls, `chat.ts` = send-to-chat) |

Data flow: client component → `useRpc(contract)` → shared `defineRpc` (zod in/out) → `server.handle(contract, handler)` → `gh` CLI → zod-checked output back to the client.

## Rules

- **`shared/prs.ts` is the single source of truth.** zod schemas double as TypeScript types. New RPC = `defineRpc` in shared + `server.handle` in `index.server.ts` + `useRpc` in the client — all three, always.
- **Changing settings schema or defaults** means bumping `version` and extending `migrate`; backfill defaults, never discard user-saved views.
- **UI is react-native**, not DOM. All colors come from `theme` (`PluginTheme`) — never hardcode — except the GitHub PR state colors in `client/format.ts`, which are intentionally GitHub's palette.
- **Error messages must be actionable** (see `describeGhFailure`): tell the user what to run or where to click.
- **Comments explain why, never what.** Mark deliberate limits as `shortcut: <limit>, <when to upgrade>` (existing examples: check-rollup recency, inline review comments).
- Keep pure, testable logic (check rollup folding, PR mapping) in `shared/prs.ts`, free of client/server imports.

## Gotchas

- **`gh search prs` mangles queries** — search goes through `gh api search/issues -f q="type:pr <query>"`. Do not "simplify" it back.
- **GitHub's search index lags a merge by seconds.** `prs-screen.tsx` tracks `mergingKeys`: on merge the row locks, a forced refresh runs, and the merged PR is filtered out of that refresh. Keep this when touching the refresh path.
- **Checks permission**: a token without the Checks permission fails the whole `statusCheckRollup` GraphQL field — `enrich` degrades to no badges rather than erroring. Preserve that.
- **List state**: per-view 10-minute cache (`viewCache`) and `requestSeq` for stale-request invalidation; forced refreshes keep showing the old list while reloading.
- **Merge fallback** tries `--merge` → `--squash` → `--rebase`, retrying only on "method not allowed" errors. Don't collapse it into one strategy. `admin: true` on the RPC appends `--admin` to bypass branch protection.

## Deeper reference

`.agents/skills/paseo-github-prs/SKILL.md` — extended architecture notes, the full gotcha list with rationale, and the dev/reload loop. `README.md` covers user-facing features and known limits.
