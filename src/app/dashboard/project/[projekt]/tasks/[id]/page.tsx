"use client";

import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type PhaseContext = {
  current_phase?: string;
  task_id?: string;
  zadani?: string;
  started_at?: string;
  updated_at?: string;
  error?: string;
  completed_phases?: string[];
  phase_results?: Record<string, Record<string, unknown>>;
  errors?: string[];
};

type TaskFile = { name: string; size: number; mtime: number };

type TaskDetail = {
  task_id: string;
  task_yaml?: Record<string, unknown>;
  phase_context?: PhaseContext;
  files?: TaskFile[];
};

const PHASE_COLOR: Record<string, string> = {
  INTAKE: "bg-gray-700 text-gray-300",
  PLAN: "bg-blue-900 text-blue-300",
  VERIFY: "bg-teal-900 text-teal-300",
  HEAL: "bg-orange-900 text-orange-300",
  PACKAGE: "bg-yellow-900 text-yellow-300",
  APPROVE: "bg-yellow-700 text-yellow-200",
  PROMOTE_STAGING: "bg-green-900 text-green-300",
  SMOKE: "bg-green-800 text-green-200",
  APPROVE_PROD: "bg-yellow-600 text-yellow-100",
  PROMOTE_PROD: "bg-green-700 text-green-200",
  DONE: "bg-gray-800 text-gray-500",
  COMPLETE: "bg-gray-800 text-gray-500",
  CANCELLED: "bg-gray-900 text-gray-600",
  FAILED: "bg-red-950 text-red-400",
};

const STEP_COLORS = [
  "bg-cyan-900 text-cyan-300", "bg-indigo-900 text-indigo-300",
  "bg-purple-900 text-purple-300", "bg-blue-800 text-blue-300",
  "bg-teal-900 text-teal-300",
];

function phaseColor(p: string): string {
  if (p.startsWith("STEP_")) {
    const i = parseInt(p.split("_")[1]) - 1;
    return STEP_COLORS[i % STEP_COLORS.length];
  }
  return PHASE_COLOR[p] ?? "bg-gray-800 text-gray-400";
}

/** Builds ordered phase list from what we know: completed + current + planned steps */
function buildPhases(pc?: PhaseContext): string[] {
  const completed = pc?.completed_phases ?? [];
  const current = pc?.current_phase;
  const nKroky = (pc?.phase_results?.PLAN as { kroky?: number } | undefined)?.kroky ?? 0;

  // Start with completed phases in order
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of completed) {
    if (!seen.has(p)) { result.push(p); seen.add(p); }
  }

  // Add current phase if not already there
  if (current && !seen.has(current) && !["DONE","COMPLETE","FAILED","CANCELLED"].includes(current)) {
    result.push(current);
    seen.add(current);
  }

  // Add remaining planned steps (from plan)
  if (nKroky > 0) {
    for (let i = 1; i <= nKroky; i++) {
      const s = `STEP_${i}`;
      if (!seen.has(s)) { result.push(s); seen.add(s); }
    }
  }

  // Add terminal phase
  if (current && ["DONE","COMPLETE","FAILED","CANCELLED"].includes(current)) {
    if (!seen.has(current)) { result.push(current); seen.add(current); }
  } else {
    result.push("DONE");
  }

  return result;
}

function getZadani(task?: TaskDetail, pc?: PhaseContext): string {
  // Try task_yaml first, then phase_context.phase_results.INTAKE.zadani, then pc.zadani
  const yamlZadani = task?.task_yaml && (task.task_yaml as { zadani?: string }).zadani;
  if (yamlZadani) return yamlZadani;
  const intakeZadani = pc?.phase_results?.INTAKE?.zadani;
  if (typeof intakeZadani === "string" && intakeZadani) return intakeZadani;
  return pc?.zadani ?? task?.task_id ?? "";
}

export default function TaskDetailPage() {
  const { projekt, id } = useParams<{ projekt: string; id: string }>();
  const router = useRouter();
  const [acting, setActing] = useState<string | null>(null);

  const { data: task, mutate } = useSWR<TaskDetail>(
    `/api/projects/${projekt}/tasks/${id}`,
    fetcher,
    { refreshInterval: 5000 }
  );

  const { data: pc } = useSWR<PhaseContext>(
    `/api/projects/${projekt}/tasks/${id}/phase-context`,
    fetcher,
    { refreshInterval: 3000 }
  );

  const phase = pc?.current_phase ?? task?.phase_context?.current_phase ?? "?";
  const isApprove = phase === "APPROVE";
  const isApproveProd = phase === "APPROVE_PROD";
  const isTerminal = ["DONE", "CANCELLED", "FAILED", "COMPLETE"].includes(phase);

  const doAction = async (action: string) => {
    setActing(action);
    try {
      await fetch(`/api/projects/${projekt}/tasks/${id}/${action}`, { method: "POST" });
      mutate();
    } finally {
      setActing(null);
    }
  };

  const mergedPc = pc ?? task?.phase_context;
  const phases = buildPhases(mergedPc);
  const zadani = getZadani(task, mergedPc);

  const nKroky = (mergedPc?.phase_results?.PLAN as { kroky?: number } | undefined)?.kroky ?? 0;
  const currentStep = phase.startsWith("STEP_") ? parseInt(phase.split("_")[1]) : null;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Zadání */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Zadání</p>
        <p className="text-base text-gray-200">{zadani || id}</p>
        <p className="text-xs text-gray-600 mt-1 font-mono">{id}</p>
      </div>

      {/* State machine vizualizace */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Průběh</p>
          {currentStep !== null && nKroky > 0 && (
            <span className="text-xs text-cyan-400 font-mono">Krok {currentStep}/{nKroky}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {phases.map((p) => {
            const isDone = mergedPc?.completed_phases?.includes(p) ?? false;
            const isActive = p === phase;
            const color = phaseColor(p);
            return (
              <div
                key={p}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono transition-all ${
                  isActive
                    ? `${color} ring-2 ring-offset-1 ring-offset-gray-900 ring-blue-500`
                    : isDone
                    ? "bg-gray-800 text-gray-500 opacity-60"
                    : "bg-gray-900 text-gray-700 border border-gray-800"
                }`}
              >
                {isDone && <span className="text-green-600">✓</span>}
                {p}
              </div>
            );
          })}
        </div>
      </div>

      {/* Akce */}
      {(isApprove || isApproveProd) && (
        <div className={`border rounded-xl p-4 ${isApproveProd ? "bg-green-950 border-green-800" : "bg-yellow-950 border-yellow-800"}`}>
          <p className={`text-sm font-medium mb-1 ${isApproveProd ? "text-green-300" : "text-yellow-300"}`}>
            {isApproveProd ? "Schválit nasazení do produkce?" : "Schválit postup do stagingu?"}
          </p>
          <p className="text-xs text-gray-400 mb-4">
            {isApproveProd
              ? "Task je připravený k nasazení do produkce. Zkontroluj smoke testy."
              : "Task dokončil build. Schvál pro postup do stagingového prostředí."}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => doAction(isApproveProd ? "approve-prod" : "approve")}
              disabled={acting !== null}
              className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 transition-colors ${
                isApproveProd ? "bg-green-700 hover:bg-green-600" : "bg-yellow-700 hover:bg-yellow-600"
              }`}
            >
              {acting === (isApproveProd ? "approve-prod" : "approve") ? "Schvaluji..." : "Schválit"}
            </button>
            <button
              onClick={() => doAction("cancel")}
              disabled={acting !== null}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              Zrušit task
            </button>
          </div>
        </div>
      )}

      {/* Cancel tlačítko pro aktivní tasky (mimo approve stav) */}
      {!isTerminal && !isApprove && !isApproveProd && (
        <div>
          <button
            onClick={() => doAction("cancel")}
            disabled={acting !== null}
            className="text-xs px-3 py-1.5 border border-red-900 text-red-500 hover:text-red-300 hover:border-red-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {acting === "cancel" ? "Ruším..." : "Zrušit task"}
          </button>
        </div>
      )}

      {/* Chyba */}
      {(pc?.error || (pc?.errors && pc.errors.length > 0)) && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4">
          <p className="text-xs text-red-400 uppercase tracking-wider mb-1">Chyba</p>
          <p className="text-sm text-red-300 font-mono">
            {pc?.error ?? (pc?.errors ?? []).join("\n")}
          </p>
        </div>
      )}

      {/* Soubory */}
      {task?.files && task.files.filter(f => f.name !== "phase_context.json").length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Soubory workspace</p>
          <div className="space-y-1">
            {task.files.filter(f => f.name !== "phase_context.json").map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-4">
                <p className="text-xs text-gray-400 font-mono truncate">{f.name}</p>
                <p className="text-xs text-gray-600 flex-shrink-0">{(f.size / 1024).toFixed(1)} kB</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase results */}
      {pc?.phase_results && Object.keys(pc.phase_results).length > 0 && (
        <details className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-400">
            Výsledky fází
          </summary>
          <pre className="px-4 pb-4 text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(pc.phase_results, null, 2)}
          </pre>
        </details>
      )}

      <button
        onClick={() => router.back()}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        ← Zpět na tasky
      </button>
    </div>
  );
}
