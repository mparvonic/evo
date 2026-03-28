"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useState, useRef, useEffect, useCallback } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TABS = [
  { key: "tasks",    label: "Tasky" },
  { key: "chat",     label: "Chat" },
  { key: "kb",       label: "KB" },
  { key: "outputs",  label: "Výstupy" },
  { key: "datalab",  label: "Data Lab" },
  { key: "sources",  label: "Zdroje" },
  { key: "personas", label: "Persony" },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projekt: string }>();
  const pathname = usePathname();
  const projekt = params.projekt;

  const { data, mutate } = useSWR<{ id: string; name: string }>(
    `/api/projects/${projekt}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const displayName = data?.name ?? projekt;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = useCallback(() => {
    setDraft(displayName);
    setEditing(true);
  }, [displayName]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = useCallback(async () => {
    const name = draft.trim();
    if (!name || name === displayName) { setEditing(false); return; }
    await fetch(`/api/projects/${projekt}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    mutate();
    setEditing(false);
  }, [draft, displayName, projekt, mutate]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  }, [save]);

  const activeTab = TABS.find((t) => pathname.includes(`/${t.key}`))?.key ?? "tasks";

  return (
    <div className="flex flex-col h-full">
      {/* Projekt header */}
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Projekt</p>
        <div className="flex items-center gap-2 mb-4 group">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={save}
              className="text-lg font-semibold text-white bg-gray-800 border border-blue-600 rounded px-2 py-0.5 focus:outline-none w-64"
            />
          ) : (
            <>
              <h1 className="text-lg font-semibold text-white">{displayName}</h1>
              <button
                onClick={startEdit}
                title="Přejmenovat projekt"
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-gray-400 transition-opacity text-xs px-1"
              >
                ✎
              </button>
            </>
          )}
        </div>

        {/* Taby */}
        <div className="flex gap-1 border-b border-gray-800">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <Link
                key={tab.key}
                href={`/dashboard/project/${projekt}/${tab.key}`}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Obsah tabulátoru */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {children}
      </div>
    </div>
  );
}
