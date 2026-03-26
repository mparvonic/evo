"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(bytes: number) {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + " TB";
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  return (bytes / 1e6).toFixed(0) + " MB";
}

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Bar({ pct, color = "bg-blue-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-1">
      <div
        className={`${color} h-1.5 rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function StatCard({ label, value, sub, pct, color }: {
  label: string; value: string; sub?: string; pct?: number; color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      {pct !== undefined && <Bar pct={pct} color={color} />}
    </div>
  );
}

export default function SystemStats() {
  const { data, error } = useSWR("/api/system/stats", fetcher, { refreshInterval: 5000 });

  if (error) return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-gray-600 text-sm">
      EVO-X2 nedostupný
    </div>
  );

  if (!data) return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-gray-600 text-sm animate-pulse">
      Načítám stats...
    </div>
  );

  const cpuColor = data.cpu.pct > 80 ? "bg-red-500" : data.cpu.pct > 50 ? "bg-yellow-500" : "bg-blue-500";
  const ramColor = data.ram.pct > 85 ? "bg-red-500" : data.ram.pct > 65 ? "bg-yellow-500" : "bg-blue-500";
  const vramPct = data.gpu ? Math.round(data.ollama_vram_used / data.gpu.total * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">EVO-X2 · live</h2>
        <span className="text-xs text-gray-600">uptime {fmtUptime(data.uptime_s)}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="CPU"
          value={`${data.cpu.pct.toFixed(0)}%`}
          sub={`${data.cpu.cores} cores`}
          pct={data.cpu.pct}
          color={cpuColor}
        />
        <StatCard
          label="System RAM"
          value={`${data.ram.pct.toFixed(0)}%`}
          sub={`${fmt(data.ram.used)} / ${fmt(data.ram.total)}`}
          pct={data.ram.pct}
          color={ramColor}
        />
        {data.gpu && (
          <StatCard
            label="GPU VRAM (modely)"
            value={`${fmt(data.ollama_vram_used)}`}
            sub={`z ${fmt(data.gpu.total)} rezervováno`}
            pct={vramPct}
            color="bg-purple-500"
          />
        )}
        {data.disk && (
          <StatCard
            label="/data disk"
            value={`${data.disk.pct.toFixed(0)}%`}
            sub={`${fmt(data.disk.used)} / ${fmt(data.disk.total)}`}
            pct={data.disk.pct}
            color={data.disk.pct > 85 ? "bg-red-500" : "bg-green-500"}
          />
        )}
      </div>

      {data.ollama_models?.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Ollama – načtené modely</p>
          <div className="flex flex-col gap-2">
            {data.ollama_models.map((m: { name: string; size: number; size_vram: number }) => (
              <div key={m.name} className="flex items-center justify-between">
                <span className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">{m.name}</span>
                <div className="text-xs text-gray-500 flex gap-3">
                  <span>celkem {fmt(m.size)}</span>
                  <span className="text-purple-400">GPU {fmt(m.size_vram)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
