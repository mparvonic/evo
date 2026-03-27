"use client";

import useSWR from "swr";
import Link from "next/link";

type Project = {
  id: string;
  knowledge_files: number;
  has_log: boolean;
  log_modified: number | null;
};

type FlowRun = {
  id: string;
  status: string;
};

type Costs = {
  total_7d_usd: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ProjectCard({ p }: { p: Project }) {
  const { data: tasks } = useSWR<FlowRun[]>(`/api/projects/${p.id}/tasks`, fetcher, {
    refreshInterval: 15000,
  });

  const running = tasks?.filter((t) => t.status === "RUNNING").length ?? 0;

  return (
    <Link
      href={`/dashboard/project/${p.id}`}
      className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
    >
      <div className="flex items-start justify-between">
        <h2 className="font-semibold group-hover:text-blue-400 transition-colors">{p.id}</h2>
        {running > 0 ? (
          <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            {running} běží
          </span>
        ) : p.has_log ? (
          <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">aktivní</span>
        ) : null}
      </div>
      <p className="text-gray-500 text-sm mt-2">{p.knowledge_files} KB souborů</p>
      {tasks !== undefined && (
        <p className="text-gray-600 text-xs mt-1">{tasks.length} tasků celkem</p>
      )}
      {p.log_modified && (
        <p className="text-gray-600 text-xs mt-0.5">
          poslední: {new Date(p.log_modified * 1000).toLocaleString("cs-CZ")}
        </p>
      )}
    </Link>
  );
}

function CostsBanner() {
  const { data } = useSWR<Costs>("/api/langfuse/costs", fetcher, { refreshInterval: 60000 });
  if (!data || data.total_7d_usd === 0) return null;
  return (
    <p className="text-xs text-gray-600 mb-4">
      Náklady (7 dní):{" "}
      <span className="text-gray-400">${data.total_7d_usd.toFixed(4)}</span>
    </p>
  );
}

export default function ProjectList() {
  const { data: projects, error, isLoading } = useSWR<Project[]>("/api/projects", fetcher, {
    refreshInterval: 10000,
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Načítám projekty...</p>;
  if (error) return <p className="text-red-400 text-sm">Chyba připojení k EVO-X2 API</p>;
  if (!projects?.length) return <p className="text-gray-500 text-sm">Žádné projekty</p>;

  return (
    <div>
      <CostsBanner />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}
