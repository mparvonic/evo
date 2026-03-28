"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";

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

  const activeTab = TABS.find((t) => pathname.includes(`/${t.key}`))?.key ?? "tasks";

  return (
    <div className="flex flex-col h-full">
      {/* Projekt header */}
      <div className="px-6 pt-5 pb-0 flex-shrink-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Projekt</p>
        <h1 className="text-lg font-semibold text-white mb-4">{projekt}</h1>

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
