"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState } from "react";

type PersonaMeta = {
  slug: string;
  jmeno: string;
  role: string;
  aktivni: boolean;
  persona_excerpt: string;
  use_case_count: number;
  prompts_ready: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PersonaCatalog() {
  const { data: persony, mutate } = useSWR<PersonaMeta[]>("/api/personas", fetcher);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleToggle(p: PersonaMeta) {
    await fetch(`/api/personas/${p.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aktivni: !p.aktivni }),
    });
    mutate();
  }

  async function handleDelete(slug: string) {
    setDeleting(null);
    await fetch(`/api/personas/${slug}`, { method: "DELETE" });
    mutate();
  }

  if (!persony) {
    return <div className="text-gray-500 text-sm">Načítám persony...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          {persony.filter((p) => p.aktivni).length} aktivních z {persony.length}
        </p>
        <Link
          href="/dashboard/personas/new"
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium"
        >
          + Nová persona
        </Link>
      </div>

      {persony.map((p) => (
        <div
          key={p.slug}
          className={`bg-gray-900 border rounded-lg p-4 transition-opacity ${
            p.aktivni ? "border-gray-700" : "border-gray-800 opacity-60"
          }`}
        >
          <div className="flex items-start gap-4">
            {/* Hlavní info — klikatelné */}
            <Link href={`/dashboard/personas/${p.slug}`} className="flex-1 min-w-0 group">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-white group-hover:text-blue-300 transition-colors">
                  {p.jmeno}
                </span>
                <span className="text-xs text-gray-600 font-mono">{p.slug}</span>
                {p.aktivni ? (
                  <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">aktivní</span>
                ) : (
                  <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">neaktivní</span>
                )}
              </div>
              <p className="text-sm text-gray-400 mb-2">{p.role}</p>
              {p.persona_excerpt && (
                <p className="text-xs text-gray-500 line-clamp-2">{p.persona_excerpt}</p>
              )}
              <div className="flex items-center gap-3 mt-1">
                {p.use_case_count > 0 && (
                  <span className="text-xs text-gray-600">{p.use_case_count} use case{p.use_case_count !== 1 ? "s" : ""}</span>
                )}
                {p.prompts_ready ? (
                  <span className="text-xs text-green-700">prompty ✓</span>
                ) : (
                  <span className="text-xs text-yellow-800">prompty chybí</span>
                )}
              </div>
            </Link>

            {/* Akce */}
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href={`/dashboard/personas/${p.slug}`}
                className="text-xs text-gray-500 hover:text-blue-400 px-2 py-1 rounded border border-gray-700 hover:border-blue-700"
              >
                Upravit
              </Link>
              <button
                onClick={() => handleToggle(p)}
                className={`text-xs px-2 py-1 rounded border ${
                  p.aktivni
                    ? "text-yellow-500 border-yellow-900 hover:border-yellow-600"
                    : "text-green-500 border-green-900 hover:border-green-700"
                }`}
              >
                {p.aktivni ? "Deaktivovat" : "Aktivovat"}
              </button>
              <button
                onClick={() => setDeleting(p.slug)}
                className="text-xs text-red-700 hover:text-red-500 px-2 py-1 rounded border border-gray-800 hover:border-red-900"
              >
                Smazat
              </button>
            </div>
          </div>

          {/* Potvrzení smazání */}
          {deleting === p.slug && (
            <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-3">
              <span className="text-sm text-red-400">Opravdu smazat personu &quot;{p.jmeno}&quot;?</span>
              <button
                onClick={() => handleDelete(p.slug)}
                className="text-xs bg-red-800 hover:bg-red-700 px-3 py-1 rounded"
              >
                Smazat
              </button>
              <button
                onClick={() => setDeleting(null)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Zrušit
              </button>
            </div>
          )}
        </div>
      ))}

      {persony.length === 0 && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-lg mb-2">Žádné persony</p>
          <p className="text-sm">Vytvořte první personu kliknutím na tlačítko výše.</p>
        </div>
      )}
    </div>
  );
}
