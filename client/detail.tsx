import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import {
  approvePr,
  mergePr,
  prDetails,
  sendPrToChat,
  type PrDetails,
  type PullRequest,
} from "../shared/prs";
import { checkOutcomeColor, relativeTime, reviewDecisionColor, reviewDecisionLabel, stateColor } from "./format";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

function Section({ title, theme, children }: { title: string; theme: PluginTheme; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Patch({ patch, theme }: { patch: string; theme: PluginTheme }) {
  return (
    <Text selectable style={{ fontFamily: MONOSPACE, fontSize: 12, lineHeight: 17 }}>
      {patch.split("\n").map((line, index) => {
        const color = line.startsWith("+") && !line.startsWith("+++")
          ? theme.colors.statusSuccess
          : line.startsWith("-") && !line.startsWith("---")
            ? theme.colors.statusDanger
            : line.startsWith("@@")
              ? theme.colors.accent
              : theme.colors.foregroundMuted;
        return (
          <Text key={index} style={{ color }}>
            {line}
            {"\n"}
          </Text>
        );
      })}
    </Text>
  );
}

export function DetailPanel({
  pr,
  theme,
  compact,
  onBack,
  onChanged,
}: {
  pr: PullRequest;
  theme: PluginTheme;
  compact: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const loadDetails = useRpc(prDetails);
  const approve = useRpc(approvePr);
  const merge = useRpc(mergePr);
  const sendToChat = useRpc(sendPrToChat);
  const [details, setDetails] = useState<PrDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDetails(await loadDetails({ repo: pr.repo, number: pr.number }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [loadDetails, pr.repo, pr.number]);

  useEffect(() => {
    setDetails(null);
    void refresh();
  }, [refresh]);

  const runAction = async (name: string, action: () => Promise<string>) => {
    setBusy(name);
    try {
      toast.show(await action(), { variant: "success" });
      await refresh();
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const button = {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  } as const;
  const open = pr.state === "open";
  const decision = reviewDecisionLabel(pr.reviewDecision);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {compact ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back to list" onPress={onBack} hitSlop={8}>
            <Text style={{ color: theme.colors.accent, fontSize: 14 }}>‹ Back</Text>
          </Pressable>
        ) : null}
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateColor(pr.state, theme) }} />
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          {pr.repo}#{pr.number}
        </Text>
      </View>
      <Text style={{ color: theme.colors.foreground, fontSize: 17, fontWeight: "600" }}>{pr.title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {pr.author} · {pr.state}
          {pr.isDraft ? " · draft" : ""} · updated {relativeTime(pr.updatedAt)}
          {decision ? (
            <Text>
              <Text> · </Text>
              <Text style={{ color: reviewDecisionColor(pr.reviewDecision, theme) }}>{decision}</Text>
            </Text>
          ) : null}
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void openExternalUrl(pr.url)}
          style={[button, { backgroundColor: theme.colors.surface1 }]}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Open on GitHub</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={() =>
            void runAction("chat", async () => {
              const { workspaceId } = await sendToChat({ repo: pr.repo, number: pr.number, title: pr.title, url: pr.url });
              return `Workspace ${workspaceId} started`;
            })
          }
          style={[button, { backgroundColor: theme.colors.surface1 }]}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
            {busy === "chat" ? "Sending…" : "Send to chat"}
          </Text>
        </Pressable>
        {open ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() =>
              void runAction("approve", async () => {
                await approve({ repo: pr.repo, number: pr.number });
                return "Approved";
              })
            }
            style={[button, { borderColor: theme.colors.statusSuccess }]}
          >
            <Text style={{ color: theme.colors.statusSuccess, fontSize: 13 }}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Text>
          </Pressable>
        ) : null}
        {open && !pr.isDraft ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() =>
              void runAction("merge", async () => {
                const { strategy } = await merge({ repo: pr.repo, number: pr.number });
                return `Merged (${strategy})`;
              })
            }
            style={[button, { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>
              {busy === "merge" ? "Merging…" : "Merge"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
      {!details && !error ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading details…</Text>
      ) : null}

      {details ? (
        <>
          {details.body.trim() !== "" ? (
            <Section title="Description" theme={theme}>
              <Markdown>{details.body}</Markdown>
            </Section>
          ) : null}

          {details.checks.length > 0 ? (
            <Section title="Checks" theme={theme}>
              {details.checks.map((check) => (
                <View key={check.name} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: checkOutcomeColor(check.outcome, theme),
                    }}
                  />
                  <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{check.name}</Text>
                </View>
              ))}
            </Section>
          ) : null}

          {details.reviews.length > 0 ? (
            <Section title="Reviews" theme={theme}>
              {details.reviews.map((review, index) => (
                <View key={index} style={{ gap: 2 }}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    <Text style={{ color: theme.colors.foreground }}>{review.author}</Text> ·{" "}
                    {review.state.replace(/_/g, " ").toLowerCase()}
                    {review.submittedAt ? ` · ${relativeTime(review.submittedAt)}` : ""}
                  </Text>
                  {review.body.trim() !== "" ? <Markdown>{review.body}</Markdown> : null}
                </View>
              ))}
            </Section>
          ) : null}

          {details.comments.length > 0 ? (
            <Section title="Comments" theme={theme}>
              {details.comments.map((comment, index) => (
                <View key={index} style={{ gap: 2 }}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    <Text style={{ color: theme.colors.foreground }}>{comment.author}</Text>
                    {comment.createdAt ? ` · ${relativeTime(comment.createdAt)}` : ""}
                  </Text>
                  <Markdown>{comment.body}</Markdown>
                </View>
              ))}
            </Section>
          ) : null}

          <Section
            title={`Files (${details.files.length}${details.truncatedFiles ? "+" : ""}) · +${details.additions} −${details.deletions}`}
            theme={theme}
          >
            {details.files.map((file) => (
              <View
                key={file.path}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 8,
                  padding: 10,
                  gap: 6,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12, fontFamily: MONOSPACE }}>
                  {file.path}{" "}
                  <Text style={{ color: theme.colors.statusSuccess }}>+{file.additions}</Text>{" "}
                  <Text style={{ color: theme.colors.statusDanger }}>−{file.deletions}</Text>
                </Text>
                {file.patch ? <Patch patch={file.patch} theme={theme} /> : null}
              </View>
            ))}
            {details.truncatedFiles ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                Only the first 100 files are shown.
              </Text>
            ) : null}
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}
