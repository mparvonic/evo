"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Stats = {
  cpu?: number;
  ram?: number;
  gpu?: number;
  active_tasks?: number;
  tasks_waiting_approval?: number;
  langfuse_url?: string;
  prefect_url?: string;
  ollama_models?: string[];
};

type Project = { id: string; name: string };

type Task = {
  task_id: string;
  zadani?: string;
  phase_context?: { current_phase?: string };
  updated_at?: string;
};

const PHASE_COLOR: Record<string, string> = {
  INTAKE: "bg-gray-700 text-gray-300",
  PLAN: "bg-blue-900 text-blue-300",
  PROBE: "bg-indigo-900 text-indigo-300",
  DATALAB: "bg-purple-900 text-purple-300",
  BUILD: "bg-cyan-900 text-cyan-300",
  VERIFY: "bg-teal-900 text-teal-300",
  HEAL: "bg-orange-900 text-orange-300",
  PACKAGE: "bg-yellow-900 text-yellow-300",
  APPROVE: "bg-yellow-700 text-yellow-200",
  PROMOTE_STAGING: "bg-green-900 text-green-300",
  SMOKE: "bg-green-800 text-green-200",
  APPROVE_PROD: "bg-yellow-600 text-yellow-100",
  PROMOTE_PROD: "bg-green-700 text-green-200",
  DONE: "bg-gray-800 text-gray-500",
  CANCELLED: "bg-gray-900 text-gray-600",
  FAILED: "bg-red-950 text-red-400",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}

function ProjectTasksWidget({ projectId }: { projectId: string }) {
  const { data: tasks } = useSWR<Task[]>(`/api/projects/${projectId}/tasks`, fetcher, { refreshInterval: 15000 });
  const active = (tasks ?? []).filter(t => {
    const ph = t.phase_context?.current_phase ?? "";
    return !["DONE", "CANCELLED", "FAILED", ""].includes(ph);
  });

  if (!active.length) return null;

  return (
    <div className="space-y-1.5">
      {active.slice(0, 3).map((t) => {
        const phase = t.phase_context?.current_phase ?? "?";
        const color = PHASE_COLOR[phase] ?? "bg-gray-800 text-gray-400";
        return (
          <Link
            key={t.task_id}
            href={`/dashboard/project/${projectId}/tasks/${t.task_id}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
          >
            <span className={`text-xs px-2 py-0.5 rounded font-mono flex-shrink-0 ${color}`}>{phase}</span>
            <span className="text-sm text-gray-300 truncate group-hover:text-white flex-1">
              {t.zadani ?? t.task_id}
            </span>
            {t.updated_at && (
              <span className="text-xs text-gray-600 flex-shrink-0">
                {new Date(t.updated_at).toLocaleString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export default function DashboardOverview() {
  const { data: stats } = useSWR<Stats>("/api/system/stats", fetcher, { refreshInterval: 8000 });
  const { data: projects } = useSWR<Project[]>("/api/projects", fetcher, { refreshInterval: 30000 });

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-white">Přehled</h1>
        <p className="text-gray-500 text-sm mt-0.5">
          {new Date().toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Stats karty */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Aktivní tasky"
          value={stats?.active_tasks ?? "—"}
        />
        <StatCard
          label="Čeká schválení"
          value={stats?.tasks_waiting_approval ?? "—"}
          accent={stats?.tasks_waiting_approval ? "text-yellow-400" : undefined}
        />
        <StatCard
          label="CPU"
          value={stats?.cpu !== undefined ? `${stats.cpu}%` : "—"}
        />
        <StatCard
          label="RAM"
          value={stats?.ram !== undefined ? `${stats.ram} GB` : "—"}
          sub={stats?.gpu !== undefined ? `GPU ${stats.gpu}%` : undefined}
        />
      </div>

      {/* Projekty s aktivními tasky */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Aktivní projekty</h2>
        {projects?.map((p) => (
          <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <Link
                href={`/dashboard/project/${p.id}/tasks`}
                className="text-sm font-medium text-white hover:text-blue-400 transition-colors"
              >
                {p.name || p.id}
              </Link>
              <Link
                href={`/dashboard/project/${p.id}/tasks`}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Tasky →
              </Link>
            </div>
            <div className="px-2 py-2">
              <ProjectTasksWidget projectId={p.id} />
            </div>
          </div>
        ))}
        {!projects?.length && (
          <div className="text-gray-600 text-sm">Načítám projekty...</div>
        )}
      </div>

      {/* Systémové URL */}
      {(stats?.langfuse_url || stats?.prefect_url) && (
        <div className="mt-8 pt-6 border-t border-gray-800 flex gap-4">
          {stats.langfuse_url && (
            <a href={stats.langfuse_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              LangFuse ↗
            </a>
          )}
          {stats.prefect_url && (
            <a href={stats.prefect_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Prefect ↗
            </a>
          )}
        </div>
      )}

      {/* Ollama modely */}
      {stats?.ollama_models && stats.ollama_models.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-gray-600 mb-2">Ollama modely</p>
          <div className="flex flex-wrap gap-2">
            {stats.ollama_models.map((m) => (
              <span key={m} className="text-xs bg-gray-900 border border-gray-800 text-gray-400 px-2 py-1 rounded">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
