"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useState } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type PromptFile = { soubor: string; content: string };

type PersonaFull = {
  slug: string;
  jmeno: string;
  role: string;
  model: string;
  aktivni: boolean;
  persona: string;
  use_cases: string;
  persona_excerpt: string;
  use_case_count: number;
  prompts_ready: boolean;
};

const MODEL_LABELS: Record<string, string> = {
  "evo-fast":         "evo-fast (qwen2.5:14b)",
  "evo-chat":         "evo-chat (qwen2.5:72b)",
  "evo-planner":      "evo-planner (deepseek-r1:32b)",
  "claude-haiku":     "Claude Haiku",
  "claude-sonnet":    "Claude Sonnet",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Tab = "profil" | "use_cases" | "prompty" | "nastaveni";

// ── Monaco editor tab pro MD soubory ────────────────────────────────────────

function MarkdownTab({
  initialContent,
  slug,
  field,
  filename,
  onSaved,
}: {
  initialContent: string;
  slug: string;
  field: "persona" | "use_cases";
  filename: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleChange(val: string | undefined) {
    const v = val ?? "";
    setDraft(v);
    setDirty(v !== initialContent);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/personas/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: draft }),
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-1 py-2 shrink-0">
        <span className="text-xs text-gray-500 font-mono">{filename}</span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-default rounded"
        >
          {saving ? "Ukládám..." : dirty ? "Uložit změny" : "Uloženo"}
        </button>
      </div>
      <div className="flex-1 min-h-0 rounded overflow-hidden border border-gray-800">
        <MonacoEditor
          height="100%"
          language="markdown"
          theme="vs-dark"
          value={draft}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            wordWrap: "on",
            lineNumbers: "off",
            folding: false,
            renderLineHighlight: "none",
            scrollBeyondLastLine: false,
            fontSize: 13,
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  );
}

// ── Záložka Prompty ──────────────────────────────────────────────────────────

function PromptsTab({ slug, onRegenerated }: { slug: string; onRegenerated: () => void }) {
  const { data: prompts, mutate } = useSWR<PromptFile[]>(
    `/api/personas/${slug}/prompts`,
    fetcher
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const r = await fetch(`/api/personas/${slug}/generate-prompts`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${r.status}`);
      }
      await mutate();
      onRegenerated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const selectedPrompt = prompts?.find((p) => p.soubor === selected) ?? prompts?.[0];

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-xs text-gray-500">
          {prompts?.length
            ? `${prompts.length} vygenerovaných souborů v prompts/`
            : "Žádné prompty — klikni Generovat"}
        </p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 rounded font-medium"
        >
          {generating ? "Generuji..." : "↺ Regenerovat prompty"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400 shrink-0">Chyba: {error}</p>}

      {prompts && prompts.length > 0 && (
        <div className="flex gap-3 flex-1 min-h-0">
          {/* Sidebar se soubory */}
          <div className="w-44 shrink-0 space-y-1">
            {prompts.map((p) => (
              <button
                key={p.soubor}
                onClick={() => setSelected(p.soubor)}
                className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
                  (selected ?? prompts[0].soubor) === p.soubor
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                {p.soubor}
              </button>
            ))}
          </div>

          {/* Obsah souboru */}
          {selectedPrompt && (
            <div className="flex-1 min-w-0 rounded border border-gray-800 overflow-hidden">
              <MonacoEditor
                height="100%"
                language="markdown"
                theme="vs-dark"
                value={selectedPrompt.content}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  wordWrap: "on",
                  lineNumbers: "off",
                  folding: false,
                  renderLineHighlight: "none",
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>
          )}
        </div>
      )}

      {generating && (
        <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
          <span className="animate-pulse">●</span>
          Generuji prompty pomocí evo-planner...
        </div>
      )}
    </div>
  );
}

// ── Záložka Nastavení (agent.yaml) ───────────────────────────────────────────

function NastaveniTab({ persona, onSaved }: { persona: PersonaFull; onSaved: () => void }) {
  const [form, setForm] = useState({
    jmeno: persona.jmeno,
    role: persona.role,
    model: persona.model,
    aktivni: persona.aktivni,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch(`/api/personas/${persona.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-lg">
      <p className="text-xs text-gray-500 font-mono mb-4">agent.yaml</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Slug (ID)</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm opacity-50 cursor-not-allowed"
            value={persona.slug}
            disabled
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Jméno</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            value={form.jmeno}
            onChange={(e) => set("jmeno", e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Role</label>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Model</label>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
          value={form.model}
          onChange={(e) => set("model", e.target.value)}
        >
          {Object.entries(MODEL_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="aktivni"
          checked={form.aktivni}
          onChange={(e) => set("aktivni", e.target.checked)}
          className="rounded"
        />
        <label htmlFor="aktivni" className="text-sm text-gray-300">
          Aktivní — zapojit do review při plánování
        </label>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium"
      >
        {saving ? "Ukládám..." : saved ? "✓ Uloženo" : "Uložit"}
      </button>
    </form>
  );
}

// ── Hlavní komponenta ────────────────────────────────────────────────────────

export default function PersonaDetail({ slug }: { slug: string }) {
  const { data: persona, mutate } = useSWR<PersonaFull>(
    `/api/personas/${slug}`,
    fetcher
  );
  const [tab, setTab] = useState<Tab>("profil");

  if (!persona) {
    return <div className="text-gray-500 text-sm">Načítám personu...</div>;
  }

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "profil",    label: "Profil",     badge: "persona.md" },
    { id: "use_cases", label: "Use Cases",  badge: `${persona.use_case_count}` },
    { id: "prompty",   label: "Prompty",    badge: persona.prompts_ready ? "✓" : "!" },
    { id: "nastaveni", label: "Nastavení" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Hlavička */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold">{persona.jmeno}</h1>
            <span className="text-xs text-gray-600 font-mono">{persona.slug}</span>
            {persona.aktivni ? (
              <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded-full">aktivní</span>
            ) : (
              <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">neaktivní</span>
            )}
          </div>
          <p className="text-sm text-gray-400">{persona.role}</p>
        </div>
      </div>

      {/* Záložky */}
      <div className="flex gap-1 border-b border-gray-800 mb-4 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-500 text-white"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
            {t.badge && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                t.id === "prompty"
                  ? persona.prompts_ready
                    ? "bg-green-900/50 text-green-400"
                    : "bg-yellow-900/50 text-yellow-400"
                  : "bg-gray-800 text-gray-500"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Obsah */}
      <div className="flex-1 min-h-0">
        {tab === "profil" && (
          <MarkdownTab
            initialContent={persona.persona}
            slug={slug}
            field="persona"
            filename="persona.md"
            onSaved={mutate}
          />
        )}
        {tab === "use_cases" && (
          <MarkdownTab
            initialContent={persona.use_cases}
            slug={slug}
            field="use_cases"
            filename="use-cases.md"
            onSaved={mutate}
          />
        )}
        {tab === "prompty" && (
          <PromptsTab slug={slug} onRegenerated={mutate} />
        )}
        {tab === "nastaveni" && (
          <NastaveniTab persona={persona} onSaved={mutate} />
        )}
      </div>
    </div>
  );
}
