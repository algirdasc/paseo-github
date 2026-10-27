import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  foldChecks,
  rollupContextsToChecks,
  toPullRequest,
  type CheckItem,
  type PrDetails,
  type PullRequest,
} from "../shared/prs";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function describeGhFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    return "GitHub CLI (gh) is not installed or not on the daemon's PATH.";
  }
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr).trim() : "";
  if (stderr.toLowerCase().includes("auth")) {
    return "GitHub CLI is not authenticated. Run `gh auth login` on the daemon machine.";
  }
  if (stderr !== "") return stderr;
  return error instanceof Error ? error.message : String(error);
}

export async function gh(args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", [...args], { maxBuffer: MAX_OUTPUT_BYTES });
    return stdout;
  } catch (error) {
    throw new Error(describeGhFailure(error));
  }
}

const ROLLUP_SELECTION = `
  id
  reviewDecision
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion startedAt completedAt }
              ... on StatusContext { context state createdAt }
            }
          }
        }
      }
    }
  }
`;

interface Enrichment {
  reviewDecision: PullRequest["reviewDecision"];
  checks: PullRequest["checks"];
  checkItems: CheckItem[];
}

/** Batches review decision and check rollups for up to 100 PR node ids into one GraphQL call. */
async function enrich(nodeIds: readonly string[]): Promise<Map<string, Enrichment>> {
  const result = new Map<string, Enrichment>();
  if (nodeIds.length === 0) return result;
  const ids = nodeIds.map((id) => JSON.stringify(id)).join(", ");
  const query = `query { nodes(ids: [${ids}]) { ... on PullRequest { ${ROLLUP_SELECTION} } } }`;
  const stdout = await gh(["api", "graphql", "-f", `query=${query}`]);
  const data = JSON.parse(stdout) as { data?: { nodes?: unknown[] }; errors?: { message: string }[] };
  if (data.errors && data.errors.length > 0) {
    // A token without the Checks permission fails the whole rollup field; degrade to no badges.
    if (data.errors.every((error) => /statusCheckRollup|Resource not accessible/i.test(error.message))) {
      return result;
    }
    throw new Error(data.errors.map((error) => error.message).join("; "));
  }
  for (const node of data.data?.nodes ?? []) {
    const pr = node as {
      id?: string;
      reviewDecision?: string | null;
      commits?: { nodes?: { commit?: { statusCheckRollup?: { contexts?: { nodes?: unknown[] } } } }[] };
    } | null;
    if (!pr?.id) continue;
    const contexts = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
    const checkItems = rollupContextsToChecks(contexts);
    const decision = pr.reviewDecision;
    result.set(pr.id, {
      reviewDecision:
        decision === "APPROVED" || decision === "CHANGES_REQUESTED" || decision === "REVIEW_REQUIRED"
          ? decision
          : null,
      checks: foldChecks(checkItems),
      checkItems,
    });
  }
  return result;
}

export async function searchPullRequests({
  query,
  page,
}: {
  query: string;
  page: number;
}): Promise<{ prs: PullRequest[]; total: number }> {
  // gh search prs rewrites free-text queries and mangles qualifier combinations
  // (author:@me is:open became author:"@me is:open"), so search goes through the
  // same API endpoint github.com/search uses, with type:pr scoping it to PRs.
  const stdout = await gh([
    "api",
    "-X",
    "GET",
    "search/issues",
    "-f",
    `q=type:pr ${query}`,
    "-f",
    "per_page=50",
    "-f",
    `page=${page}`,
  ]);
  const response = JSON.parse(stdout) as {
    total_count?: number;
    items?: Parameters<typeof toPullRequest>[0][];
  };
  const rows = (response.items ?? []).map(toPullRequest);
  const enrichment = await enrich(rows.map((row) => row.nodeId));
  return {
    prs: rows.map((row) => ({
      ...row.pr,
      reviewDecision: enrichment.get(row.nodeId)?.reviewDecision ?? null,
      checks: enrichment.get(row.nodeId)?.checks ?? null,
    })),
    total: response.total_count ?? rows.length,
  };
}

interface RestComment {
  body?: string | null;
  created_at?: string;
  submitted_at?: string;
  state?: string;
  user?: { login?: string } | null;
}

export async function loadPrDetails({ repo, number }: { repo: string; number: number }): Promise<PrDetails> {
  const pr = JSON.parse(await gh(["api", `repos/${repo}/pulls/${number}`])) as {
    body?: string | null;
    node_id: string;
    base?: { ref?: string };
    head?: { ref?: string };
    additions?: number;
    deletions?: number;
  };
  const [reviewsRaw, commentsRaw, filesRaw, enrichment] = await Promise.all([
    gh(["api", "-X", "GET", `repos/${repo}/pulls/${number}/reviews`, "-f", "per_page=100"]).then(JSON.parse),
    gh(["api", "-X", "GET", `repos/${repo}/issues/${number}/comments`, "-f", "per_page=100"]).then(JSON.parse),
    gh(["api", "-X", "GET", `repos/${repo}/pulls/${number}/files`, "-f", "per_page=100"]).then(JSON.parse),
    enrich([pr.node_id]),
  ]);
  const files = (filesRaw as {
    filename?: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }[]).map((file) => ({
    path: file.filename ?? "?",
    status: file.status ?? "modified",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    patch: file.patch ?? null,
  }));
  // shortcut: review comments left inline on code lines are not fetched; only issue
  // comments and review summaries show. Add pulls/{n}/comments if someone misses them.
  return {
    body: pr.body ?? "",
    baseRef: pr.base?.ref ?? "",
    headRef: pr.head?.ref ?? "",
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    checks: enrichment.get(pr.node_id)?.checkItems ?? [],
    reviews: (reviewsRaw as RestComment[])
      .filter((review) => review.state && review.state !== "PENDING")
      .map((review) => ({
        author: review.user?.login ?? "unknown",
        state: review.state ?? "COMMENTED",
        body: review.body ?? "",
        submittedAt: review.submitted_at ?? "",
      })),
    comments: (commentsRaw as RestComment[]).map((comment) => ({
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      createdAt: comment.created_at ?? "",
    })),
    files,
    truncatedFiles: files.length === 100,
  };
}

export async function approvePullRequest({ repo, number }: { repo: string; number: number }): Promise<{}> {
  await gh(["pr", "review", `https://github.com/${repo}/pull/${number}`, "--approve"]);
  return {};
}

export async function mergePullRequest({
  repo,
  number,
}: {
  repo: string;
  number: number;
}): Promise<{ strategy: string }> {
  const url = `https://github.com/${repo}/pull/${number}`;
  let lastError: unknown;
  for (const flag of ["--merge", "--squash", "--rebase"]) {
    try {
      await gh(["pr", "merge", url, flag]);
      return { strategy: flag.slice(2) };
    } catch (error) {
      lastError = error;
      if (!/not allowed|not supported|merge method/i.test(String(error))) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
