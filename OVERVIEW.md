# GitHub PRs

A sidebar screen that lists your GitHub pull requests, organized into named views you define with GitHub search queries.

The default **Mine** view runs `is:pr is:open author:@me`. Add your own views with any query GitHub's search supports, such as `is:pr is:open review-requested:@me` or `repo:acme/app is:pr label:urgent`. Long-press a view chip (or use Edit) to rename it, change its query, or delete it. Views are stored on the host and shared by every connected client.

Each row shows the PR number, title, repository, author, state (open, merged, closed, draft), last update time, review decision, and a CI check summary. Selecting a row opens a detail panel with the description, per-check results, reviews, comments, and per-file diffs, plus buttons to approve, merge, open on GitHub, or send the PR to a new workspace chat. Lists paginate with Load more, 50 PRs at a time.

Requires the GitHub CLI (`gh`) installed and authenticated on the machine running the Paseo daemon; searches, details, and actions run there through the GitHub API via `gh api` and `gh pr`, so no separate token setup is needed. Send to chat needs the PR's repository added as a Paseo project; it starts a review agent in a worktree with the default provider and model. Inline code comments are not shown; file lists are capped at 100 files per PR.
