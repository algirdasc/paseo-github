---
name: paseo-github-prs
description: Architecture and development guide for the paseo-github-prs Paseo plugin (the repo this skill ships in). Use whenever modifying, reviewing, or debugging code in the paseo-github repository — adding or changing RPCs, touching the gh CLI integration, view caching, settings, the merge/approve flow, or running the dev/reload loop. Load this before editing so changes land in the right layer.
---

# paseo-github-prs plugin

A Paseo plugin that shows GitHub pull requests in the Paseo sidebar: saved views backed by GitHub search queries, a PR list with CI/review badges, a detail panel with diffs/reviews/comments, and approve / merge / send-to-chat actions. All GitHub access goes through the `gh` CLI on the daemon machine — there is no token config of its own.

## Architecture

Three layers, each in its own directory. The layering is the main thing to respect: shared code never imports from client or server, and client and server never import from each other.

```
index.client.tsx   client entry: registers the "prs" screen + sidebar row
index.server.ts    server entry: registers settings and wires RPC handlers
shared/prs.ts      zod schemas, defineRpc/defineSettings contracts, pure transforms
client/            React Native UI (prs-screen.tsx = list, detail.tsx = detail panel, format.ts = colors/time)
server/            daemon-side handlers (github.ts = gh CLI calls, chat.ts = send-to-chat)
```

Data flow for any feature:

```
client component → useRpc(rpcName) → shared defineRpc contract (zod in/out)
  → server.handle(rpcName, handler) → gh CLI → zod-checked output back to client
```

- `shared/prs.ts` is the single source of truth. Every RPC is a `defineRpc({ name, input, output })`; the zod schemas double as the TypeScript types (`z.output<...>`). Adding a field means changing the schema here, not a separate `.d.ts`.
- `index.server.ts` wires each contract to a handler via `server.handle(...)`. New RPC = new `defineRpc` in shared + `server.handle` line + `useRpc` call in the client. All three, always.
- Settings (`viewsSettings`) are host-scoped and versioned. Changing the defaults or schema means bumping `version` and extending `migrate` — see the existing migrate, which backfills missing default views rather than replacing user data.

## Conventions worth keeping

- **UI is react-native**, not DOM: `View`, `Text`, `Pressable`, `ScrollView`. Style objects come from `theme` (`PluginTheme`) — never hardcode colors; use `theme.colors.*` and the helpers in `client/format.ts` for state/review/check coloring.
- **Errors**: server handlers throw `Error` with a human message (see `describeGhFailure` — it special-cases missing `gh` and auth failures); the client catches and shows `toast.error` or inline text. Keep messages actionable.
- **`shortcut:` comments** mark known limits with an upgrade trigger (e.g. the inline-review-comments limit in `loadPrDetails`). Add one when you deliberately ship a bounded solution.
- Comments explain *why*, not what — e.g. the note on why search uses the raw `search/issues` endpoint.

## Gotchas (learned the hard way)

- **`gh search prs` mangles queries** (rewrites `author:@me is:open` into one quoted blob). Search goes through `gh api search/issues -f q="type:pr <query>"` instead. Don't "simplify" it back to `gh search prs`.
- **Review decision and CI badges** come from one batched GraphQL call (`enrich` in `server/github.ts`, up to 100 node ids). A token without the Checks permission fails the whole `statusCheckRollup` field — the handler degrades to no badges rather than erroring. Preserve that degradation.
- **Check rollup semantics** live in pure functions in `shared/prs.ts` (`checkRunOutcome`, `statusContextOutcome`, `rollupContextsToChecks`, `foldChecks`) so they're testable without a daemon. CheckRuns use status/conclusion; StatusContexts use state; only the latest run per check name counts.
- **GitHub's search index lags a merge by a few seconds.** Right after merging, an `is:open` search can still return the just-merged PR (freshly indexed as `merged`). That's why `prs-screen.tsx` tracks `mergingKeys`: the row locks (disabled, dimmed, "merging…") on merge success, a forced refresh runs, and the just-merged key is filtered out of that one refresh's results. If you touch the refresh path, keep this behavior — without it the merged row lingers in open-only views.
- **List state in `prs-screen.tsx`**: `viewCache` holds 10-minute per-view caches; `requestSeq` invalidates stale in-flight searches (cheaper than AbortController across RPC). Forced refreshes (`force=true`) keep showing the old list while reloading; non-forced switches clear it.
- **Merge fallback**: `mergePullRequest` tries `--merge`, then `--squash`, then `--rebase`, only retrying when the error says the method is disallowed. Don't flatten this into a single strategy flag.
- **Send to chat** (`server/chat.ts`) matches the PR repo to a Paseo project by `projectKey` first, then by `origin` remote containment, cuts a worktree, and starts an agent with the host's default provider/model. The error when no project matches tells the user to add the repo as a project — keep that wording actionable.

## Dev loop

```sh
npm run typecheck                              # the only gate; there is no test suite
paseo plugin install /path/to/paseo-github     # first time
paseo plugin reload paseo-github-prs           # after every change
paseo plugin logs paseo-github-prs             # server-side errors land here
```

Client errors surface in the app (toast/inline); server errors surface via `paseo plugin logs`. Verify changes against both.

## Reference

- `README.md` — user-facing features, install, known limits
- `OVERVIEW.md` — plugin-store listing text
- Paseo plugin API: `@getpaseo/plugin` (0.13.x) — `defineRpc`, `defineSettings`, `server.handle`, `useRpc`, `useSettings`, `client.addScreen`, `client.addSidebarHeaderItem`
