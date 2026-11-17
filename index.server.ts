import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  approvePullRequest,
  loadPrDetails,
  markPullRequestReady,
  mergePullRequest,
  searchPullRequests,
  updatePullRequestBranch,
} from "./server/github";
import { sendPrToChat } from "./server/chat";
import {
  approvePr,
  mergePr,
  prDetails,
  readyPr,
  searchPrs,
  sendPrToChat as sendPrToChatRpc,
  updateBranchPr,
  viewsSettings,
} from "./shared/prs";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(viewsSettings);
  server.handle(searchPrs, searchPullRequests);
  server.handle(prDetails, loadPrDetails);
  server.handle(approvePr, approvePullRequest);
  server.handle(mergePr, mergePullRequest);
  server.handle(readyPr, markPullRequestReady);
  server.handle(updateBranchPr, updatePullRequestBranch);
  server.handle(sendPrToChatRpc, sendPrToChat);
  return () => {};
}
