"use client";

import useSWR from "swr";
import Link from "next/link";

type Project = {
  id: string;
  knowledge_files: number;
  has_log: boolean;
  log_modified: number | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function ProjectList() {
  const { data: projects, error, isLoading } = useSWR<Project[]>("/api/projects", fetcher, { refreshInterval: 10000 });

  if (isLoading) return <p className="text-gray-500 text-sm">Načítám projekty...</p>;
  if (error) return <p className="text-red-400 text-sm">Chyba připojení k EVO-X2 API</p>;
  if (!projects?.length) return <p className="text-gray-500 text-sm">Žádné projekty</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/dashboard/project/${p.id}`}
          className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
        >
          <div className="flex items-start justify-between">
            <h2 className="font-semibold group-hover:text-blue-400 transition-colors">{p.id}</h2>
            {p.has_log && (
              <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">aktivní</span>
            )}
          </div>
          <p className="text-gray-500 text-sm mt-2">{p.knowledge_files} KB souborů</p>
          {p.log_modified && (
            <p className="text-gray-600 text-xs mt-1">
              log: {new Date(p.log_modified * 1000).toLocaleString("cs-CZ")}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
