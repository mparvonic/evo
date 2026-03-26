"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";
import Chat from "@/components/Chat";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type KBFile = { path: string; kategorie: string; name: string; size: number; modified: number };
type LogData = { lines: string[] };

export default function ProjectDetail({ projekt }: { projekt: string }) {
  const { data: tree } = useSWR<KBFile[]>(`/api/projects/${projekt}/knowledge/tree`, fetcher);
  const { data: log } = useSWR<LogData>(`/api/projects/${projekt}/tasks/log?lines=30`, fetcher, {
    refreshInterval: 5000,
  });
  const [activeTab, setActiveTab] = useState<"kb" | "log" | "chat">("kb");

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6">
        <Link href="/dashboard" className="text-gray-500 text-sm hover:text-gray-300">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-2">{projekt}</h1>
      </div>

      <div className="flex gap-2 mb-6 border-b border-gray-800 pb-2">
        {(["kb", "log", "chat"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              activeTab === tab ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab === "kb" ? "Knowledge Base" : tab === "log" ? "Task Log" : "Chat"}
          </button>
        ))}
      </div>

      {activeTab === "kb" && (
        <KnowledgeTree tree={tree || []} projekt={projekt} />
      )}
      {activeTab === "log" && (
        <TaskLog lines={log?.lines || []} />
      )}
      {activeTab === "chat" && (
        <Chat projekt={projekt} />
      )}
    </div>
  );
}

function KnowledgeTree({ tree, projekt }: { tree: KBFile[]; projekt: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: fileData } = useSWR(
    selected ? `/api/projects/${projekt}/knowledge/file?path=${encodeURIComponent(selected)}` : null,
    fetcher
  );

  const grouped = tree.reduce<Record<string, KBFile[]>>((acc, f) => {
    (acc[f.kategorie] = acc[f.kategorie] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="flex gap-6">
      <div className="w-64 flex-shrink-0 space-y-4">
        {Object.entries(grouped).map(([kat, files]) => (
          <div key={kat}>
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">{kat || "root"}</p>
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelected(f.path)}
                className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors truncate ${
                  selected === f.path ? "bg-gray-800 text-white" : "text-gray-400"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        ))}
        {tree.length === 0 && <p className="text-gray-600 text-sm">Prázdná knowledge base</p>}
      </div>

      <div className="flex-1 min-w-0">
        {fileData ? (
          <div>
            <p className="text-xs text-gray-600 mb-3">{fileData.path}</p>
            <pre className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900 rounded-xl p-4 border border-gray-800 overflow-auto max-h-[60vh]">
              {fileData.content}
            </pre>
          </div>
        ) : (
          <p className="text-gray-600 text-sm">Vyberte soubor</p>
        )}
      </div>
    </div>
  );
}

function TaskLog({ lines }: { lines: string[] }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 max-h-[70vh] overflow-auto">
      {lines.length === 0 ? (
        <p className="text-gray-600 text-sm">Žádné záznamy</p>
      ) : (
        <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}
