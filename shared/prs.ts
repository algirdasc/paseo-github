import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const savedView = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  query: z.string().trim().min(1).max(500),
});
export type SavedView = z.output<typeof savedView>;

export const DEFAULT_VIEWS: SavedView[] = [
  { id: "mine", name: "Mine", query: "is:pr is:open author:@me" },
  {
    id: "review-requests",
    name: "Review requests",
    query: "is:pr review-requested:@me state:open archived:false sort:updated-desc",
  },
];

export const viewsSettings = defineSettings({
  id: "views",
  scope: "host",
  version: 2,
  schema: z.object({ views: z.array(savedView).max(50).default(DEFAULT_VIEWS) }),
  // v1 stored only Mine; add any default view the saved document is missing.
  migrate: (values) => {
    const existing = z.object({ views: z.array(savedView) }).safeParse(values);
    const views = existing.success ? existing.data.views : [];
    return { views: [...views, ...DEFAULT_VIEWS.filter((view) => !views.some((saved) => saved.id === view.id))] };
  },
});

export const checkSummary = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});
export type CheckSummary = z.output<typeof checkSummary>;

export const reviewDecision = z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]);
export type ReviewDecision = z.output<typeof reviewDecision>;

export const pullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  repo: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  isDraft: z.boolean(),
  author: z.string(),
  updatedAt: z.string(),
  reviewDecision: reviewDecision.nullable(),
  checks: checkSummary.nullable(),
});
export type PullRequest = z.output<typeof pullRequest>;

export const searchPrs = defineRpc({
  name: "prs.search",
  input: z.object({
    query: z.string().trim().min(1).max(500),
    page: z.number().int().min(1).max(20).default(1),
  }),
  output: z.object({ prs: z.array(pullRequest), total: z.number().int().nonnegative() }),
});

export const checkItem = z.object({
  name: z.string(),
  outcome: z.enum(["passed", "failed", "pending"]),
});
export type CheckItem = z.output<typeof checkItem>;

export const reviewItem = z.object({
  author: z.string(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string(),
});

export const commentItem = z.object({
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});

export const fileItem = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().nullable(),
});

export const prDetails = defineRpc({
  name: "prs.details",
  input: z.object({ repo: z.string().regex(/^[^/]+\/[^/]+$/), number: z.number().int().positive() }),
  output: z.object({
    body: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    checks: z.array(checkItem),
    reviews: z.array(reviewItem),
    comments: z.array(commentItem),
    files: z.array(fileItem),
    truncatedFiles: z.boolean(),
  }),
});
export type PrDetails = z.output<typeof prDetails.output>;

export const approvePr = defineRpc({
  name: "prs.approve",
  input: z.object({ repo: z.string().regex(/^[^/]+\/[^/]+$/), number: z.number().int().positive() }),
  output: z.object({}),
});

export const mergePr = defineRpc({
  name: "prs.merge",
  input: z.object({ repo: z.string().regex(/^[^/]+\/[^/]+$/), number: z.number().int().positive() }),
  output: z.object({ strategy: z.string() }),
});

export const sendPrToChat = defineRpc({
  name: "prs.send-to-chat",
  input: z.object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/),
    number: z.number().int().positive(),
    title: z.string(),
    url: z.string().url(),
  }),
  output: z.object({ workspaceId: z.string() }),
});

const REPOSITORY_URL_PREFIX = "https://api.github.com/repos/";

/** One item from the GitHub search/issues API response. Fields arrive as the API names them. */
export function toPullRequest(item: {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  updated_at: string;
  repository_url: string;
  node_id: string;
  user?: { login: string } | null;
  pull_request?: { merged_at?: string | null };
}): { nodeId: string; pr: Omit<PullRequest, "reviewDecision" | "checks"> } {
  return {
    nodeId: item.node_id,
    pr: {
      number: item.number,
      title: item.title,
      url: item.html_url,
      repo: item.repository_url.replace(REPOSITORY_URL_PREFIX, ""),
      state: item.pull_request?.merged_at ? "merged" : item.state === "open" ? "open" : "closed",
      isDraft: item.draft ?? false,
      author: item.user?.login ?? "unknown",
      updatedAt: item.updated_at,
    },
  };
}

export type CheckOutcome = "passed" | "failed" | "pending" | "ignored";

/** Maps a CheckRun's status/conclusion pair the way GitHub's own rollup summarizes it. */
export function checkRunOutcome(status: unknown, conclusion: unknown): CheckOutcome {
  if (status !== "COMPLETED") return "pending";
  switch (conclusion) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failed";
    case "CANCELLED":
    case "SKIPPED":
    case "NEUTRAL":
    case "STALE":
      return "ignored";
    default:
      return "pending";
  }
}

/** The commit-status half of the rollup, which has states rather than conclusions. */
export function statusContextOutcome(state: unknown): CheckOutcome {
  switch (state) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
    case "ERROR":
      return "failed";
    default:
      return "pending";
  }
}

interface RollupContextNode {
  __typename?: unknown;
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  context?: unknown;
  state?: unknown;
  createdAt?: unknown;
}

// shortcut: recency is timestamp-only, so two runs of the same check completing in the same
// second can fold in either order; add the workflow run id like pr-views does if that bites.
export function rollupContextsToChecks(nodes: readonly unknown[]): CheckItem[] {
  const latest = new Map<string, { outcome: CheckOutcome; recency: number }>();
  for (const raw of nodes) {
    const node = (raw ?? {}) as RollupContextNode;
    let name: string;
    let outcome: CheckOutcome;
    let time: unknown;
    if (node.__typename === "CheckRun") {
      name = typeof node.name === "string" ? node.name : "";
      outcome = checkRunOutcome(node.status, node.conclusion);
      time = node.completedAt ?? node.startedAt;
    } else if (node.__typename === "StatusContext") {
      name = typeof node.context === "string" ? node.context : "";
      outcome = statusContextOutcome(node.state);
      time = node.createdAt;
    } else {
      continue;
    }
    if (outcome === "ignored") continue;
    const recency = typeof time === "string" ? Date.parse(time) || 0 : 0;
    const existing = latest.get(name);
    if (!existing || recency >= existing.recency) latest.set(name, { outcome, recency });
  }
  return [...latest].map(([name, { outcome }]) => ({ name, outcome: outcome as CheckItem["outcome"] }));
}

export function foldChecks(checks: readonly CheckItem[]): CheckSummary | null {
  const summary = { passed: 0, failed: 0, pending: 0 };
  for (const check of checks) summary[check.outcome] += 1;
  const total = summary.passed + summary.failed + summary.pending;
  return total === 0 ? null : summary;
}
