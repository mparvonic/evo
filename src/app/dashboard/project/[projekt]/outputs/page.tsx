"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type OutputFile = { name: string; size: number; modified: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function OutputsPage() {
  const { projekt } = useParams<{ projekt: string }>();
  const { data: files, isLoading } = useSWR<OutputFile[]>(
    `/api/projects/${projekt}/outputs`,
    fetcher,
    { refreshInterval: 15000 }
  );
  const [selected, setSelected] = useState<string | null>(null);
  const { data: content } = useSWR<{ content: string }>(
    selected ? `/api/projects/${projekt}/outputs/file?name=${encodeURIComponent(selected)}` : null,
    fetcher
  );

  return (
    <div className="flex gap-4 h-full">
      {/* Seznam souborů */}
      <div className="w-64 flex-shrink-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Výstupy ({files?.length ?? 0})</p>
        {isLoading && <p className="text-xs text-gray-600">Načítám...</p>}
        <div className="space-y-1">
          {(files ?? []).map((f) => (
            <button
              key={f.name}
              onClick={() => setSelected(f.name)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selected === f.name ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"
              }`}
            >
              <div className="truncate">{f.name}</div>
              <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                <span>{formatSize(f.size)}</span>
                <span>{new Date(f.modified * 1000).toLocaleDateString("cs-CZ")}</span>
              </div>
            </button>
          ))}
          {!isLoading && !files?.length && (
            <p className="text-gray-600 text-sm px-1">Žádné výstupy</p>
          )}
        </div>
      </div>

      {/* Náhled souboru */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500 truncate">{selected}</span>
            </div>
            <div className="overflow-auto h-full p-4">
              {content ? (
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                  {content.content}
                </pre>
              ) : (
                <p className="text-gray-600 text-sm">Načítám...</p>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-gray-600 text-sm text-center">
            Vyberte soubor pro náhled
          </div>
        )}
      </div>
    </div>
  );
}
