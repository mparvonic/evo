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

function Dot({ color }: { color: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color} flex-shrink-0`} />;
}

export default function SystemStats() {
  const { data, error } = useSWR("/api/system/stats", fetcher, { refreshInterval: 5000 });

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-800 bg-gray-950 text-xs flex-wrap">
      <div className="flex items-center gap-1.5">
        <Dot color={error ? "bg-red-500" : data ? "bg-green-500" : "bg-yellow-500 animate-pulse"} />
        <span className="text-gray-500 font-medium">EVO-X2</span>
      </div>

      {error && <span className="text-red-500">nedostupný</span>}

      {data && (
        <>
          <span className="text-gray-600">CPU</span>
          <span className={data.cpu.pct > 80 ? "text-yellow-400" : "text-gray-300"}>
            {data.cpu.pct.toFixed(0)}%
          </span>

          <span className="text-gray-800">·</span>

          <span className="text-gray-600">RAM</span>
          <span className={data.ram.pct > 80 ? "text-yellow-400" : "text-gray-300"}>
            {data.ram.pct.toFixed(0)}% ({fmt(data.ram.used)}/{fmt(data.ram.total)})
          </span>

          {data.ollama_models?.length > 0 && (
            <>
              <span className="text-gray-800">·</span>
              <span className="text-gray-600">modely</span>
              {data.ollama_models.map((m: { name: string; size: number }) => (
                <span key={m.name} className="text-purple-400">
                  {m.name.split(":")[0]} ({fmt(m.size)})
                </span>
              ))}
            </>
          )}

          {data.disk && (
            <>
              <span className="text-gray-800">·</span>
              <span className="text-gray-600">/data</span>
              <span className={data.disk.pct > 85 ? "text-yellow-400" : "text-gray-300"}>
                {data.disk.pct.toFixed(0)}% ({fmt(data.disk.used)}/{fmt(data.disk.total)})
              </span>
            </>
          )}

          <span className="text-gray-800">·</span>
          <span className="text-gray-600">uptime</span>
          <span className="text-gray-400">{fmtUptime(data.uptime_s)}</span>
        </>
      )}
    </div>
  );
}
