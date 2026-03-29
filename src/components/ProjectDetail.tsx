"use client";

import useSWR from "swr";
import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Chat from "@/components/Chat";
import Link from "next/link";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ── Vlastní diff renderer (LCS line-level) ──────────────────────────────────

type DiffOp = { type: "same" | "del" | "add"; text: string };

function computeDiff(original: string, modified: string): DiffOp[] {
  const a = (original || "").split("\n");
  const b = (modified || "").split("\n");
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const ops: DiffOp[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      ops.unshift({ type: "same", text: a[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: "add",  text: b[j-1] }); j--;
    } else {
      ops.unshift({ type: "del",  text: a[i-1] }); i--;
    }
  }
  return ops;
}

type DiffRow = { left: { text: string; type: "same" | "del" | "empty" }; right: { text: string; type: "same" | "add" | "empty" } };

function buildRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let di = 0;
  while (di < ops.length) {
    const op = ops[di];
    if (op.type === "same") {
      rows.push({ left: { text: op.text, type: "same" }, right: { text: op.text, type: "same" } });
      di++;
    } else if (op.type === "del" && di + 1 < ops.length && ops[di + 1].type === "add") {
      rows.push({ left: { text: op.text, type: "del" }, right: { text: ops[di+1].text, type: "add" } });
      di += 2;
    } else if (op.type === "del") {
      rows.push({ left: { text: op.text, type: "del" }, right: { text: "", type: "empty" } });
      di++;
    } else {
      rows.push({ left: { text: "", type: "empty" }, right: { text: op.text, type: "add" } });
      di++;
    }
  }
  return rows;
}

const CELL_STYLE: Record<string, string> = {
  same:  "text-gray-300",
  del:   "bg-red-950 text-red-200 border-l-2 border-red-600",
  add:   "bg-green-950 text-green-200 border-l-2 border-green-600",
  empty: "bg-gray-900/40 text-transparent select-none",
};

function SideBySideDiff({ original, modified }: { original: string; modified: string }) {
  const rows = buildRows(computeDiff(original, modified));
  return (
    <div className="flex h-full overflow-auto font-mono text-xs">
      <div className="flex-1 min-w-0 border-r border-gray-800 overflow-auto">
        {rows.map((r, i) => (
          <div key={i} className={`px-3 py-0.5 whitespace-pre-wrap leading-5 ${CELL_STYLE[r.left.type]}`}>
            {r.left.type === "del" && <span className="text-red-500 mr-1 select-none">−</span>}
            {r.left.text || "\u00a0"}
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {rows.map((r, i) => (
          <div key={i} className={`px-3 py-0.5 whitespace-pre-wrap leading-5 ${CELL_STYLE[r.right.type]}`}>
            {r.right.type === "add" && <span className="text-green-500 mr-1 select-none">+</span>}
            {r.right.text || "\u00a0"}
          </div>
        ))}
      </div>
    </div>
  );
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type KBFile = { path: string; kategorie: string; name: string; size: number; modified: number };
type OutputFile = { name: string; size: number; modified: number };
type LogData = { lines: string[] };
type ProjectInfo = { has_running_task?: boolean };
type TaskListItem = {
  task_id: string;
  zadani: string;
  created_at: string | null;
  updated_at: number | null;
  phase_context?: { current_phase?: string };
};
type TaskDetailData = {
  task_id: string;
  task_yaml: Record<string, unknown>;
  phase_context: {
    task_id?: string;
    project?: string;
    created_at?: string;
    current_phase?: string;
    completed_phases?: string[];
    phase_results?: Record<string, unknown>;
    artifacts?: Record<string, string>;
    errors?: string[];
    heal_attempts?: number;
  };
  files: Array<{ name: string; size: number; mtime: number }>;
};
type TaskEventsData = {
  task_id: string;
  events: TaskEvent[];
};
type TaskEvent = {
  timestamp?: string | null;
  type: string;
  title?: string;
  phase?: string;
  step_id?: string;
  level?: string;
  payload?: Record<string, unknown>;
};

function formatDateTime(value?: string | number | null) {
  if (!value) return "n/a";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString("cs-CZ");
}

function phaseTone(phase?: string) {
  const name = (phase || "").toUpperCase();
  if (["COMPLETE", "DONE"].includes(name)) return "bg-emerald-950 text-emerald-300 border-emerald-800";
  if (["FAILED", "CANCELLED", "ERROR"].includes(name)) return "bg-red-950 text-red-300 border-red-800";
  if (["PAUSED", "SUSPENDED"].includes(name)) return "bg-amber-950 text-amber-300 border-amber-800";
  if (!name) return "bg-gray-900 text-gray-400 border-gray-800";
  return "bg-blue-950 text-blue-300 border-blue-800";
}

export default function ProjectDetail({ projekt }: { projekt: string }) {
  const [section, setSection] = useState<"tasks" | "outputs" | "kb">("tasks");

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Hlavní oblast */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-400 text-sm">← Dashboard</Link>
            <h1 className="text-xl font-bold">{projekt}</h1>
          </div>
          <nav className="flex gap-1">
            {(["tasks", "outputs", "kb"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  section === s ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {s === "tasks" ? "Tasky" : s === "outputs" ? "Výstupy" : "Knowledge Base"}
              </button>
            ))}
          </nav>
        </div>

        {/* Obsah */}
        <div className="flex-1 overflow-y-auto p-6">
          {section === "tasks" && <Tasks projekt={projekt} />}
          {section === "outputs" && <Outputs projekt={projekt} />}
          {section === "kb" && <KnowledgeBase projekt={projekt} />}
        </div>
      </div>

      {/* Chat sidebar */}
      <div className="w-96 flex-shrink-0 border-l border-gray-800 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-800 text-sm font-medium text-gray-400">
          Chat · {projekt}
        </div>
        <div className="flex-1 min-h-0">
          <Chat projekt={projekt} />
        </div>
      </div>
    </div>
  );
}

// ── Tasky ──────────────────────────────────────────────────────────────────

function Tasks({ projekt }: { projekt: string }) {
  const { data: tasks, isLoading, error } = useSWR<TaskListItem[]>(
    `/api/projects/${projekt}/tasks`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: project } = useSWR<ProjectInfo>(`/api/projects/${projekt}`, fetcher, { refreshInterval: 10000 });
  const { data: log } = useSWR<LogData>(`/api/projects/${projekt}/tasks/log?lines=200`, fetcher, {
    refreshInterval: 5000,
  });
  const { data: outputs } = useSWR<OutputFile[]>(`/api/projects/${projekt}/outputs`, fetcher, {
    refreshInterval: 15000,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);

  useEffect(() => {
    if (!tasks?.length) return;
    if (!selectedTaskId || !tasks.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].task_id);
    }
  }, [tasks, selectedTaskId]);

  const { data: taskDetail } = useSWR<TaskDetailData>(
    selectedTaskId ? `/api/projects/${projekt}/tasks/${selectedTaskId}` : null,
    fetcher,
    { refreshInterval: 2500 }
  );
  const { data: taskEvents } = useSWR<TaskEventsData>(
    selectedTaskId ? `/api/projects/${projekt}/tasks/${selectedTaskId}/events?limit=400` : null,
    fetcher,
    { refreshInterval: 2500 }
  );
  const { data: selectedOutputData } = useSWR(
    selectedOutput ? `/api/projects/${projekt}/outputs/file?name=${encodeURIComponent(selectedOutput)}` : null,
    fetcher
  );

  const selectedTask = tasks?.find((task) => task.task_id === selectedTaskId) ?? null;
  const phaseContext = taskDetail?.phase_context;
  const relatedOutputs = (outputs ?? []).filter((file) => selectedTaskId && file.name.startsWith(`${selectedTaskId}_`));
  const allPhases = Array.from(
    new Set([...(phaseContext?.completed_phases ?? []), phaseContext?.current_phase].filter(Boolean))
  ) as string[];
  const events = taskEvents?.events ?? [];
  const projectLogLines = log?.lines ?? [];
  const isRunning = project?.has_running_task || ["INTAKE", "PLAN", "STEP_1", "STEP_2", "STEP_3", "STEP_4", "STEP_5", "HEAL", "BUILD"].includes((phaseContext?.current_phase || "").toUpperCase());

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
    <div className="space-y-4">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isRunning ? "bg-green-950 border-green-800 text-green-300" : "bg-gray-900 border-gray-800 text-gray-400"}`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRunning ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
        <span className="text-sm font-medium">
          {isRunning ? "Task běží nebo je aktivní" : "Tasky jsou neaktivní"}
        </span>
      </div>

      {isLoading ? (
        <p className="text-gray-600 text-sm">Načítám tasky…</p>
      ) : error ? (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-sm text-red-200">
          Nepodařilo se načíst tasky.
        </div>
      ) : !tasks?.length ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-600 text-sm">
          Zatím nejsou žádné tasky.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[320px,minmax(0,1fr)] gap-4 min-h-[70vh]">
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Tasky</p>
            </div>
            <div className="max-h-[72vh] overflow-y-auto">
              {tasks.map((task) => {
                const currentPhase = task.phase_context?.current_phase || "UNKNOWN";
                const active = task.task_id === selectedTaskId;
                return (
                  <button
                    key={task.task_id}
                    onClick={() => setSelectedTaskId(task.task_id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-colors ${active ? "bg-gray-800" : "hover:bg-gray-950"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-white">{task.task_id}</p>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.zadani || "Bez zadání"}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${phaseTone(currentPhase)}`}>
                        {currentPhase}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-600 mt-2">
                      {formatDateTime(task.created_at)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 min-w-0">
            {selectedTask ? (
              <>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Detail tasku</p>
                      <h2 className="text-lg font-semibold mt-1">{selectedTask.task_id}</h2>
                      <p className="text-sm text-gray-400 mt-2">{selectedTask.zadani || "Bez zadání"}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full border text-xs font-medium flex-shrink-0 ${phaseTone(phaseContext?.current_phase)}`}>
                      {phaseContext?.current_phase || "UNKNOWN"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Vytvořeno</p>
                      <p className="text-sm text-gray-200 mt-1">{formatDateTime(phaseContext?.created_at || selectedTask.created_at)}</p>
                    </div>
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Dokončené fáze</p>
                      <p className="text-sm text-gray-200 mt-1">{phaseContext?.completed_phases?.length ?? 0}</p>
                    </div>
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Heal pokusy</p>
                      <p className="text-sm text-gray-200 mt-1">{phaseContext?.heal_attempts ?? 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Timeline fází</p>
                  <div className="flex flex-wrap gap-2">
                    {allPhases.length ? allPhases.map((phase) => (
                      <span
                        key={phase}
                        className={`px-3 py-1 rounded-full border text-xs font-medium ${phaseTone(phase)}`}
                      >
                        {phase}
                      </span>
                    )) : (
                      <p className="text-sm text-gray-500">Zatím bez fází.</p>
                    )}
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Výsledky fází</p>
                  <div className="space-y-3">
                    {Object.entries(phaseContext?.phase_results ?? {}).length ? Object.entries(phaseContext?.phase_results ?? {}).map(([phase, result]) => (
                      <div key={phase} className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-gray-200">{phase}</p>
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${phaseTone(String((result as { status?: string })?.status || phase))}`}>
                            {String((result as { status?: string })?.status || "ok")}
                          </span>
                        </div>
                        <pre className="text-xs text-gray-400 whitespace-pre-wrap mt-2">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      </div>
                    )) : (
                      <p className="text-sm text-gray-500">Bez phase results.</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,360px),minmax(0,1fr)] gap-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Artefakty a výstupy</p>
                    <div className="space-y-2">
                      {relatedOutputs.length ? relatedOutputs.map((file) => (
                        <button
                          key={file.name}
                          onClick={() => setSelectedOutput(file.name)}
                          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${selectedOutput === file.name ? "bg-gray-800 border-gray-700 text-white" : "bg-gray-950 border-gray-800 text-gray-400 hover:bg-gray-900"}`}
                        >
                          <div className="font-medium text-sm truncate">{file.name}</div>
                          <div className="text-[11px] text-gray-600 mt-1">{formatDateTime(file.modified)}</div>
                        </button>
                      )) : (
                        <p className="text-sm text-gray-500">Pro tento task zatím nejsou uložené workspace výstupy.</p>
                      )}
                    </div>

                    {phaseContext?.artifacts && Object.keys(phaseContext.artifacts).length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-800">
                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Cesty z phase contextu</p>
                        <pre className="text-xs text-gray-400 whitespace-pre-wrap">
                          {JSON.stringify(phaseContext.artifacts, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 min-w-0">
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
                    {events.length ? events.map((event, index) => (
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
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${phaseTone(event.level?.toUpperCase() || "INFO")}`}>
                            {event.level || "info"}
                          </span>
                        </div>
                        {event.payload && Object.keys(event.payload).length > 0 && (
                          <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto mt-3">
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    )) : (
                      <p className="text-sm text-gray-500">Zatím bez event trace. Objeví se po prvních planner/executor akcích.</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Chyby a varování</p>
                    {phaseContext?.errors?.length ? (
                      <pre className="text-xs text-red-200 whitespace-pre-wrap overflow-auto max-h-[24vh]">
                        {phaseContext.errors.join("\n")}
                      </pre>
                    ) : (
                      <p className="text-sm text-gray-500">Žádné chyby v phase contextu.</p>
                    )}
                  </div>

                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Projektový task log</p>
                    {projectLogLines.length ? (
                      <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto max-h-[24vh]">
                        {projectLogLines.join("\n")}
                      </pre>
                    ) : (
                      <p className="text-sm text-gray-500">`crew_log.txt` je prázdný nebo se zatím nepoužívá.</p>
                    )}
                  </div>
                </div>

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Raw phase context</p>
                  <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-auto max-h-[32vh]">
                    {JSON.stringify(phaseContext ?? {}, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-600 text-sm">
                Vyber task vlevo.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Výstupy ────────────────────────────────────────────────────────────────

function Outputs({ projekt }: { projekt: string }) {
  const { data: files } = useSWR<OutputFile[]>(`/api/projects/${projekt}/outputs`, fetcher, {
    refreshInterval: 15000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const { data: fileData } = useSWR(
    selected ? `/api/projects/${projekt}/outputs/file?name=${encodeURIComponent(selected)}` : null,
    fetcher
  );

  if (!files?.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-600 text-sm">
        Žádné výstupy. Agenti sem ukládají reporty a výsledky analýz.
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Seznam */}
      <div className="w-56 flex-shrink-0 space-y-1">
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => setSelected(f.name)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selected === f.name ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"
            }`}
          >
            <div className="truncate font-medium">{f.name.replace(".md", "")}</div>
            <div className="text-xs text-gray-600 mt-0.5">
              {new Date(f.modified * 1000).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} · {Math.round(f.size / 1024)}kB
            </div>
          </button>
        ))}
      </div>

      {/* Obsah */}
      <div className="flex-1 min-w-0">
        {fileData ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-600 mb-3">{fileData.name}</p>
            <pre className="text-sm text-gray-300 whitespace-pre-wrap overflow-auto max-h-[65vh]">
              {fileData.content}
            </pre>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-gray-600 text-sm text-center">
            Vyberte soubor
          </div>
        )}
      </div>
    </div>
  );
}

// ── Knowledge Base ─────────────────────────────────────────────────────────

type IndexStatus = { needs_reindex: boolean; changed_files: number; last_indexed: string | null };
type GitCommit = { sha: string; message: string; author: string; ts: string };
type DiffData = { original: string; modified: string; sha: string; message: string; author: string; ts: string };

function isReadOnlyFile(path: string | null, content: string | undefined): boolean {
  if (!path) return false;
  if (path.endsWith("_RULES.md") || path.endsWith("_RULES")) return true;
  if (content?.includes("<!-- IMMUTABLE_START -->")) return true;
  return false;
}

function GitLog({
  projekt,
  filePath,
  activeSha,
  onSelectSha,
}: {
  projekt: string;
  filePath: string;
  activeSha: string | null;
  onSelectSha: (sha: string | null) => void;
}) {
  const { data: commits } = useSWR<GitCommit[]>(
    `/api/projects/${projekt}/knowledge/gitlog?file=${encodeURIComponent(filePath)}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (!commits?.length) return null;

  return (
    <div className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
      <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Git log</p>
      <div className="space-y-1.5">
        {commits.slice(0, 5).map((c) => (
          <button
            key={c.sha}
            onClick={() => onSelectSha(activeSha === c.sha ? null : c.sha)}
            className={`w-full flex items-start gap-2 text-xs text-left rounded px-1 py-0.5 transition-colors ${
              activeSha === c.sha
                ? "bg-blue-900/40 text-blue-300"
                : "hover:bg-gray-800 text-gray-400"
            }`}
          >
            <span className="font-mono flex-shrink-0 mt-0.5 text-gray-500">{c.sha}</span>
            <span className="flex-1 truncate">{c.message}</span>
            <span className="text-gray-600 flex-shrink-0">
              {new Date(c.ts).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KnowledgeBase({ projekt }: { projekt: string }) {
  const { data: tree, mutate } = useSWR<KBFile[]>(
    `/api/projects/${projekt}/knowledge/tree`,
    fetcher
  );
  const { data: indexStatus, mutate: mutateIndex } = useSWR<IndexStatus>(
    `/api/projects/${projekt}/knowledge/index_status`,
    fetcher,
    { refreshInterval: 30000 }
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [diffSha, setDiffSha] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  const { data: fileData } = useSWR(
    selected ? `/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}` : null,
    fetcher
  );

  const { data: diffData } = useSWR<DiffData>(
    selected && diffSha
      ? `/api/projects/${projekt}/knowledge/gitdiff?file=${encodeURIComponent(selected)}&sha=${diffSha}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const readOnly = isReadOnlyFile(selected, fileData?.content);

  const handleSelect = useCallback((path: string) => {
    setSelected(path);
    setEditing(false);
    setDiffSha(null);
  }, []);

  const handleEdit = useCallback(() => {
    if (readOnly) return;
    setEditContent(fileData?.content ?? "");
    setEditing(true);
  }, [fileData, readOnly]);

  const handleSave = useCallback(async (obsahOverride?: string, commitMsgOverride?: string) => {
    if (!selected) return;
    const obsah = obsahOverride ?? editorRef.current?.getValue() ?? editContent;
    const commit_msg = commitMsgOverride ?? `edit: ${selected}`;
    setSaving(true);
    await fetch(`/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsah, commit_msg }),
    });
    setSaving(false);
    setEditing(false);
    mutate();
  }, [selected, editContent, projekt, mutate]);

  const handleRevert = useCallback(async () => {
    if (!diffData || !selected) return;
    await handleSave(diffData.modified, `revert: [${diffData.sha}] ${selected}`);
    setDiffSha(null);
    mutate();
  }, [diffData, selected, handleSave, mutate]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    await fetch(`/api/projects/${projekt}/knowledge/reindex`, { method: "POST" });
    // Počkej na dokončení indexace (polling)
    const poll = async () => {
      await new Promise(r => setTimeout(r, 3000));
      await mutateIndex();
      const status = await fetch(`/api/projects/${projekt}/knowledge/index_status`).then(r => r.json());
      if (status.needs_reindex) {
        setTimeout(poll, 3000);
      } else {
        setReindexing(false);
      }
    };
    poll();
  }, [projekt, mutateIndex]);

  // Filtrování souborů podle search query (jméno)
  const filteredTree = (tree ?? []).filter((f) => {
    if (!search.trim()) return true;
    return f.name.toLowerCase().includes(search.toLowerCase()) ||
           f.path.toLowerCase().includes(search.toLowerCase());
  });

  const grouped = filteredTree.reduce<Record<string, KBFile[]>>((acc, f) => {
    (acc[f.kategorie] = acc[f.kategorie] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="flex gap-4 h-full">
      {/* Strom + search */}
      <div className="w-56 flex-shrink-0 flex flex-col gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hledat soubor..."
          className="w-full px-3 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-500"
        />
        {(indexStatus?.needs_reindex || reindexing) && (
          <button
            onClick={handleReindex}
            disabled={reindexing}
            className="w-full px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-60 bg-orange-900 hover:bg-orange-800 text-orange-200 border border-orange-700"
          >
            {reindexing
              ? "Indexuji..."
              : `Reindexovat (${indexStatus?.changed_files} změn)`}
          </button>
        )}
        <div className="space-y-4 overflow-y-auto">
          {Object.entries(grouped).map(([kat, files]) => (
            <div key={kat}>
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-1 px-1">
                {kat === "." ? "root" : kat}
              </p>
              {files.map((f) => {
                const isRules = f.name === "_RULES" || f.path.endsWith("_RULES.md");
                return (
                  <button
                    key={f.path}
                    onClick={() => handleSelect(f.path)}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                      selected === f.path ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"
                    }`}
                  >
                    {isRules && <span className="flex-shrink-0 text-xs">🔒</span>}
                    <span className="truncate">{f.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {!filteredTree.length && (
            <p className="text-gray-600 text-sm px-1">
              {search ? "Žádné výsledky" : "Prázdná knowledge base"}
            </p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col" style={{ height: "75vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
              <span className="text-xs text-gray-500 truncate">{selected}</span>
              <div className="flex gap-2 flex-shrink-0">
                {editing ? (
                  <>
                    <button
                      onClick={() => setEditing(false)}
                      className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={() => handleSave()}
                      disabled={saving}
                      className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded-lg"
                    >
                      {saving ? "Ukládám..." : "Uložit"}
                    </button>
                  </>
                ) : diffSha ? (
                  <button
                    onClick={() => setDiffSha(null)}
                    className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded-lg"
                  >
                    ✕ Zavřít diff
                  </button>
                ) : !readOnly ? (
                  <button
                    onClick={handleEdit}
                    className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded-lg"
                  >
                    Upravit
                  </button>
                ) : null}
              </div>
            </div>

            {/* Banner pro chráněné soubory */}
            {readOnly && !diffSha && (
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-950 border-b border-yellow-900 text-yellow-400 text-xs flex-shrink-0">
                <span>🔒</span>
                <span>Tento soubor je chráněný — read only</span>
              </div>
            )}

            {/* Banner diff view */}
            {diffSha && diffData && (
              <div className="flex items-center gap-3 px-4 py-2 bg-blue-950 border-b border-blue-900 text-blue-300 text-xs flex-shrink-0">
                <span className="font-mono text-blue-400">{diffData.sha}</span>
                <span className="flex-1 truncate">{diffData.message}</span>
                <span className="text-blue-500 flex-shrink-0">{diffData.author}</span>
                <span className="text-blue-600 flex-shrink-0">
                  {new Date(diffData.ts).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                {!readOnly && (
                  <button
                    onClick={handleRevert}
                    disabled={saving}
                    className="flex-shrink-0 px-2 py-0.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs transition-colors"
                  >
                    {saving ? "Obnovuji..." : "Obnovit tuto verzi"}
                  </button>
                )}
              </div>
            )}

            {/* Editor / Diff */}
            <div className="flex-1 min-h-0 flex flex-col">
              {diffSha ? (
                diffData ? (
                  <>
                    {/* Nadpisy oken */}
                    <div className="flex flex-shrink-0 border-b border-gray-800 text-xs text-gray-500">
                      <div className="flex-1 px-4 py-1.5 border-r border-gray-800">
                        před · {diffData.sha} · {new Date(diffData.ts).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="flex-1 px-4 py-1.5 text-gray-400">
                        po · {diffData.sha} · {diffData.message}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <SideBySideDiff original={diffData.original} modified={diffData.modified} />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                    Načítám diff...
                  </div>
                )
              ) : fileData ? (
                <MonacoEditor
                  height="100%"
                  language="markdown"
                  theme="vs-dark"
                  value={editing ? editContent : (fileData.content ?? "")}
                  onMount={(editor) => { editorRef.current = editor; }}
                  options={{
                    readOnly: readOnly || !editing,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    lineNumbers: "off",
                    folding: false,
                    renderLineHighlight: "none",
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              ) : (
                <div className="flex items items-center justify-center h-full text-gray-600 text-sm">
                  Načítám...
                </div>
              )}
            </div>

            {/* Git log */}
            {selected && (
              <GitLog
                projekt={projekt}
                filePath={selected}
                activeSha={diffSha}
                onSelectSha={(sha) => {
                  setDiffSha(sha);
                  if (sha) setEditing(false);
                }}
              />
            )}
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-gray-600 text-sm text-center">
            Vyberte soubor
          </div>
        )}
      </div>
    </div>
  );
}
