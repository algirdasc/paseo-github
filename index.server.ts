import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  approvePullRequest,
  loadPrDetails,
  mergePullRequest,
  searchPullRequests,
} from "./server/github";
import { sendPrToChat } from "./server/chat";
import { approvePr, mergePr, prDetails, searchPrs, sendPrToChat as sendPrToChatRpc, viewsSettings } from "./shared/prs";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(viewsSettings);
  server.handle(searchPrs, searchPullRequests);
  server.handle(prDetails, loadPrDetails);
  server.handle(approvePr, approvePullRequest);
  server.handle(mergePr, mergePullRequest);
  server.handle(sendPrToChatRpc, sendPrToChat);
  return () => {};
}
