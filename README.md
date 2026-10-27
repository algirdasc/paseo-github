# GitHub PRs for Paseo

A [Paseo](https://paseo.sh) plugin that puts your GitHub pull requests in the sidebar: filtered views, CI and review status at a glance, and a detail panel with diffs, reviews, and comments — plus one-click approve, merge, and "send to chat".

## Features

- **Saved views from GitHub search queries.** The defaults are **Mine** (`is:pr is:open author:@me`) and **Review requests** (`is:pr review-requested:@me state:open archived:false sort:updated-desc`). Add your own with any query [GitHub search](https://docs.github.com/search-github/searching-on-github/searching-issues-and-pull-requests) supports; long-press a view chip or use Edit to change or remove it. Views persist on the host and sync across connected clients.
- **List with status.** Each row shows state (open, merged, closed, draft), review decision (Approved, Changes requested, Review required), and a CI check summary (`✓ passed`, `✗ failed`, `● pending`).
- **Detail panel.** Description, per-check results, reviews, comments, and per-file diffs with colored patches. Markdown bodies render with Paseo's own Markdown.
- **Actions.** Approve, merge (falls back to squash or rebase when the repo forbids merge commits), open on GitHub, and send the PR to a new workspace chat: the plugin finds the Paseo project whose git remote matches the repository, cuts a worktree, and starts a review agent with your default provider and model.
- **Pagination and caching.** 50 PRs per page with Load more; each view is cached for 10 minutes and Refresh forces a refetch.

## Requirements

- Paseo 0.13.2 or later.
- The [GitHub CLI](https://cli.github.com) (`gh`) installed and authenticated (`gh auth login`) on the machine running the Paseo daemon. All GitHub access goes through it, so no separate token setup is needed.
- Send to chat additionally needs the PR's repository added as a Paseo project.

## Install

From the Paseo app: **Settings → Plugins**, enable plugins, paste the repository URL into **Plugin source**:

```text
https://github.com/algirdasc/paseo-github
```

From the command line:

```sh
paseo plugin add git:algirdasc/paseo-github
```

Then open **GitHub PRs** in the sidebar.

## Update

```sh
paseo plugin update paseo-github-prs
```

## Known limits

- Inline review comments left on code lines are not shown; issue comments and review summaries are.
- File lists are capped at 100 files per PR.
- Check results come from the head commit's status rollup; checks still queued at fetch time show as pending.

## Development

```sh
npm install
npm run typecheck
paseo plugin install /path/to/paseo-github   # or: paseo plugin reload paseo-github-prs
paseo plugin logs paseo-github-prs
```

Inspired by [paseo-pr-views](https://github.com/pmusaraj/paseo-pr-views) and [paseo-github-integration](https://github.com/alysnnix/paseo-github-integration).

## License

[MIT](LICENSE)
