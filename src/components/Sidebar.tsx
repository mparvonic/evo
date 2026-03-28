"use client";

import useSWR from "swr";
import Link from "next/link";
import { usePathname } from "next/navigation";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Project = { id: string; name: string };
type Stats = {
  active_tasks?: number;
  tasks_waiting_approval?: number;
  cpu?: { pct: number; cores: number };
  ram?: { total: number; used: number; pct: number };
};

export default function Sidebar() {
  const pathname = usePathname();
  const { data: projects } = useSWR<Project[]>("/api/projects", fetcher, { refreshInterval: 30000 });
  const { data: stats } = useSWR<Stats>("/api/system/stats", fetcher, { refreshInterval: 10000 });

  const healthy = stats !== undefined;

  const navLink = (href: string, label: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
          active ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <aside className="w-60 flex-shrink-0 h-screen flex flex-col bg-gray-950 border-r border-gray-800 overflow-hidden">
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-3 border-b border-gray-800 flex-shrink-0">
        <div className="relative">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">E</div>
          <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-950 ${healthy ? "bg-green-400" : "bg-red-500"}`} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white leading-tight">EVO</p>
          <p className="text-xs text-gray-500 leading-tight">Dashboard</p>
        </div>
      </div>

      {/* Navigace */}
      <nav className="px-2 py-4 flex flex-col gap-1 flex-shrink-0">
        {navLink("/dashboard", "Přehled")}
        {navLink("/dashboard/chats", "Chaty")}
        {navLink("/dashboard/personas", "Persony")}
      </nav>

      {/* Projekty */}
      <div className="px-2 flex-1 overflow-y-auto min-h-0">
        <p className="text-xs text-gray-600 uppercase tracking-wider px-3 mb-2">Projekty</p>
        {projects?.map((p) => {
          const href = `/dashboard/project/${p.id}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={p.id}
              href={`${href}/tasks`}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-900 hover:text-gray-200"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0" />
              <span className="truncate">{p.name || p.id}</span>
            </Link>
          );
        })}
        {!projects?.length && (
          <p className="text-xs text-gray-700 px-3">Načítám...</p>
        )}
      </div>

      {/* Mini stats */}
      {stats && (
        <div className="px-4 py-3 border-t border-gray-800 flex-shrink-0 space-y-1.5">
          {stats.active_tasks !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Aktivní tasky</span>
              <span className="text-gray-300">{stats.active_tasks}</span>
            </div>
          )}
          {stats.tasks_waiting_approval !== undefined && stats.tasks_waiting_approval > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-yellow-600">Čeká na schválení</span>
              <span className="text-yellow-400 font-medium">{stats.tasks_waiting_approval}</span>
            </div>
          )}
          {stats.cpu !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">CPU</span>
              <span className="text-gray-400">{stats.cpu.pct}%</span>
            </div>
          )}
          {stats.ram !== undefined && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">RAM</span>
              <span className="text-gray-400">{Math.round(stats.ram.used / 1024 ** 3)} GB</span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
