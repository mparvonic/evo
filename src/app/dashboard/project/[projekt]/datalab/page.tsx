"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Session = {
  task_id: string;
  created_at?: string;
  source_url?: string;
};

type ColumnStat = {
  type?: string;
  null_count?: number;
  min?: string;
  max?: string;
  sample?: string[];
};

type Profile = {
  dataset?: string;
  row_count?: number;
  columns?: Record<string, ColumnStat>;
};

type SessionDetail = {
  task_id: string;
  profile?: Profile;
  schema_sql?: string;
  contract?: Record<string, unknown>;
  raw_sample_size?: number;
};

export default function DataLabPage() {
  const { projekt } = useParams<{ projekt: string }>();
  const { data: sessions, isLoading } = useSWR<Session[]>(
    `/api/projects/${projekt}/datalab`,
    fetcher,
    { refreshInterval: 30000 }
  );
  const [selected, setSelected] = useState<string | null>(null);
  const { data: detail } = useSWR<SessionDetail>(
    selected ? `/api/projects/${projekt}/datalab/${selected}` : null,
    fetcher
  );

  return (
    <div className="flex gap-4">
      {/* Seznam sessions */}
      <div className="w-64 flex-shrink-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Sessions ({sessions?.length ?? 0})</p>
        {isLoading && <p className="text-xs text-gray-600">Načítám...</p>}
        <div className="space-y-1">
          {(sessions ?? []).map((s) => (
            <button
              key={s.task_id}
              onClick={() => setSelected(s.task_id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selected === s.task_id ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900"
              }`}
            >
              <div className="font-mono truncate text-xs">{s.task_id}</div>
              {s.source_url && (
                <div className="text-xs text-gray-600 truncate mt-0.5">{s.source_url}</div>
              )}
            </button>
          ))}
          {!isLoading && !sessions?.length && (
            <p className="text-gray-600 text-sm px-1">Žádné Data Lab sessions</p>
          )}
        </div>
      </div>

      {/* Detail session */}
      <div className="flex-1 min-w-0 space-y-4">
        {selected && detail ? (
          <>
            {/* Profil */}
            {detail.profile && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                  Profil — {detail.profile.dataset} ({detail.profile.row_count?.toLocaleString()} řádků)
                </p>
                {detail.profile.columns && (
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-4 font-normal">Sloupec</th>
                          <th className="text-left py-2 pr-4 font-normal">Typ</th>
                          <th className="text-left py-2 pr-4 font-normal">NULL</th>
                          <th className="text-left py-2 pr-4 font-normal">Min</th>
                          <th className="text-left py-2 font-normal">Max</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(detail.profile.columns).map(([col, stat]) => (
                          <tr key={col} className="border-b border-gray-800/50 text-gray-300">
                            <td className="py-1.5 pr-4 font-mono">{col}</td>
                            <td className="py-1.5 pr-4 text-gray-500">{stat.type ?? "?"}</td>
                            <td className="py-1.5 pr-4 text-gray-500">{stat.null_count ?? 0}</td>
                            <td className="py-1.5 pr-4 text-gray-500 truncate max-w-xs">{stat.min ?? "—"}</td>
                            <td className="py-1.5 text-gray-500 truncate max-w-xs">{stat.max ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Schema SQL */}
            {detail.schema_sql && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Schema kandidát</p>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto">
                  {detail.schema_sql}
                </pre>
              </div>
            )}

            {/* Data kontrakt */}
            {detail.contract && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Data kontrakt</p>
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(detail.contract, null, 2)}
                </pre>
              </div>
            )}
          </>
        ) : selected ? (
          <p className="text-gray-600 text-sm">Načítám...</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-gray-600 text-sm text-center">
            Vyberte session pro detail
          </div>
        )}
      </div>
    </div>
  );
}
