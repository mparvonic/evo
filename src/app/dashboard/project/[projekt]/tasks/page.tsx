"use client";

import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatTaskTs(updated_at?: string | number, created_at?: string | number): string {
  const raw = updated_at ?? created_at;
  if (!raw) return "";
  // updated_at přichází jako Unix timestamp (číslo), created_at jako ISO string
  const d = typeof raw === "number" ? new Date(raw * 1000) : new Date(raw);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Task = {
  task_id: string;
  zadani?: string;
  phase_context?: { current_phase?: string };
  updated_at?: string;
  created_at?: string;
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

export default function TasksPage() {
  const { projekt } = useParams<{ projekt: string }>();
  const { data: tasks, isLoading, mutate } = useSWR<Task[]>(
    `/api/projects/${projekt}/tasks`,
    fetcher,
    { refreshInterval: 10000 }
  );
  const [newTask, setNewTask] = useState("");
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!newTask.trim()) return;
    setStarting(true);
    try {
      await fetch(`/api/projects/${projekt}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zadani: newTask }),
      });
      setNewTask("");
      mutate();
    } finally {
      setStarting(false);
    }
  };

  const TERMINAL = new Set(["DONE", "CANCELLED", "FAILED"]);
  const active = (tasks ?? []).filter(t => !TERMINAL.has(t.phase_context?.current_phase ?? ""));
  const done = (tasks ?? []).filter(t => TERMINAL.has(t.phase_context?.current_phase ?? ""));

  return (
    <div className="max-w-3xl space-y-6">
      {/* Nový task */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Nový task</p>
        <div className="flex gap-3">
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder="Zadej co má EVO udělat..."
            className="flex-1 px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-600"
          />
          <button
            onClick={handleStart}
            disabled={starting || !newTask.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex-shrink-0"
          >
            {starting ? "Spouštím..." : "Spustit"}
          </button>
        </div>
      </div>

      {/* Aktivní tasky */}
      {active.length > 0 && (
        <section>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Aktivní ({active.length})</p>
          <div className="space-y-2">
            {active.map((t) => (
              <TaskRow key={t.task_id} task={t} projekt={projekt} />
            ))}
          </div>
        </section>
      )}

      {/* Dokončené tasky */}
      {done.length > 0 && (
        <section>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Dokončené ({done.length})</p>
          <div className="space-y-2">
            {done.map((t) => (
              <TaskRow key={t.task_id} task={t} projekt={projekt} />
            ))}
          </div>
        </section>
      )}

      {isLoading && (
        <p className="text-gray-600 text-sm">Načítám tasky...</p>
      )}
      {!isLoading && !tasks?.length && (
        <p className="text-gray-600 text-sm">Žádné tasky. Zadej nový úkol výše.</p>
      )}
    </div>
  );
}

function TaskRow({ task, projekt }: { task: Task; projekt: string }) {
  const phase = task.phase_context?.current_phase ?? "?";
  const color = PHASE_COLOR[phase] ?? "bg-gray-800 text-gray-400";
  const isWaiting = phase === "APPROVE" || phase === "APPROVE_PROD";

  return (
    <Link
      href={`/dashboard/project/${projekt}/tasks/${task.task_id}`}
      className="flex items-center gap-3 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors group"
    >
      <span className={`text-xs px-2 py-0.5 rounded font-mono flex-shrink-0 ${color}`}>{phase}</span>
      {isWaiting && <span className="text-xs text-yellow-500 flex-shrink-0">⏳ čeká na schválení</span>}
      <span className="text-sm text-gray-300 truncate group-hover:text-white flex-1">
        {task.zadani || task.task_id}
      </span>
      <span className="text-xs text-gray-700 font-mono flex-shrink-0">{task.task_id.slice(0, 8)}</span>
      {(task.updated_at || task.created_at) && (
        <span className="text-xs text-gray-600 flex-shrink-0">
          {formatTaskTs(task.updated_at, task.created_at)}
        </span>
      )}
    </Link>
  );
}
