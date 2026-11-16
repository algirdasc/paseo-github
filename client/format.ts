import type { PluginTheme } from "@getpaseo/plugin";
import type { PullRequest, ReviewDecision } from "../shared/prs";

export function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const GITHUB_STATE_COLORS: Record<PullRequest["state"], string> = {
  open: "#1a7f37",
  merged: "#8250df",
  closed: "#cf222e",
};

// shortcut: one palette for both color schemes (GitHub's light-mode values); if the dots
// look dim on a dark theme, branch on surface0 luminance for the #3fb950/#a371f7/#f85149 set.
export function stateColor(state: PullRequest["state"]): string {
  return GITHUB_STATE_COLORS[state];
}

export function reviewDecisionLabel(decision: ReviewDecision | null): string | null {
  if (decision === "APPROVED") return "Approved";
  if (decision === "CHANGES_REQUESTED") return "Changes requested";
  if (decision === "REVIEW_REQUIRED") return "Review required";
  return null;
}

export function reviewDecisionColor(decision: ReviewDecision | null, theme: PluginTheme): string {
  if (decision === "APPROVED") return theme.colors.statusSuccess;
  if (decision === "CHANGES_REQUESTED") return theme.colors.statusDanger;
  return theme.colors.foregroundMuted;
}

export function checkOutcomeColor(outcome: "passed" | "failed" | "pending", theme: PluginTheme): string {
  if (outcome === "passed") return theme.colors.statusSuccess;
  if (outcome === "failed") return theme.colors.statusDanger;
  return theme.colors.statusWarning;
}
