"use client";

import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  artifacts?: Record<string, string>;
  errors?: string[];
};

type TaskFile = { name: string; size: number; mtime: number };

type TaskDetail = {
  task_id: string;
  task_yaml?: Record<string, unknown>;
  phase_context?: PhaseContext;
  files?: TaskFile[];
};

type OutputFile = { name: string; size: number; modified: number };

type OutputContent = { name: string; content: string };

type TaskEvent = {
  timestamp?: string | null;
  type: string;
  title?: string;
  phase?: string;
  step_id?: string;
  level?: string;
  payload?: Record<string, unknown>;
};

type TaskEvents = {
  task_id: string;
  events: TaskEvent[];
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

function formatDateTime(value?: string | number | null): string {
  if (!value) return "n/a";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString("cs-CZ");
}

function formatPhaseLabel(phase?: string): string {
  if (!phase) return "neznámá fáze";
  if (phase.startsWith("STEP_")) {
    return `krok ${phase.split("_")[1]}`;
  }
  return phase.toLowerCase();
}

function eventStatusTone(event?: TaskEvent, phase?: string): string {
  const type = event?.type ?? "";
  const level = event?.level ?? "";
  if (["FAILED", "CANCELLED"].includes(phase ?? "")) return "border-red-800 bg-red-950/50 text-red-200";
  if (["COMPLETE", "DONE"].includes(phase ?? "")) return "border-emerald-800 bg-emerald-950/40 text-emerald-200";
  if (level === "error" || type.includes("failed") || type.includes("exception")) {
    return "border-red-800 bg-red-950/50 text-red-200";
  }
  if (level === "warning" || type.includes("retry") || type.includes("blocked")) {
    return "border-amber-800 bg-amber-950/40 text-amber-200";
  }
  if (type === "judge_result" || type === "output_normalized" || type === "step_started") {
    return "border-cyan-800 bg-cyan-950/40 text-cyan-200";
  }
  return "border-blue-800 bg-blue-950/40 text-blue-200";
}

function describeEvent(event?: TaskEvent, phase?: string): string {
  if (!event) {
    if (["COMPLETE", "DONE"].includes(phase ?? "")) return "Task je dokončený.";
    if (["FAILED", "CANCELLED"].includes(phase ?? "")) return "Task skončil chybou nebo byl zrušen.";
    return "Čekám na první živou událost z workeru.";
  }

  const payload = event.payload ?? {};
  const eventPhase = event.phase || phase;
  const stepLabel = event.step_id ? `krok ${event.step_id}` : formatPhaseLabel(eventPhase);

  switch (event.type) {
    case "flow_started":
      return "Flow bylo spuštěno a worker začal zpracování.";
    case "plan_created":
      return `Planner připravil ${String(payload.steps && Array.isArray(payload.steps) ? payload.steps.length : "?")} kroků.`;
    case "step_started":
      return `Právě běží ${stepLabel}.`;
    case "agent_call_started":
      return `Executor právě řeší ${stepLabel} a chystá nástroje.`;
    case "llm_round_started":
      return `Probíhá LLM kolo ${String(payload.round ?? "?")} pro ${stepLabel}.`;
    case "tool_call":
      return `Volá se nástroj ${String(payload.tool ?? "unknown")} v ${stepLabel}.`;
    case "tool_result":
      return `Doběhl nástroj ${String(payload.tool ?? "unknown")} v ${stepLabel}.`;
    case "tool_call_blocked_duplicate":
      return `Zastaven duplicitní tool call ${String(payload.tool ?? "unknown")} v ${stepLabel}.`;
    case "tool_rounds_exhausted":
      return `Vyčerpaly se tool rounds pro ${stepLabel}; čeká se na finální odpověď modelu.`;
    case "step_output":
      return `Executor vrátil výstup pro ${stepLabel}.`;
    case "output_normalized":
      return `Výstup ${stepLabel} byl úspěšně normalizován do cílového schématu.`;
    case "output_normalization_failed":
      return `Normalizace výstupu pro ${stepLabel} selhala.`;
    case "schema_validation_failed":
      return `Schema validace selhala v ${stepLabel}; běží opravný pokus.`;
    case "runtime_validation_failed":
      return `Runtime validace selhala v ${stepLabel}; výstup neprošel technickou kontrolou.`;
    case "judge_result":
      return payload.ok ? `Judge schválil ${stepLabel}.` : `Judge vrátil ${stepLabel} k opravě.`;
    case "judge_result_overridden":
      return `Původní verdict judge byl zneplatněn a ${stepLabel} se vrací do retry.`;
    case "step_retry":
      return `Probíhá retry pro ${stepLabel}: ${String(payload.duvod ?? "čeká se na nový pokus")}`;
    case "step_exception":
      return `V ${stepLabel} spadla výjimka: ${String(payload.error_type ?? "error")}.`;
    case "artifact_created":
      return "Finální výstup byl uložen do workspace.";
    case "flow_completed":
      return "Flow bylo dokončeno.";
    default:
      return event.title || event.type;
  }
}

type StatusSummary = {
  previous: { label: string; meta: string };
  current: { label: string; meta: string };
  next: { label: string; meta: string };
};

function isCompletionEvent(event: TaskEvent): boolean {
  return [
    "tool_result",
    "step_output",
    "output_normalized",
    "judge_result",
    "artifact_created",
    "flow_completed",
  ].includes(event.type);
}

function predictNextActivity(event?: TaskEvent, phase?: string): string {
  if (!event) {
    if (["COMPLETE", "DONE"].includes(phase ?? "")) return "Žádná další aktivita, task je hotový.";
    return "Čeká se na první akci workeru.";
  }

  const payload = event.payload ?? {};
  switch (event.type) {
    case "flow_started":
      return "Očekává se plánování kroků.";
    case "plan_created":
      return "Očekává se spuštění prvního kroku.";
    case "step_started":
      return "Executor začne volat LLM nebo nástroje.";
    case "agent_call_started":
    case "llm_round_started":
      return "Očekává se tool call nebo finální odpověď executoru.";
    case "tool_call":
      return `Čeká se na výsledek nástroje ${String(payload.tool ?? "unknown")}.`;
    case "tool_result":
      return "Model zpracuje výsledek nástroje a rozhodne o dalším kroku.";
    case "tool_call_blocked_duplicate":
      return "Model by měl použít předchozí výsledek nebo zvolit jiný nástroj.";
    case "tool_rounds_exhausted":
      return "Očekává se finální odpověď executoru bez dalších tools.";
    case "step_output":
      return "Proběhne validace výstupu nebo judge.";
    case "output_normalized":
      return "Proběhne schema validace a judge.";
    case "output_normalization_failed":
    case "schema_validation_failed":
    case "runtime_validation_failed":
      return "Očekává se retry stejného kroku s přísnějším kontraktem.";
    case "judge_result":
      return payload.ok ? "Pokud nejsou další kroky, task se uzavře. Jinak se spustí další krok." : "Krok se vrátí do retry.";
    case "judge_result_overridden":
    case "step_retry":
      return "Executor zkusí krok znovu.";
    case "artifact_created":
      return "Očekává se uzavření flow.";
    case "flow_completed":
      return "Žádná další aktivita, flow je dokončeno.";
    default:
      return ["COMPLETE", "DONE"].includes(phase ?? "") ? "Žádná další aktivita, task je hotový." : "Čeká se na další event.";
  }
}

function buildStatusSummary(events: TaskEvent[], phase?: string, updatedAt?: string): StatusSummary {
  const latestEvent = events.length ? events[events.length - 1] : undefined;
  const previousEvent = [...events].reverse().find((event) => isCompletionEvent(event) && event !== latestEvent);

  const previous = previousEvent
    ? {
        label: describeEvent(previousEvent, phase),
        meta: `${formatDateTime(previousEvent.timestamp)}${previousEvent.phase ? ` · ${previousEvent.phase}` : ""}${previousEvent.step_id ? ` · step ${previousEvent.step_id}` : ""}`,
      }
    : {
        label: "Zatím není evidovaná dokončená aktivita.",
        meta: formatDateTime(updatedAt),
      };

  const current = latestEvent
    ? {
        label: describeEvent(latestEvent, phase),
        meta: `${formatDateTime(latestEvent.timestamp)}${latestEvent.phase ? ` · ${latestEvent.phase}` : ""}${latestEvent.step_id ? ` · step ${latestEvent.step_id}` : ""}`,
      }
    : {
        label: describeEvent(undefined, phase),
        meta: `${formatDateTime(updatedAt)} · ${phase ?? "?"}`,
      };

  const next = {
    label: predictNextActivity(latestEvent, phase),
    meta: latestEvent?.phase || phase || "?",
  };

  return { previous, current, next };
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
  const { data: outputs } = useSWR<OutputFile[]>(
    `/api/projects/${projekt}/outputs`,
    fetcher,
    { refreshInterval: 10000 }
  );
  const { data: taskEvents } = useSWR<TaskEvents>(
    `/api/projects/${projekt}/tasks/${id}/events?limit=400`,
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
  const relatedOutputs = (outputs ?? []).filter((file) => file.name.startsWith(`${id}_`));
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const { data: selectedOutputData } = useSWR<OutputContent>(
    selectedOutput ? `/api/projects/${projekt}/outputs/file?name=${encodeURIComponent(selectedOutput)}` : null,
    fetcher
  );
  const events = taskEvents?.events ?? [];
  const latestEvent = events.length ? events[events.length - 1] : undefined;
  const statusTone = eventStatusTone(latestEvent, phase);
  const statusSummary = buildStatusSummary(events, phase, mergedPc?.updated_at);

  const nKroky = (mergedPc?.phase_results?.PLAN as { kroky?: number } | undefined)?.kroky ?? 0;
  const currentStep = phase.startsWith("STEP_") ? parseInt(phase.split("_")[1]) : null;

  useEffect(() => {
    if (!relatedOutputs.length) {
      setSelectedOutput(null);
      return;
    }
    if (!selectedOutput || !relatedOutputs.some((file) => file.name === selectedOutput)) {
      setSelectedOutput(relatedOutputs[0].name);
    }
  }, [relatedOutputs, selectedOutput]);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Zadání */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Zadání</p>
        <p className="text-base text-gray-200">{zadani || id}</p>
        <p className="text-xs text-gray-600 mt-1 font-mono">{id}</p>
      </div>

      <div className={`border rounded-xl p-4 ${statusTone}`}>
        <p className="text-xs uppercase tracking-wider opacity-75 mb-3">Live Stav</p>
        <div className="space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider opacity-60">Poslední dokončená</p>
            <p className="text-sm mt-1">{statusSummary.previous.label}</p>
            <p className="text-[11px] font-mono opacity-70 mt-1">{statusSummary.previous.meta}</p>
          </div>
          <div className="border-t border-white/10 pt-3">
            <p className="text-[11px] uppercase tracking-wider opacity-60">Probíhající</p>
            <p className="text-sm mt-1">{statusSummary.current.label}</p>
            <p className="text-[11px] font-mono opacity-70 mt-1">{statusSummary.current.meta}</p>
          </div>
          <div className="border-t border-white/10 pt-3">
            <p className="text-[11px] uppercase tracking-wider opacity-60">Další očekávaná</p>
            <p className="text-sm mt-1">{statusSummary.next.label}</p>
            <p className="text-[11px] font-mono opacity-70 mt-1">{statusSummary.next.meta}</p>
          </div>
        </div>
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

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Timeline fází</p>
        <div className="flex flex-wrap gap-2">
          {phases.map((p) => {
            const isDone = mergedPc?.completed_phases?.includes(p) ?? false;
            const isActive = p === phase;
            const color = phaseColor(p);
            return (
              <div
                key={p}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono ${
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

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Výsledky fází</p>
        <div className="space-y-3">
          {Object.entries(mergedPc?.phase_results ?? {}).length ? (
            Object.entries(mergedPc?.phase_results ?? {}).map(([phaseName, result]) => (
              <div key={phaseName} className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-200">{phaseName}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${phaseColor(phaseName)}`}>
                    {String((result as { status?: string })?.status ?? "ok")}
                  </span>
                </div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto mt-2">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">Bez phase results.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px,minmax(0,1fr)] gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Artefakty a výstupy</p>
          <div className="space-y-2">
            {relatedOutputs.length ? (
              relatedOutputs.map((file) => (
                <button
                  key={file.name}
                  onClick={() => setSelectedOutput(file.name)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    selectedOutput === file.name
                      ? "bg-gray-800 border-gray-700 text-white"
                      : "bg-gray-950 border-gray-800 text-gray-400 hover:bg-gray-900"
                  }`}
                >
                  <div className="font-medium text-sm truncate">{file.name}</div>
                  <div className="text-[11px] text-gray-600 mt-1">{formatDateTime(file.modified)}</div>
                </button>
              ))
            ) : (
              <p className="text-sm text-gray-500">Pro tento task zatím nejsou uložené výstupy.</p>
            )}
          </div>

          {!!mergedPc?.artifacts && Object.keys(mergedPc.artifacts).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Cesty z phase contextu</p>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto">
                {JSON.stringify(mergedPc.artifacts, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Obsah vybraného výstupu</p>
          {selectedOutputData ? (
            <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-auto max-h-[40vh]">
              {selectedOutputData.content}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">Vyber výstup vlevo.</p>
          )}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Event trace</p>
        <div className="space-y-3 max-h-[46vh] overflow-y-auto">
          {events.length ? (
            events.map((event, index) => (
              <div key={`${event.timestamp || "event"}-${index}`} className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-200">{event.title || event.type}</p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      {formatDateTime(event.timestamp)} · {event.type}
                      {event.phase ? ` · ${event.phase}` : ""}
                      {event.step_id ? ` · step ${event.step_id}` : ""}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full border border-gray-700 text-[10px] font-medium text-gray-300 flex-shrink-0">
                    {event.level || "info"}
                  </span>
                </div>
                {event.payload && Object.keys(event.payload).length > 0 && (
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto mt-3">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">Tento task zatím nemá uložený event trace.</p>
              <p className="text-xs text-gray-600">
                Pro starší běhy worker ještě nezapisoval `events.jsonl`. U nových běhů se zde objeví flow události, LLM kola a použití tools.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Chyby a varování</p>
          {mergedPc?.errors?.length ? (
            <pre className="text-xs text-red-200 whitespace-pre-wrap overflow-auto max-h-[24vh]">
              {mergedPc.errors.join("\n")}
            </pre>
          ) : (
            <p className="text-sm text-gray-500">Žádné chyby v phase contextu.</p>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Raw phase context</p>
          <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto max-h-[24vh]">
            {JSON.stringify(mergedPc ?? {}, null, 2)}
          </pre>
        </div>
      </div>

      <button
        onClick={() => router.back()}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        ← Zpět na tasky
      </button>
    </div>
  );
}
