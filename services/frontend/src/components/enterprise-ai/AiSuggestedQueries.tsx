import {
  AlertTriangle,
  BarChart3,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  Radio,
  Server,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AISuggestionItem } from "@/types/ai";

function iconForPrompt(prompt: string): LucideIcon {
  const p = prompt.toLowerCase();
  if (p.includes("alert") || p.includes("critical") || p.includes("severity")) return AlertTriangle;
  if (p.includes("kpi") || p.includes("trend") || p.includes("metric")) return BarChart3;
  if (p.includes("health")) return Gauge;
  if (p.includes("dashboard")) return LayoutDashboard;
  if (p.includes("monitor") || p.includes("kafka") || p.includes("queue")) return Radio;
  if (p.includes("workflow") || p.includes("execution")) return Workflow;
  if (p.includes("device") || p.includes("site")) return Server;
  if (p.includes("publish") || p.includes("delivery")) return Sparkles;
  return HelpCircle;
}

export function AiSuggestedQueries({
  items,
  onPick,
}: {
  items: AISuggestionItem[];
  onPick: (prompt: string) => void;
}) {
  if (!items.length) {
    return <p className="dm-inline-summary">No suggestions yet.</p>;
  }
  return (
    <ul className="ea-suggest-list">
      {items.map((s) => {
        const Icon = iconForPrompt(s.prompt);
        return (
          <li key={s.id}>
            <button type="button" className="ea-suggest-item" onClick={() => onPick(s.prompt)}>
              <Icon className="ea-suggest-icon" size={18} strokeWidth={2} aria-hidden />
              <span>{s.prompt}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
