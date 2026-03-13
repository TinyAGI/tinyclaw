"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";

// ── Skill types ──────────────────────────────────────────────────────────────

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

interface ConstellationProps {
  skills: SkillEntry[];
  equipped: Set<string>;
  onToggle: (id: string) => void;
  agentName: string;
  agentInitials: string;
}

// ── Radial layout helpers ────────────────────────────────────────────────────

function layoutRadial(
  count: number,
  cx: number,
  cy: number,
  baseRadius: number
): { x: number; y: number; angle: number; ring: number }[] {
  if (count === 0) return [];

  const positions: { x: number; y: number; angle: number; ring: number }[] = [];

  // For small counts, single ring
  // For larger counts, distribute across multiple rings
  const perRing = Math.min(count, 10);
  const rings = Math.ceil(count / perRing);

  let idx = 0;
  for (let ring = 0; ring < rings && idx < count; ring++) {
    const radius = baseRadius + ring * 90;
    const itemsInRing = Math.min(perRing, count - idx);
    const angleOffset = ring * 0.15; // Slight rotation per ring for visual interest

    for (let i = 0; i < itemsInRing; i++) {
      const angle = angleOffset + (i / itemsInRing) * Math.PI * 2;
      positions.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        angle,
        ring,
      });
      idx++;
    }
  }

  return positions;
}

// ── Constellation component ────────────────────────────────────────────────

export function SkillsConstellation({
  skills,
  equipped,
  onToggle,
  agentName,
  agentInitials,
}: ConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 900, h: 560 });
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null);

  // Measure container
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(([e]) => {
      setDimensions({ w: e.contentRect.width, h: e.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const cx = dimensions.w / 2;
  const cy = dimensions.h / 2;
  const baseRadius = Math.min(dimensions.w, dimensions.h) * 0.28;

  // Compute radial positions
  const positions = useMemo(
    () => layoutRadial(skills.length, cx, cy, baseRadius),
    [skills.length, cx, cy, baseRadius]
  );

  const equippedCount = equipped.size;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[560px] overflow-hidden bg-[#0a0a0a] border select-none"
    >
      {/* Radial gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(163,230,53,0.04) 0%, rgba(163,230,53,0.01) 35%, transparent 70%)",
        }}
      />

      {/* Subtle ring guides */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={dimensions.w}
        height={dimensions.h}
      >
        {/* Ring guides */}
        {Array.from({ length: Math.ceil(skills.length / 10) }).map((_, i) => (
          <circle
            key={`ring-${i}`}
            cx={cx}
            cy={cy}
            r={baseRadius + i * 90}
            fill="none"
            stroke="rgba(163,230,53,0.06)"
            strokeWidth={0.5}
            strokeDasharray="3 6"
          />
        ))}

        {/* Ray lines from center to each skill */}
        {positions.map((pos, i) => {
          const skill = skills[i];
          if (!skill) return null;
          const isEquipped = equipped.has(skill.id);
          const isHovered = hoveredSkill === skill.id;

          return (
            <line
              key={`ray-${skill.id}`}
              x1={cx}
              y1={cy}
              x2={pos.x}
              y2={pos.y}
              stroke={
                isEquipped
                  ? "rgb(163,230,53)"
                  : isHovered
                    ? "rgba(163,230,53,0.3)"
                    : "rgba(163,230,53,0.08)"
              }
              strokeWidth={isEquipped ? 1.5 : 0.5}
              strokeDasharray={isEquipped ? "none" : "2 4"}
              style={{
                transition: "stroke 0.3s, stroke-width 0.3s",
              }}
            />
          );
        })}

        {/* Equipped skill glow dots along rays */}
        {positions.map((pos, i) => {
          const skill = skills[i];
          if (!skill || !equipped.has(skill.id)) return null;
          // Small pulsing dot at midpoint of ray
          const mx = (cx + pos.x) / 2;
          const my = (cy + pos.y) / 2;
          return (
            <circle
              key={`dot-${skill.id}`}
              cx={mx}
              cy={my}
              r={2}
              fill="rgb(163,230,53)"
              opacity={0.6}
              className="animate-pulse-dot"
            />
          );
        })}
      </svg>

      {/* Center agent avatar */}
      <div
        className="absolute z-20 flex flex-col items-center gap-1"
        style={{ left: cx - 32, top: cy - 44 }}
      >
        <div className="relative">
          <div className="h-16 w-16 border-2 border-primary bg-card flex items-center justify-center text-xl font-bold text-primary shadow-[0_0_20px_rgba(163,230,53,0.15)]">
            {agentInitials}
          </div>
          {equippedCount > 0 && (
            <div className="absolute -bottom-1 -right-1 h-5 w-5 bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
              {equippedCount}
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
          {agentName}
        </span>
        {equippedCount > 0 && (
          <Badge className="bg-primary/20 text-primary text-[9px] px-1.5 py-0">
            {equippedCount} equipped
          </Badge>
        )}
      </div>

      {/* Skill nodes positioned radially */}
      {positions.map((pos, i) => {
        const skill = skills[i];
        if (!skill) return null;
        const isEquipped = equipped.has(skill.id);
        const isHovered = hoveredSkill === skill.id;

        return (
          <div
            key={skill.id}
            data-skill-node
            className="absolute group"
            style={{
              left: pos.x - 55,
              top: pos.y - 18,
              zIndex: isHovered ? 30 : isEquipped ? 15 : 10,
              transition: "left 0.4s ease, top 0.4s ease",
            }}
            onMouseEnter={() => setHoveredSkill(skill.id)}
            onMouseLeave={() => setHoveredSkill(null)}
            onClick={() => onToggle(skill.id)}
          >
            {/* Node pill */}
            <div
              className={`
                relative flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer
                transition-all duration-200 whitespace-nowrap
                ${
                  isEquipped
                    ? "bg-primary/15 border border-primary/50 text-primary shadow-[0_0_8px_rgba(163,230,53,0.1)]"
                    : "bg-card/80 border border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                }
                ${isHovered ? "scale-110" : ""}
              `}
            >
              {/* Equipped indicator dot */}
              {isEquipped && (
                <span className="h-1.5 w-1.5 bg-primary animate-pulse-dot" />
              )}

              {/* Skill icon */}
              {skill.icon && (
                <span className="text-[10px] font-bold text-primary">
                  {skill.icon}
                </span>
              )}

              {/* Skill name */}
              <span className="text-xs font-medium">{skill.name}</span>
            </div>

            {/* Hover tooltip */}
            {isHovered && skill.description && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-56 p-3 bg-popover border border-border/80 text-popover-foreground animate-slide-up">
                <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                  {skill.description}
                </p>
                <div className="pt-2 border-t border-border/50">
                  <span
                    className={`text-[10px] font-medium ${isEquipped ? "text-destructive" : "text-primary"}`}
                  >
                    Click to {isEquipped ? "unequip" : "equip"}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Bottom legend */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent z-30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold">
            Agent Skills
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-primary" />
            <span className="text-[10px] text-muted-foreground">equipped</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-muted-foreground/30" />
            <span className="text-[10px] text-muted-foreground">available</span>
          </div>
        </div>
      </div>
    </div>
  );
}
