import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { searchPrs, viewsSettings, type PullRequest, type SavedView } from "../shared/prs";
import { DetailPanel } from "./detail";
import { checkOutcomeColor, relativeTime, reviewDecisionColor, reviewDecisionLabel, stateColor } from "./format";

interface Draft {
  id: string | null;
  name: string;
  query: string;
}

function ViewEditor({
  draft,
  theme,
  saving,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: Draft;
  theme: PluginTheme;
  saving: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onDelete: (() => void) | null;
  onCancel: () => void;
}) {
  const input = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: theme.colors.foreground,
    fontSize: 14,
  } as const;
  const action = {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  } as const;
  return (
    <View style={{ gap: 12 }}>
      <TextInput
        value={draft.name}
        onChangeText={(name) => onChange({ ...draft, name })}
        placeholder="View name"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={input}
      />
      <TextInput
        value={draft.query}
        onChangeText={(query) => onChange({ ...draft, query })}
        placeholder="GitHub search query, e.g. is:pr is:open author:@me"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={input}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onSave}
          disabled={saving}
          style={[action, { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}
        >
          <Text style={{ color: theme.colors.accentForeground }}>{saving ? "Saving…" : "Save view"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={action}>
          <Text style={{ color: theme.colors.foreground }}>Cancel</Text>
        </Pressable>
        {onDelete ? (
          <Pressable accessibilityRole="button" onPress={onDelete} style={action}>
            <Text style={{ color: theme.colors.statusDanger }}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function prKey(pr: PullRequest): string {
  return `${pr.repo}#${pr.number}`;
}

function PrRow({
  pr,
  theme,
  active,
  onPress,
}: {
  pr: PullRequest;
  theme: PluginTheme;
  active: boolean;
  onPress: () => void;
}) {
  const decision = reviewDecisionLabel(pr.reviewDecision);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pr.repo}#${pr.number} ${pr.title}`}
      onPress={onPress}
      style={{
        flexDirection: "row",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 6,
        borderRadius: 6,
        backgroundColor: active ? theme.colors.surface1 : undefined,
        alignItems: "flex-start",
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          marginTop: 6,
          backgroundColor: stateColor(pr.state, theme),
        }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
          <Text style={{ color: theme.colors.foregroundMuted }}>#{pr.number}</Text> {pr.title}
          {pr.isDraft ? <Text style={{ color: theme.colors.foregroundMuted }}> (draft)</Text> : null}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {pr.repo} · {pr.author} · {pr.state} · {relativeTime(pr.updatedAt)}
          {decision ? (
            <Text>
              <Text> · </Text>
              <Text style={{ color: reviewDecisionColor(pr.reviewDecision, theme) }}>{decision}</Text>
            </Text>
          ) : null}
          {pr.checks ? (
            <Text>
              <Text> · </Text>
              {pr.checks.passed > 0 ? (
                <Text style={{ color: checkOutcomeColor("passed", theme) }}>✓{pr.checks.passed} </Text>
              ) : null}
              {pr.checks.failed > 0 ? (
                <Text style={{ color: checkOutcomeColor("failed", theme) }}>✗{pr.checks.failed} </Text>
              ) : null}
              {pr.checks.pending > 0 ? (
                <Text style={{ color: checkOutcomeColor("pending", theme) }}>●{pr.checks.pending}</Text>
              ) : null}
            </Text>
          ) : null}
        </Text>
      </View>
    </Pressable>
  );
}

export function PrsScreen({ theme, layout }: PluginScreenProps) {
  const settings = useSettings(viewsSettings);
  const search = useRpc(searchPrs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null);

  const views = settings.status === "ready" ? settings.values.views : [];
  const selected: SavedView | null = views.find((view) => view.id === selectedId) ?? views[0] ?? null;

  const viewCache = useRef(new Map<string, { prs: PullRequest[]; total: number; fetchedAt: number }>());
  const requestSeq = useRef(0);

  const refresh = useCallback(
    async (key: string, query: string, force = false) => {
      const cached = viewCache.current.get(key);
      if (!force && cached && Date.now() - cached.fetchedAt < 600_000) {
        // Invalidate any slower in-flight search, then serve the cached page instantly.
        requestSeq.current += 1;
        setLoading(false);
        setError(null);
        setPrs(cached.prs);
        setTotal(cached.total);
        return;
      }
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      if (!force) {
        setPrs(null);
        setTotal(0);
      }
      try {
        const page = await search({ query, page: 1 });
        if (seq !== requestSeq.current) return;
        viewCache.current.set(key, { prs: page.prs, total: page.total, fetchedAt: Date.now() });
        setPrs(page.prs);
        setTotal(page.total);
        setSelectedPr((current) =>
          current ? (page.prs.find((pr) => prKey(pr) === prKey(current)) ?? current) : null,
        );
      } catch (cause) {
        if (seq !== requestSeq.current) return;
        setPrs(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [search],
  );

  const loadMore = async () => {
    if (!selected || !prs || !selectedKey) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = await search({ query: selected.query, page: Math.floor(prs.length / 50) + 1 });
      if (seq !== requestSeq.current) return;
      const seen = new Set(prs.map(prKey));
      const next = [...prs, ...page.prs.filter((pr) => !seen.has(prKey(pr)))];
      setPrs(next);
      setTotal(page.total);
      const cached = viewCache.current.get(selectedKey);
      if (cached) viewCache.current.set(selectedKey, { prs: next, total: page.total, fetchedAt: cached.fetchedAt });
    } catch (cause) {
      if (seq !== requestSeq.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === requestSeq.current) setLoadingMore(false);
    }
  };

  const selectedKey = selected ? `${selected.id}:${selected.query}` : null;
  useEffect(() => {
    if (selected && selectedKey) void refresh(selectedKey, selected.query);
    else setPrs(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const saveDraft = async () => {
    if (settings.status !== "ready" || !draft) return;
    const name = draft.name.trim();
    const query = draft.query.trim();
    if (!name || !query) return;
    const next: SavedView = draft.id
      ? { id: draft.id, name, query }
      : { id: `view-${Date.now().toString(36)}`, name, query };
    const nextViews = draft.id
      ? views.map((view) => (view.id === draft.id ? next : view))
      : [...views, next];
    if (await settings.save({ views: nextViews }, settings.revision)) {
      setSelectedId(next.id);
      setDraft(null);
    }
  };

  const deleteDraft = async () => {
    if (settings.status !== "ready" || !draft?.id) return;
    const remaining = views.filter((view) => view.id !== draft.id);
    if (await settings.save({ views: remaining }, settings.revision)) {
      setSelectedId(remaining[0]?.id ?? null);
      setDraft(null);
    }
  };

  const padding = layout.compact ? 12 : 20;
  const chip = {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  } as const;

  const list = (
    <ScrollView contentContainerStyle={{ paddingHorizontal: padding, paddingTop: 15, paddingBottom: 24 }}>
      {draft ? (
        <ViewEditor
          draft={draft}
          theme={theme}
          saving={settings.saving}
          onChange={setDraft}
          onSave={() => void saveDraft()}
          onDelete={draft.id ? () => void deleteDraft() : null}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 8 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {settings.status === "ready" && selected
                ? `${prs?.length ?? "…"} of ${total} pull requests · ${selected.query}`
                : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {selected ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDraft({ id: selected.id, name: selected.name, query: selected.query })}
                  hitSlop={8}
                >
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Edit</Text>
                </Pressable>
              ) : null}
              {selected ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void refresh(`${selected.id}:${selected.query}`, selected.query, true)}
                  disabled={loading}
                  hitSlop={8}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{loading ? "Loading…" : "Refresh"}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {settings.status === "invalid" ? (
            <Text style={{ color: theme.colors.statusDanger }}>Saved views are invalid: {settings.error}</Text>
          ) : null}
          {error ? (
            <Text style={{ color: theme.colors.statusDanger, paddingVertical: 8 }}>{error}</Text>
          ) : prs === null ? (
            <Text style={{ color: theme.colors.foregroundMuted, paddingVertical: 8 }}>
              {loading ? "Loading…" : views.length === 0 ? "No views yet. Add one above." : ""}
            </Text>
          ) : prs.length === 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted, paddingVertical: 8 }}>
              No pull requests match this query.
            </Text>
          ) : (
            <>
              {prs.map((pr) => (
                <PrRow
                  key={prKey(pr)}
                  pr={pr}
                  theme={theme}
                  active={selectedPr !== null && prKey(selectedPr) === prKey(pr)}
                  onPress={() => setSelectedPr(pr)}
                />
              ))}
              {prs.length < total ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void loadMore()}
                  disabled={loadingMore}
                  style={{
                    marginTop: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: theme.colors.accent, fontSize: 13 }}>
                    {loadingMore ? "Loading…" : `Load more (${prs.length} of ${total})`}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
          {settings.saveError ? (
            <Text style={{ color: theme.colors.statusDanger, paddingTop: 8 }}>{settings.saveError}</Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: padding, paddingTop: 15, paddingBottom: 12, alignItems: "center" }}
      >
        {views.map((view) => {
          const active = view.id === selected?.id && !draft;
          return (
            <Pressable
              key={view.id}
              accessibilityRole="button"
              onPress={() => {
                setDraft(null);
                setSelectedPr(null);
                setSelectedId(view.id);
              }}
              onLongPress={() => setDraft({ id: view.id, name: view.name, query: view.query })}
              style={[
                chip,
                active
                  ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }
                  : { borderColor: theme.colors.border },
              ]}
            >
              <Text style={{ color: active ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 13 }}>
                {view.name}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New view"
          onPress={() => setDraft({ id: null, name: "", query: "" })}
          style={[chip, { borderColor: theme.colors.border }]}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 13 }}>+ New view</Text>
        </Pressable>
      </ScrollView>

      {layout.compact && selectedPr ? (
        <DetailPanel
          pr={selectedPr}
          theme={theme}
          compact
          onBack={() => setSelectedPr(null)}
          onChanged={() => selected && void refresh(`${selected.id}:${selected.query}`, selected.query, true)}
        />
      ) : layout.compact ? (
        list
      ) : (
        <View style={{ flex: 1, flexDirection: "row", borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <View style={{ flex: 2, minWidth: 280 }}>{list}</View>
          {selectedPr ? (
            <View style={{ flex: 3, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>
              <DetailPanel
                pr={selectedPr}
                theme={theme}
                compact={false}
                onBack={() => setSelectedPr(null)}
                onChanged={() => selected && void refresh(`${selected.id}:${selected.query}`, selected.query, true)}
              />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
