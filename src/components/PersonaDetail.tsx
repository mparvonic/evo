"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useState, useRef } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type PersonaFull = {
  slug: string;
  jmeno: string;
  role: string;
  model: string;
  aktivni: boolean;
  system_prompt: string;
  profil: string;
  use_cases: string;
  profil_excerpt: string;
  use_case_count: number;
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

type Tab = "profil" | "use_cases" | "agent";

function MarkdownTab({
  content,
  slug,
  soubor,
  onSaved,
}: {
  content: string;
  slug: string;
  soubor: "profil.md" | "use-cases.md";
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function handleChange(val: string | undefined) {
    setDraft(val ?? "");
    setDirty((val ?? "") !== content);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const field = soubor === "profil.md" ? "profil" : "use_cases";
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
        <span className="text-xs text-gray-500 font-mono">{soubor}</span>
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

function AgentTab({
  persona,
  onSaved,
}: {
  persona: PersonaFull;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    jmeno: persona.jmeno,
    role: persona.role,
    model: persona.model,
    system_prompt: persona.system_prompt,
    aktivni: persona.aktivni,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (k: string, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

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
    <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
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
          placeholder="Krátký popis role"
          required
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

      <div>
        <label className="block text-xs text-gray-400 mb-1">System prompt</label>
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-600"
          rows={8}
          value={form.system_prompt}
          onChange={(e) => set("system_prompt", e.target.value)}
          placeholder="Instrukce pro personu při hodnocení plánu..."
        />
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

      <div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium"
        >
          {saving ? "Ukládám..." : saved ? "✓ Uloženo" : "Uložit"}
        </button>
      </div>
    </form>
  );
}

export default function PersonaDetail({ slug }: { slug: string }) {
  const { data: persona, mutate } = useSWR<PersonaFull>(
    `/api/personas/${slug}`,
    fetcher
  );
  const [tab, setTab] = useState<Tab>("profil");

  if (!persona) {
    return <div className="text-gray-500 text-sm">Načítám personu...</div>;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "profil",    label: "Profil" },
    { id: "use_cases", label: `Use Cases (${persona.use_case_count})` },
    { id: "agent",     label: "Agent" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Hlavička */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-0.5">
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
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-500 text-white"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Obsah záložky */}
      <div className="flex-1 min-h-0">
        {tab === "profil" && (
          <MarkdownTab
            content={persona.profil}
            slug={slug}
            soubor="profil.md"
            onSaved={mutate}
          />
        )}
        {tab === "use_cases" && (
          <MarkdownTab
            content={persona.use_cases}
            slug={slug}
            soubor="use-cases.md"
            onSaved={mutate}
          />
        )}
        {tab === "agent" && (
          <AgentTab persona={persona} onSaved={mutate} />
        )}
      </div>
    </div>
  );
}
