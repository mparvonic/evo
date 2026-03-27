"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ToolCall = { name: string; input: unknown; output: string; ts: string };

type Block =
  | { type: "plan"; content: string; ts: string; level: string }
  | { type: "agent"; name: string; model: string; prompt: unknown; response: string; tool_calls: ToolCall[]; tokens: number; ts: string }
  | { type: "summary"; content: string; ts: string }
  | { type: "generation"; name: string; model: string; prompt: unknown; response: string; tokens: number; cost_usd: number; ts: string }
  | { type: "span"; name: string; content: string; ts: string };

type Trace = {
  trace_id: string;
  task_id: string;
  projekt: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  tokens: { local: number; cloud: number };
  cost_usd: number;
  blocks: Block[];
};

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("cs-CZ");
}

function fmtTokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="text-xs text-gray-400 bg-gray-950 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
      {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
    </pre>
  );
}

function PlanBlock({ b }: { b: Extract<Block, { type: "plan" }> }) {
  return (
    <div className="border border-blue-900 bg-blue-950/30 rounded-xl p-4">
      <p className="text-xs text-blue-400 font-medium uppercase tracking-wider mb-2">Plán</p>
      <pre className="text-sm text-gray-200 whitespace-pre-wrap">{b.content}</pre>
      <p className="text-xs text-gray-600 mt-2">{fmtTime(b.ts)}</p>
    </div>
  );
}

function AgentBlock({ b }: { b: Extract<Block, { type: "agent" }> }) {
  return (
    <div className="border border-gray-700 bg-gray-900 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <span className="text-xs text-purple-400 font-medium uppercase tracking-wider">Agent</span>
          <span className="text-sm text-gray-300 font-medium">{b.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-600">
          {b.model && <span>{b.model}</span>}
          {b.tokens > 0 && <span>{fmtTokens(b.tokens)} tok</span>}
          <span>{fmtTime(b.ts)}</span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        {b.prompt && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Prompt</p>
            <JsonView data={b.prompt} />
          </div>
        )}
        {b.response && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Odpověď</p>
            <pre className="text-sm text-gray-200 whitespace-pre-wrap bg-gray-950 rounded p-3 max-h-64 overflow-auto">
              {b.response}
            </pre>
          </div>
        )}
        {b.tool_calls?.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">Tool calls ({b.tool_calls.length})</p>
            <div className="space-y-2">
              {b.tool_calls.map((tc, i) => (
                <div key={i} className="border border-gray-800 rounded-lg p-3">
                  <p className="text-xs text-yellow-500 font-medium mb-1">{tc.name}</p>
                  <JsonView data={tc.input} />
                  {tc.output && (
                    <pre className="text-xs text-gray-400 mt-2 whitespace-pre-wrap max-h-32 overflow-auto">
                      {tc.output}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryBlock({ b }: { b: Extract<Block, { type: "summary" }> }) {
  return (
    <div className="border border-green-900 bg-green-950/30 rounded-xl p-4">
      <p className="text-xs text-green-400 font-medium uppercase tracking-wider mb-2">Souhrn</p>
      <pre className="text-sm text-gray-200 whitespace-pre-wrap">{b.content}</pre>
      <p className="text-xs text-gray-600 mt-2">{fmtTime(b.ts)}</p>
    </div>
  );
}

function GenBlock({ b }: { b: Extract<Block, { type: "generation" }> }) {
  return (
    <div className="border border-gray-800 bg-gray-900 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Generation</span>
          <span className="text-sm text-gray-400">{b.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-600">
          {b.model && <span>{b.model}</span>}
          {b.tokens > 0 && <span>{fmtTokens(b.tokens)} tok</span>}
          {b.cost_usd > 0 && <span>${b.cost_usd.toFixed(5)}</span>}
        </div>
      </div>
      <div className="p-4 space-y-2">
        {b.prompt && <JsonView data={b.prompt} />}
        {b.response && (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap">{b.response}</pre>
        )}
      </div>
    </div>
  );
}

function SpanBlock({ b }: { b: Extract<Block, { type: "span" }> }) {
  return (
    <div className="border border-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-600 font-medium mb-1">{b.name}</p>
      {b.content && <pre className="text-xs text-gray-400 whitespace-pre-wrap">{b.content}</pre>}
    </div>
  );
}

export default function TaskTrace({ projekt, taskId }: { projekt: string; taskId: string }) {
  const { data: trace, error, isLoading } = useSWR<Trace>(
    `/api/projects/${projekt}/tasks/${taskId}`,
    fetcher
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800 bg-gray-950">
        <Link href={`/dashboard/project/${projekt}`} className="text-gray-600 hover:text-gray-400 text-sm">
          ← {projekt}
        </Link>
        <span className="text-gray-700">/</span>
        <h1 className="text-sm font-medium text-gray-300 truncate">
          {isLoading ? "Načítám..." : trace?.task_id || taskId}
        </h1>
        {trace && (
          <span className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
            trace.status === "COMPLETED" ? "bg-green-900 text-green-300" :
            trace.status === "ERROR"     ? "bg-red-900 text-red-300" :
                                           "bg-gray-800 text-gray-400"
          }`}>
            {trace.status}
          </span>
        )}
      </div>

      {/* Meta */}
      {trace && (
        <div className="flex gap-6 px-6 py-3 border-b border-gray-800 text-xs text-gray-500">
          <span>start: {fmtTime(trace.started_at)}</span>
          <span>konec: {fmtTime(trace.completed_at)}</span>
          <span>tokeny: {fmtTokens(trace.tokens.local)} local / {fmtTokens(trace.tokens.cloud)} cloud</span>
          {trace.cost_usd > 0 && <span>náklady: ${trace.cost_usd.toFixed(5)}</span>}
        </div>
      )}

      {/* Bloky */}
      <div className="p-6 space-y-4 max-w-4xl">
        {isLoading && <p className="text-gray-600">Načítám trace...</p>}
        {error && <p className="text-red-400">Trace nedostupný</p>}
        {trace?.blocks?.length === 0 && (
          <p className="text-gray-600">Žádné bloky v tomto trace.</p>
        )}
        {trace?.blocks?.map((b, i) => {
          if (b.type === "plan")       return <PlanBlock    key={i} b={b} />;
          if (b.type === "agent")      return <AgentBlock   key={i} b={b} />;
          if (b.type === "summary")    return <SummaryBlock key={i} b={b} />;
          if (b.type === "generation") return <GenBlock     key={i} b={b} />;
          if (b.type === "span")       return <SpanBlock    key={i} b={b} />;
          return null;
        })}
      </div>
    </div>
  );
}
