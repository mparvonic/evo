"use client";

import useSWR from "swr";
import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

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

export default function KnowledgeBase({ projekt }: { projekt: string }) {
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

  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`Smazat soubor ${selected}? Tato akce je nevratná.`)) return;
    setDeleting(true);
    const r = await fetch(
      `/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}`,
      { method: "DELETE" }
    );
    setDeleting(false);
    if (r.ok) {
      setSelected(null);
      mutate();
    } else {
      const err = await r.json().catch(() => ({}));
      alert(err.detail ?? "Smazání selhalo");
    }
  }, [selected, projekt, mutate]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    await fetch(`/api/projects/${projekt}/knowledge/reindex`, { method: "POST" });
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
        <button
          onClick={handleReindex}
          disabled={reindexing}
          className={`w-full px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-60 ${
            indexStatus?.needs_reindex
              ? "bg-orange-900 hover:bg-orange-800 text-orange-200 border border-orange-700"
              : "bg-gray-900 hover:bg-gray-800 text-gray-600 hover:text-gray-400 border border-gray-800"
          }`}
        >
          {reindexing
            ? "Indexuji..."
            : indexStatus?.needs_reindex
            ? `Reindexovat (${indexStatus.changed_files} změn)`
            : "Reindexovat KB"}
        </button>
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
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
                  <>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="text-xs text-red-800 hover:text-red-400 disabled:opacity-50 px-2 py-1 border border-red-900 hover:border-red-700 rounded-lg transition-colors"
                    >
                      {deleting ? "Mažu..." : "Smazat"}
                    </button>
                    <button
                      onClick={handleEdit}
                      className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded-lg"
                    >
                      Upravit
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {readOnly && !diffSha && (
              <div className="flex items-center gap-2 px-4 py-2 bg-yellow-950 border-b border-yellow-900 text-yellow-400 text-xs flex-shrink-0">
                <span>🔒</span>
                <span>Tento soubor je chráněný — read only</span>
              </div>
            )}

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

            <div className="flex-1 min-h-0 flex flex-col">
              {diffSha ? (
                diffData ? (
                  <>
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
                <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                  Načítám...
                </div>
              )}
            </div>

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
