"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import { getLogs, type EventData, type LogEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Activity, RefreshCw } from "lucide-react";

export default function LogsPage() {
  const [tab, setTab] = useState<"logs" | "events">("logs");
  const { data: logs, refresh: refreshLogs } = usePolling<{ entries: LogEntry[] }>(
    () => getLogs(200),
    5000
  );
  const { events } = useSSE(100);

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
          onClick={() => refreshLogs()}
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
                    <LogEntryCard key={`${entry.time}-${entry.messageId ?? i}`} entry={entry} />
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
      ) : (
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
      )}
    </div>
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
    debug: "border-slate-500/30",
    info: "border-border/50",
    warn: "border-yellow-500/30",
    error: "border-destructive/30",
  };

  const levelBadge: Record<LogEntry["level"], string> = {
    debug: "secondary",
    info: "outline",
    warn: "secondary",
    error: "destructive",
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
