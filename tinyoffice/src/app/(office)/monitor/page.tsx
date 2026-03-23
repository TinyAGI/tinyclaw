"use client";

import { useState } from "react";
import { usePolling, useSSE, timeAgo } from "@/lib/hooks";
import {
  getAgents,
  getTeams,
  getQueueStatus,
  getLogs,
  type AgentConfig,
  type TeamConfig,
  type QueueStatus,
  type EventData,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Users,
  Inbox,
  Cpu,
  Send,
  MessageSquare,
  Activity,
  ScrollText,
  RefreshCw,
} from "lucide-react";

export default function MonitorPage() {
  const { data: agents } = usePolling<Record<string, AgentConfig>>(getAgents, 0);
  const { data: teams } = usePolling<Record<string, TeamConfig>>(getTeams, 0);
  const { data: queue } = usePolling<QueueStatus>(getQueueStatus, 2000);
  const { data: logs, refresh: refreshLogs } = usePolling<{ lines: string[] }>(
    () => getLogs(200),
    5000
  );
  const { events } = useSSE(100);

  const agentCount = agents ? Object.keys(agents).length : 0;
  const teamCount = teams ? Object.keys(teams).length : 0;

  const [tab, setTab] = useState<"events" | "logs">("events");

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatCard icon={<Bot className="h-4 w-4" />} label="Agents" value={agentCount} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Teams" value={teamCount} />
        <StatCard icon={<Inbox className="h-4 w-4" />} label="Incoming" value={queue?.incoming ?? 0} accent={queue != null && queue.incoming > 0} />
        <StatCard icon={<Cpu className="h-4 w-4" />} label="Processing" value={queue?.processing ?? 0} accent={queue != null && queue.processing > 0} />
        <StatCard icon={<Send className="h-4 w-4" />} label="Outgoing" value={queue?.outgoing ?? 0} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} label="Conversations" value={queue?.activeConversations ?? 0} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="Events" value={events.length} />
      </div>

      {/* Tabs + Content */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 border-b">
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
        </div>
        {tab === "logs" && (
          <Button variant="outline" size="sm" onClick={() => refreshLogs()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        )}
      </div>

      {tab === "events" ? (
        <Card>
          <CardContent className="p-4">
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-2">
              {events.length > 0 ? (
                events.map((event, i) => (
                  <EventEntry key={`${event.timestamp}-${i}`} event={event} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No events yet. Send a message to get started.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Queue Processor Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {logs && logs.lines.length > 0 ? (
                <pre className="text-xs font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {logs.lines.map((line, i) => (
                    <LogLine key={i} line={line} />
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No logs yet
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <div className="mt-1">
          <span className={`text-2xl font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function LogLine({ line }: { line: string }) {
  let levelClass = "text-muted-foreground";
  if (line.includes("[ERROR]")) levelClass = "text-destructive";
  else if (line.includes("[WARN]")) levelClass = "text-yellow-500";
  else if (line.includes("[INFO]") && line.includes("\u2713")) levelClass = "text-emerald-500";

  return (
    <div className={`${levelClass} py-0.5 border-b border-border/20`}>
      {line}
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
