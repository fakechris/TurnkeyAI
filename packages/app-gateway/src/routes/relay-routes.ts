import type http from "node:http";

import type { BrowserTaskResult } from "@turnkeyai/core-types/team";
import type { RelayGateway } from "@turnkeyai/browser-bridge/transport/relay-gateway";

import { readJsonBody, sendJson } from "../http-helpers";

export async function handleRelayRoutes(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  relayGateway: RelayGateway | null;
}): Promise<boolean> {
  const { req, res, url, relayGateway } = input;

  if (req.method === "GET" && url.pathname === "/relay/peers") {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    sendJson(res, 200, relayGateway.listPeers());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/relay/peers/register") {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    const body = await readJsonBody<{
      peerId?: string;
      label?: string;
      capabilities?: string[];
      transportLabel?: string;
    }>(req);
    if (!body.peerId?.trim()) {
      sendJson(res, 400, { error: "peerId is required" });
      return true;
    }
    sendJson(
      res,
      201,
      relayGateway.registerPeer({
        peerId: body.peerId,
        ...(body.label?.trim() ? { label: body.label.trim() } : {}),
        ...(Array.isArray(body.capabilities) ? { capabilities: body.capabilities } : {}),
        ...(body.transportLabel?.trim() ? { transportLabel: body.transportLabel.trim() } : {}),
      })
    );
    return true;
  }

  const relayPeerHeartbeatMatch = url.pathname.match(/^\/relay\/peers\/([^/]+)\/heartbeat$/);
  if (req.method === "POST" && relayPeerHeartbeatMatch) {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    sendJson(res, 200, relayGateway.heartbeatPeer(decodeURIComponent(relayPeerHeartbeatMatch[1]!)));
    return true;
  }

  const relayPeerTargetsMatch = url.pathname.match(/^\/relay\/peers\/([^/]+)\/targets\/report$/);
  if (req.method === "POST" && relayPeerTargetsMatch) {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    const body = await readJsonBody<{
      targets?: Array<{
        relayTargetId?: string;
        url?: string;
        title?: string;
        status?: "open" | "attached" | "detached" | "closed";
      }>;
    }>(req);
    if (!Array.isArray(body.targets)) {
      sendJson(res, 400, { error: "targets array is required" });
      return true;
    }
    sendJson(
      res,
      200,
      relayGateway.reportTargets(
        decodeURIComponent(relayPeerTargetsMatch[1]!),
        body.targets.map((target) => ({
          relayTargetId: target.relayTargetId?.trim() ?? "",
          url: target.url ?? "",
          ...(target.title ? { title: target.title } : {}),
          ...(target.status ? { status: target.status } : {}),
        }))
      )
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/relay/targets") {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    const peerId = url.searchParams.get("peerId");
    sendJson(
      res,
      200,
      relayGateway.listTargets(peerId?.trim() ? { peerId: peerId.trim() } : undefined)
    );
    return true;
  }

  const relayPeerPullActionsMatch = url.pathname.match(/^\/relay\/peers\/([^/]+)\/pull-actions$/);
  if (req.method === "POST" && relayPeerPullActionsMatch) {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    sendJson(
      res,
      200,
      relayGateway.pullNextActionRequest(decodeURIComponent(relayPeerPullActionsMatch[1]!))
    );
    return true;
  }

  const relayPeerActionResultsMatch = url.pathname.match(/^\/relay\/peers\/([^/]+)\/action-results$/);
  if (req.method === "POST" && relayPeerActionResultsMatch) {
    if (!relayGateway) {
      sendJson(res, 503, { error: "relay browser transport is not active" });
      return true;
    }
    const peerId = decodeURIComponent(relayPeerActionResultsMatch[1]!);
    const body = await readJsonBody<{
      actionRequestId?: string;
      browserSessionId?: string;
      taskId?: string;
      relayTargetId?: string;
      url?: string;
      title?: string;
      status?: "completed" | "failed";
      page?: BrowserTaskResult["page"];
      trace?: BrowserTaskResult["trace"];
      screenshotPaths?: string[];
      screenshotPayloads?: Array<{
        label?: string;
        mimeType?: string;
        dataBase64?: string;
      }>;
      artifactIds?: string[];
      errorMessage?: string;
    }>(req);
    if (!body.actionRequestId?.trim() || !body.browserSessionId?.trim() || !body.taskId?.trim() || !body.relayTargetId?.trim()) {
      sendJson(res, 400, {
        error: "actionRequestId, browserSessionId, taskId, and relayTargetId are required",
      });
      return true;
    }
    if (!body.url?.trim()) {
      sendJson(res, 400, { error: "url is required" });
      return true;
    }
    if (!body.status) {
      sendJson(res, 400, { error: "status is required" });
      return true;
    }
    sendJson(
      res,
      200,
      relayGateway.submitActionResult({
        actionRequestId: body.actionRequestId.trim(),
        peerId,
        browserSessionId: body.browserSessionId.trim(),
        taskId: body.taskId.trim(),
        relayTargetId: body.relayTargetId.trim(),
        url: body.url.trim(),
        ...(body.title ? { title: body.title } : {}),
        status: body.status,
        ...(body.page ? { page: body.page } : {}),
        trace: Array.isArray(body.trace) ? body.trace : [],
        screenshotPaths: Array.isArray(body.screenshotPaths) ? body.screenshotPaths : [],
        screenshotPayloads: Array.isArray(body.screenshotPayloads)
          ? body.screenshotPayloads
              .filter(
                (payload): payload is { label?: string; mimeType: string; dataBase64: string } =>
                  Boolean(payload) &&
                  typeof payload === "object" &&
                  typeof payload.mimeType === "string" &&
                  typeof payload.dataBase64 === "string"
              )
              .map((payload) => ({
                ...(payload.label ? { label: payload.label } : {}),
                mimeType: payload.mimeType,
                dataBase64: payload.dataBase64,
              }))
          : [],
        artifactIds: Array.isArray(body.artifactIds) ? body.artifactIds : [],
        ...(body.errorMessage ? { errorMessage: body.errorMessage } : {}),
      })
    );
    return true;
  }

  return false;
}
