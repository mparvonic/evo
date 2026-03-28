"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type SourceItem = {
  url: string;
  label?: string;
  mode?: string;
  digest?: string;
};

type Sources = {
  default_domains?: string[];
  items?: SourceItem[];
};

type ValidationResult = Record<string, "available" | "unavailable" | "error">;

export default function SourcesPage() {
  const { projekt } = useParams<{ projekt: string }>();
  const { data: sources, mutate } = useSWR<Sources>(
    `/api/projects/${projekt}/sources`,
    fetcher
  );
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const handleEdit = () => {
    setEditJson(JSON.stringify(sources ?? { default_domains: [], items: [] }, null, 2));
    setEditing(true);
  };

  const handleSave = async () => {
    try {
      const data = JSON.parse(editJson);
      setSaving(true);
      await fetch(`/api/projects/${projekt}/sources`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      mutate();
      setEditing(false);
    } catch {
      alert("Neplatný JSON");
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch(`/api/projects/${projekt}/sources/validate`);
      const data = await res.json();
      setValidation(data.results ?? data);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 uppercase tracking-wider">Zdroje projektu</p>
        <div className="flex gap-2">
          <button
            onClick={handleValidate}
            disabled={validating}
            className="text-xs px-3 py-1.5 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {validating ? "Validuji..." : "Validovat dostupnost"}
          </button>
          {!editing && (
            <button
              onClick={handleEdit}
              className="text-xs px-3 py-1.5 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-lg transition-colors"
            >
              Upravit
            </button>
          )}
        </div>
      </div>

      {/* Výsledky validace */}
      {validation && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Výsledky validace</p>
          <div className="space-y-2">
            {Object.entries(validation).map(([url, status]) => (
              <div key={url} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "available" ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-xs font-mono text-gray-300 truncate flex-1">{url}</span>
                <span className={`text-xs flex-shrink-0 ${status === "available" ? "text-green-400" : "text-red-400"}`}>
                  {status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editing */}
      {editing ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <span className="text-xs text-gray-500">Editace JSON</span>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1">
                Zrušit
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded-lg"
              >
                {saving ? "Ukládám..." : "Uložit"}
              </button>
            </div>
          </div>
          <textarea
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
            className="w-full h-64 p-4 text-xs font-mono bg-gray-900 text-gray-300 focus:outline-none resize-none"
          />
        </div>
      ) : (
        <>
          {/* Default domains */}
          {sources?.default_domains && sources.default_domains.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Výchozí domény</p>
              <div className="flex flex-wrap gap-2">
                {sources.default_domains.map((d) => (
                  <span key={d} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded font-mono">{d}</span>
                ))}
              </div>
            </div>
          )}

          {/* Items */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <p className="text-xs text-gray-500 uppercase tracking-wider px-4 py-3 border-b border-gray-800">
              Zdroje ({sources?.items?.length ?? 0})
            </p>
            {sources?.items?.length ? (
              <div className="divide-y divide-gray-800">
                {sources.items.map((item, i) => (
                  <div key={i} className="px-4 py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-gray-300 truncate">{item.url}</p>
                      {item.label && <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>}
                    </div>
                    {item.mode && (
                      <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded flex-shrink-0">{item.mode}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-gray-600">
                {sources ? "Žádné zdroje. Klikni Upravit pro přidání." : "Načítám..."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
