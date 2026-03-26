"use client";

import useSWR from "swr";
import { useState, useCallback } from "react";
import Chat from "@/components/Chat";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type KBFile = { path: string; kategorie: string; name: string; size: number; modified: number };
type OutputFile = { name: string; size: number; modified: number };
type LogData = { lines: string[] };

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
  const { data: log, isLoading } = useSWR<LogData>(
    `/api/projects/${projekt}/tasks/log?lines=200`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: project } = useSWR(`/api/projects/${projekt}`, fetcher, { refreshInterval: 10000 });
  const [expanded, setExpanded] = useState(false);

  const isRunning = project?.has_running_task;
  const lines = log?.lines ?? [];

  // Parsuj tasky z logu (hledá řádky začínající časem nebo označením agenta)
  const taskLines = lines.filter(l => l.trim());
  const preview = taskLines.slice(-20);
  const all = taskLines;

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        isRunning
          ? "bg-green-950 border-green-800 text-green-300"
          : "bg-gray-900 border-gray-800 text-gray-400"
      }`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isRunning ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
        <span className="text-sm font-medium">{isRunning ? "Task běží" : "Žádný aktivní task"}</span>
      </div>

      {/* Log */}
      {isLoading ? (
        <p className="text-gray-600 text-sm">Načítám...</p>
      ) : lines.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-600 text-sm">
          Žádné záznamy. Spusť task přes Telegram bot.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">crew_log.txt</span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-600 hover:text-gray-400"
            >
              {expanded ? "méně" : "vše"}
            </button>
          </div>
          <pre className="text-xs font-mono text-gray-300 p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {(expanded ? all : preview).join("\n")}
          </pre>
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
              {new Date(f.modified * 1000).toLocaleDateString("cs-CZ")} · {Math.round(f.size / 1024)}kB
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

function KnowledgeBase({ projekt }: { projekt: string }) {
  const { data: tree, mutate } = useSWR<KBFile[]>(
    `/api/projects/${projekt}/knowledge/tree`,
    fetcher
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: fileData } = useSWR(
    selected ? `/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}` : null,
    fetcher
  );

  const handleSelect = useCallback((path: string) => {
    setSelected(path);
    setEditing(false);
  }, []);

  const handleEdit = useCallback(() => {
    setEditContent(fileData?.content ?? "");
    setEditing(true);
  }, [fileData]);

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsah: editContent, commit_msg: `edit: ${selected}` }),
    });
    setSaving(false);
    setEditing(false);
    mutate();
  }, [selected, editContent, projekt, mutate]);

  const grouped = (tree ?? []).reduce<Record<string, KBFile[]>>((acc, f) => {
    (acc[f.kategorie] = acc[f.kategorie] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="flex gap-4">
      {/* Strom */}
      <div className="w-56 flex-shrink-0 space-y-4">
        {Object.entries(grouped).map(([kat, files]) => (
          <div key={kat}>
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1 px-1">
              {kat === "." ? "root" : kat}
            </p>
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => handleSelect(f.path)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors truncate ${
                  selected === f.path ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        ))}
        {!tree?.length && (
          <p className="text-gray-600 text-sm px-1">Prázdná knowledge base</p>
        )}
      </div>

      {/* Editor / prohlížeč */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
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
                      onClick={handleSave}
                      disabled={saving}
                      className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded-lg"
                    >
                      {saving ? "Ukládám..." : "Uložit"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleEdit}
                    className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded-lg"
                  >
                    Upravit
                  </button>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-[65vh] bg-gray-900 text-sm text-gray-200 font-mono p-4 resize-none focus:outline-none"
                spellCheck={false}
              />
            ) : (
              <pre className="text-sm text-gray-300 whitespace-pre-wrap p-4 overflow-auto max-h-[65vh]">
                {fileData?.content ?? "Načítám..."}
              </pre>
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
