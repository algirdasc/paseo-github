import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { PrsScreen } from "./client/prs-screen";

function PrsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="GitPullRequest"
      active={currentScreen?.screenId === "prs"}
      onPress={() => openScreen({ screenId: "prs" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "prs", title: "GitHub PRs", Component: PrsScreen });
  client.addSidebarHeaderItem({ id: "prs", title: "GitHub PRs", Component: PrsItem });
  return () => {};
}
