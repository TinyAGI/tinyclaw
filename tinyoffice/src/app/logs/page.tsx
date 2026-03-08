"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import {
  getLogs,
  getQueueRows,
  type EventData,
  type LogEntry,
  type QueueMessageRow,
  type QueueMessageStatus,
  type QueueResponseRow,
  type QueueResponseStatus,
  type QueueRowsResponse,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollText, Activity, RefreshCw, Database } from "lucide-react";

const DEFAULT_MESSAGE_STATUSES: QueueMessageStatus[] = ["pending", "processing", "dead"];
const DEFAULT_RESPONSE_STATUSES: QueueResponseStatus[] = ["pending"];
const DEFAULT_QUEUE_LIMIT = 100;
const EMPTY_QUEUE_DATA: QueueRowsResponse = {
  messages: [],
  responses: [],
  counts: {
    pending: 0,
    processing: 0,
    completed: 0,
    dead: 0,
    responsesPending: 0,
    responsesAcked: 0,
  },
};

export default function LogsPage() {
  const [tab, setTab] = useState<"logs" | "events" | "queue">("logs");
  const [messageStatuses, setMessageStatuses] = useState<QueueMessageStatus[]>(DEFAULT_MESSAGE_STATUSES);
  const [responseStatuses, setResponseStatuses] = useState<QueueResponseStatus[]>(DEFAULT_RESPONSE_STATUSES);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [limit, setLimit] = useState(DEFAULT_QUEUE_LIMIT);
  const { data: logs, refresh: refreshLogs } = usePolling<{ entries: LogEntry[] }>(
    () => getLogs(200),
    5000
  );
  const {
    data: queueData,
    error: queueError,
    loading: queueLoading,
    refresh: refreshQueue,
  } = usePolling<QueueRowsResponse>(
    () =>
      getQueueRows({
        messageStatus: messageStatuses,
        responseStatus: responseStatuses,
        search,
        limit,
      }),
    5000,
    [messageStatuses.join(","), responseStatuses.join(","), search, limit]
  );
  const { events } = useSSE(100);
  const queue = queueData ?? EMPTY_QUEUE_DATA;

  const toggleMessageStatus = (status: QueueMessageStatus) => {
    setMessageStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status]
    );
  };

  const toggleResponseStatus = (status: QueueResponseStatus) => {
    setResponseStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status]
    );
  };

  const handleRefresh = () => {
    refreshLogs();
    refreshQueue();
  };

  const applySearch = () => {
    setSearch(searchDraft.trim());
  };

  const clearSearch = () => {
    setSearchDraft("");
    setSearch("");
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-primary" />
            Logs & Events
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Structured runtime logs and live system events
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("logs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "logs"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ScrollText className="h-3.5 w-3.5 inline mr-1.5" />
          Logs
        </button>
        <button
          onClick={() => setTab("events")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "events"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-3.5 w-3.5 inline mr-1.5" />
          Events
          {events.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {events.length}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setTab("queue")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "queue"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Database className="h-3.5 w-3.5 inline mr-1.5" />
          Queue
          {(queue.counts.pending > 0 || queue.counts.processing > 0 || queue.counts.dead > 0) && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              {queue.counts.pending}
            </Badge>
          )}
        </button>
      </div>

      {tab === "logs" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Structured Runtime Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {logs && logs.entries.length > 0 ? (
                <div className="space-y-2">
                  {logs.entries.map((entry, i) => (
                    <LogEntryCard
                      key={`${entry.time}-${entry.source}-${entry.component}-${entry.messageId ?? "no-message"}-${i}`}
                      entry={entry}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No logs yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : tab === "events" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-2">
              {events.length > 0 ? (
                events.map((event, i) => (
                  <EventEntry key={`${event.timestamp}-${i}`} event={event} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No events yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Queue Browser</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <QueueCountCard label="Pending" value={queue.counts.pending} />
                <QueueCountCard label="Processing" value={queue.counts.processing} />
                <QueueCountCard label="Dead" value={queue.counts.dead} />
                <QueueCountCard label="Outgoing Pending" value={queue.counts.responsesPending} />
                <QueueCountCard label="Acked" value={queue.counts.responsesAcked} />
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Incoming statuses</p>
                  <div className="flex flex-wrap gap-2">
                    {(["pending", "processing", "dead", "completed"] as QueueMessageStatus[]).map((status) => (
                      <StatusToggle
                        key={status}
                        active={messageStatuses.includes(status)}
                        label={status}
                        onClick={() => toggleMessageStatus(status)}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Outgoing statuses</p>
                  <div className="flex flex-wrap gap-2">
                    {(["pending", "acked"] as QueueResponseStatus[]).map((status) => (
                      <StatusToggle
                        key={status}
                        active={responseStatuses.includes(status)}
                        label={status}
                        onClick={() => toggleResponseStatus(status)}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2 md:flex-row">
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applySearch();
                    }}
                    placeholder="Search message, sender, message ID, agent..."
                    className="md:flex-1"
                  />
                  <select
                    value={String(limit)}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="50">50 rows</option>
                    <option value="100">100 rows</option>
                    <option value="200">200 rows</option>
                  </select>
                  <Button variant="outline" size="sm" onClick={applySearch}>
                    Apply
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSearch}>
                    Clear
                  </Button>
                </div>
              </div>

              {queueError ? (
                <p className="text-sm text-destructive">Failed to load queue rows: {queueError}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Incoming Messages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {queue.messages.length > 0 ? (
                  queue.messages.map((entry) => (
                    <QueueMessageCard key={`message-${entry.id}-${entry.messageId}`} entry={entry} />
                  ))
                ) : (
                  <EmptyQueueState
                    loading={queueLoading}
                    label="No incoming queue rows match the current filters"
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Outgoing Responses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {queue.responses.length > 0 ? (
                  queue.responses.map((entry) => (
                    <QueueResponseCard key={`response-${entry.id}-${entry.messageId}`} entry={entry} />
                  ))
                ) : (
                  <EmptyQueueState
                    loading={queueLoading}
                    label="No outgoing response rows match the current filters"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function QueueCountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function StatusToggle({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" onClick={onClick} className="capitalize">
      {label}
    </Button>
  );
}

function EmptyQueueState({ loading, label }: { loading: boolean; label: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      {loading ? "Loading queue rows..." : label}
    </p>
  );
}

function EventEntry({ event }: { event: EventData }) {
  const typeColors: Record<string, string> = {
    message_received: "bg-blue-500",
    agent_routed: "bg-primary",
    chain_step_start: "bg-yellow-500",
    chain_step_done: "bg-green-500",
    response_ready: "bg-emerald-500",
    team_chain_start: "bg-purple-500",
    team_chain_end: "bg-purple-400",
    chain_handoff: "bg-orange-500",
    processor_start: "bg-primary",
    message_enqueued: "bg-cyan-500",
  };

  return (
    <div className="flex items-start gap-3 border-b border-border/50 pb-2">
      <div className={`mt-1.5 h-2 w-2 shrink-0 ${typeColors[event.type] || "bg-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-mono">
            {event.type}
          </Badge>
          {event.agentId ? (
            <Badge variant="secondary" className="text-[10px]">@{String(event.agentId)}</Badge>
          ) : null}
          {event.teamId ? (
            <Badge variant="secondary" className="text-[10px]">team:{String(event.teamId)}</Badge>
          ) : null}
        </div>
        {event.responseText ? (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
            {String(event.responseText).substring(0, 300)}
          </p>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(event.timestamp)}
      </span>
    </div>
  );
}

function LogEntryCard({ entry }: { entry: LogEntry }) {
  const levelClass: Record<LogEntry["level"], string> = {
    trace: "border-slate-400/20",
    debug: "border-slate-500/30",
    info: "border-border/50",
    warn: "border-yellow-500/30",
    error: "border-destructive/30",
    fatal: "border-destructive/50",
  };

  const levelBadge: Record<LogEntry["level"], string> = {
    trace: "secondary",
    debug: "secondary",
    info: "outline",
    warn: "secondary",
    error: "destructive",
    fatal: "destructive",
  };

  return (
    <div className={`rounded-md border p-3 space-y-2 ${levelClass[entry.level]}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={levelBadge[entry.level] as "outline" | "secondary" | "destructive"} className="text-[10px] uppercase">
          {entry.level}
        </Badge>
        <Badge variant="outline" className="text-[10px]">{entry.source}</Badge>
        <Badge variant="outline" className="text-[10px]">{entry.component}</Badge>
        {entry.channel ? <Badge variant="outline" className="text-[10px]">{entry.channel}</Badge> : null}
        {entry.agentId ? <Badge variant="secondary" className="text-[10px]">@{entry.agentId}</Badge> : null}
        {entry.teamId ? <Badge variant="secondary" className="text-[10px]">team:{entry.teamId}</Badge> : null}
        {entry.messageId ? <Badge variant="outline" className="text-[10px] font-mono">{entry.messageId}</Badge> : null}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {timeAgo(Date.parse(entry.time))}
        </span>
      </div>
      <p className="text-sm">{entry.msg}</p>
      {entry.excerpt ? (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{entry.excerpt}</p>
      ) : null}
      {(entry.fromAgent || entry.toAgent || entry.conversationId || entry.sender) ? (
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {entry.sender ? <span>sender: {entry.sender}</span> : null}
          {entry.fromAgent ? <span>from: @{entry.fromAgent}</span> : null}
          {entry.toAgent ? <span>to: @{entry.toAgent}</span> : null}
          {entry.conversationId ? <span className="font-mono">conv:{entry.conversationId}</span> : null}
        </div>
      ) : null}
      {entry.context && Object.keys(entry.context).length > 0 ? (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap rounded bg-muted/40 p-2 overflow-x-auto">
          {JSON.stringify(entry.context, null, 2)}
        </pre>
      ) : null}
      {entry.err?.message ? (
        <pre className="text-xs text-destructive whitespace-pre-wrap rounded bg-destructive/5 p-2 overflow-x-auto">
          {entry.err.stack || entry.err.message}
        </pre>
      ) : null}
    </div>
  );
}

function QueueMessageCard({ entry }: { entry: QueueMessageRow }) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <QueueStatusBadge status={entry.status} />
        <Badge variant="outline" className="text-[10px]">{entry.channel}</Badge>
        <Badge variant="outline" className="text-[10px]">{entry.sender}</Badge>
        {entry.agent ? <Badge variant="secondary" className="text-[10px]">@{entry.agent}</Badge> : null}
        {entry.fromAgent ? <Badge variant="secondary" className="text-[10px]">from:@{entry.fromAgent}</Badge> : null}
        <Badge variant="outline" className="text-[10px] font-mono">{entry.messageId}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(entry.createdAt)}</span>
      </div>

      <p className="text-sm whitespace-pre-wrap break-words line-clamp-3">{entry.message}</p>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>created {timeAgo(entry.createdAt)}</span>
        <span>updated {timeAgo(entry.updatedAt)}</span>
        {entry.conversationId ? <span className="font-mono">conv:{entry.conversationId}</span> : null}
        {entry.claimedBy ? <span>claimed by {entry.claimedBy}</span> : null}
        {entry.retryCount > 0 ? <span>retries {entry.retryCount}</span> : null}
        {entry.files.length > 0 ? <span>{entry.files.length} file{entry.files.length === 1 ? "" : "s"}</span> : null}
      </div>

      {entry.lastError ? (
        <pre className="overflow-x-auto rounded bg-destructive/5 p-2 text-xs text-destructive whitespace-pre-wrap">
          {entry.lastError}
        </pre>
      ) : null}
    </div>
  );
}

function QueueResponseCard({ entry }: { entry: QueueResponseRow }) {
  const metadataKeys = entry.metadata ? Object.keys(entry.metadata) : [];

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <QueueStatusBadge status={entry.status} />
        <Badge variant="outline" className="text-[10px]">{entry.channel}</Badge>
        <Badge variant="outline" className="text-[10px]">{entry.sender}</Badge>
        {entry.agent ? <Badge variant="secondary" className="text-[10px]">@{entry.agent}</Badge> : null}
        <Badge variant="outline" className="text-[10px] font-mono">{entry.messageId}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(entry.createdAt)}</span>
      </div>

      <p className="text-sm whitespace-pre-wrap break-words line-clamp-3">{entry.message}</p>
      {entry.originalMessage ? (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-2">
          Original: {entry.originalMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>created {timeAgo(entry.createdAt)}</span>
        {entry.ackedAt ? <span>acked {timeAgo(entry.ackedAt)}</span> : null}
        {entry.files.length > 0 ? <span>{entry.files.length} file{entry.files.length === 1 ? "" : "s"}</span> : null}
        {metadataKeys.length > 0 ? <span>metadata: {metadataKeys.join(", ")}</span> : null}
      </div>
    </div>
  );
}

function QueueStatusBadge({ status }: { status: QueueMessageStatus | QueueResponseStatus }) {
  const variant = status === "dead"
    ? "destructive"
    : status === "processing" || status === "acked"
      ? "secondary"
      : "outline";

  return (
    <Badge variant={variant as "outline" | "secondary" | "destructive"} className="text-[10px] uppercase">
      {status}
    </Badge>
  );
}
