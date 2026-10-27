import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

const execFileAsync = promisify(execFile);

type Paseo = PluginHandlerContext["paseo"];

interface ProjectEntry {
  projectId: string;
  projectRootPath: string;
  projectDisplayName: string;
  projectKind: string;
  projectKey?: string | null;
}

// shortcut: matching is the daemon's projectKey, then origin remote containment; a project
// that only has the fork's upstream under another remote name will not match.
async function findProject(paseo: Paseo, repo: string): Promise<ProjectEntry> {
  const { projects } = (await paseo.projects.list()) as { projects: ProjectEntry[] };
  const key = `remote:github.com/${repo.toLowerCase()}`;
  const byKey = projects.find((project) => (project.projectKey ?? "").toLowerCase() === key);
  if (byKey) return byKey;
  for (const project of projects) {
    if (project.projectKind !== "git") continue;
    try {
      const { stdout } = await execFileAsync("git", ["-C", project.projectRootPath, "remote", "get-url", "origin"]);
      if (stdout.toLowerCase().includes(repo.toLowerCase())) return project;
    } catch {
      // No origin remote, or not a checkout anymore; it cannot match.
    }
  }
  throw new Error(
    `No Paseo project has a git remote pointing at ${repo}. Add it as a project first, then send again.`,
  );
}

async function defaultProvider(paseo: Paseo): Promise<string> {
  const snapshot = await paseo.providers.snapshot();
  const entry = snapshot.entries.find(
    (candidate) => candidate.enabled !== false && (candidate.models?.length ?? 0) > 0,
  );
  const model = entry?.models?.find((candidate) => candidate.isDefault) ?? entry?.models?.[0];
  if (!entry || !model) {
    throw new Error("No provider with an available model is configured on this host.");
  }
  return `${entry.provider}/${model.id}`;
}

export async function sendPrToChat(
  { repo, number, title, url }: { repo: string; number: number; title: string; url: string },
  { paseo }: PluginHandlerContext,
): Promise<{ workspaceId: string }> {
  const project = await findProject(paseo, repo);
  const prompt = [
    `Review pull request ${url}`,
    "",
    `Title: ${title}`,
    `Repository: ${repo} #${number}`,
    "",
    `Start by running \`gh pr checkout ${number}\` in this repository, then review the changes and report what needs attention.`,
  ].join("\n");
  const provider = await defaultProvider(paseo);
  const workspace = await paseo.workspaces.create({
    title: `${repo} #${number}`.slice(0, 200),
    firstAgentContext: { prompt, attachments: [] },
    source:
      project.projectKind === "git"
        ? { kind: "worktree", cwd: project.projectRootPath, projectId: project.projectId }
        : { kind: "directory", path: project.projectRootPath, projectId: project.projectId },
  });
  await workspace.agents
    .create({ config: { provider }, prompt })
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Workspace was created, but the agent could not be started: ${detail}`);
    });
  return { workspaceId: workspace.id };
}
