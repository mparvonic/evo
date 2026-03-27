"use client";

import useSWR from "swr";
import { useState } from "react";

type Persona = {
  slug: string;
  jmeno: string;
  role: string;
  model: string;
  aktivni: boolean;
  profil?: string;
  use_cases?: string;
  system_prompt?: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const MODEL_LABELS: Record<string, string> = {
  "evo-fast": "evo-fast (qwen2.5:14b)",
  "evo-chat": "evo-chat (qwen2.5:72b)",
  "evo-planner": "evo-planner (deepseek-r1:32b)",
  "claude-haiku": "Claude Haiku",
  "claude-sonnet": "Claude Sonnet",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
};

function PersonaForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Persona>;
  onSave: (data: Partial<Persona>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    slug: initial?.slug ?? "",
    jmeno: initial?.jmeno ?? "",
    role: initial?.role ?? "",
    model: initial?.model ?? "evo-fast",
    aktivni: initial?.aktivni ?? true,
    system_prompt: initial?.system_prompt ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Slug (ID)</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm disabled:opacity-50"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            disabled={!!initial?.slug}
            placeholder="napr-moje-persona"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Jméno</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            value={form.jmeno}
            onChange={(e) => set("jmeno", e.target.value)}
            placeholder="Zobrazované jméno"
            required
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Role</label>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          value={form.role}
          onChange={(e) => set("role", e.target.value)}
          placeholder="Krátký popis role"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Model</label>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
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
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          rows={6}
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
        <label htmlFor="aktivni" className="text-sm text-gray-300">Aktivní (zapojit do review)</label>
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
        >
          {saving ? "Ukládám..." : "Uložit"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          Zrušit
        </button>
      </div>
    </form>
  );
}

function PersonaCard({
  persona,
  onEdit,
  onToggle,
  onDelete,
}: {
  persona: Persona;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-gray-900 border rounded-lg p-4 ${persona.aktivni ? "border-gray-700" : "border-gray-800 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-white">{persona.jmeno}</span>
            <span className="text-xs text-gray-500 font-mono">{persona.slug}</span>
            {persona.aktivni ? (
              <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full">aktivní</span>
            ) : (
              <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">neaktivní</span>
            )}
          </div>
          <p className="text-sm text-gray-400">{persona.role}</p>
          <p className="text-xs text-gray-600 mt-1">{MODEL_LABELS[persona.model] ?? persona.model}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded border border-gray-700 hover:border-gray-600"
          >
            {expanded ? "Skrýt" : "Detail"}
          </button>
          <button
            onClick={onEdit}
            className="text-xs text-gray-500 hover:text-blue-400 px-2 py-1 rounded border border-gray-700 hover:border-blue-700"
          >
            Upravit
          </button>
          <button
            onClick={onToggle}
            className={`text-xs px-2 py-1 rounded border ${persona.aktivni ? "text-yellow-500 border-yellow-800 hover:border-yellow-600" : "text-green-500 border-green-900 hover:border-green-700"}`}
          >
            {persona.aktivni ? "Deaktivovat" : "Aktivovat"}
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-600 hover:text-red-400 px-2 py-1 rounded border border-gray-800 hover:border-red-800"
          >
            Smazat
          </button>
        </div>
      </div>

      {expanded && persona.system_prompt && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">System prompt</p>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono bg-gray-950 rounded p-3">
            {persona.system_prompt}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function PersonaCatalog() {
  const { data: persony, mutate } = useSWR<Persona[]>("/api/personas", fetcher);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detaily, setDetaily] = useState<Record<string, Persona>>({});

  async function loadDetail(slug: string) {
    if (detaily[slug]) return detaily[slug];
    const r = await fetch(`/api/personas/${slug}`);
    const d = await r.json();
    setDetaily((prev) => ({ ...prev, [slug]: d }));
    return d;
  }

  async function handleEdit(slug: string) {
    await loadDetail(slug);
    setEditSlug(slug);
  }

  async function handleSaveEdit(data: Partial<Persona>) {
    await fetch(`/api/personas/${editSlug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setEditSlug(null);
    mutate();
  }

  async function handleCreate(data: Partial<Persona>) {
    await fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setCreating(false);
    mutate();
  }

  async function handleToggle(persona: Persona) {
    await fetch(`/api/personas/${persona.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aktivni: !persona.aktivni }),
    });
    mutate();
  }

  async function handleDelete(slug: string) {
    if (!confirm(`Smazat personu "${slug}"? Tato akce je nevratná.`)) return;
    await fetch(`/api/personas/${slug}`, { method: "DELETE" });
    mutate();
  }

  if (!persony) {
    return <div className="text-gray-500 text-sm">Načítám persony...</div>;
  }

  const editPersona = editSlug ? (detaily[editSlug] ?? persony.find((p) => p.slug === editSlug)) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400">
          {persony.filter((p) => p.aktivni).length} aktivních z {persony.length} person
        </p>
        <button
          onClick={() => { setCreating(true); setEditSlug(null); }}
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium"
        >
          + Nová persona
        </button>
      </div>

      {creating && (
        <div className="bg-gray-900 border border-blue-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3 text-blue-300">Nová persona</h3>
          <PersonaForm
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {persony.map((p) =>
        editSlug === p.slug && editPersona ? (
          <div key={p.slug} className="bg-gray-900 border border-blue-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold mb-3 text-blue-300">Upravit: {p.jmeno}</h3>
            <PersonaForm
              initial={editPersona}
              onSave={handleSaveEdit}
              onCancel={() => setEditSlug(null)}
            />
          </div>
        ) : (
          <PersonaCard
            key={p.slug}
            persona={p}
            onEdit={() => handleEdit(p.slug)}
            onToggle={() => handleToggle(p)}
            onDelete={() => handleDelete(p.slug)}
          />
        )
      )}

      {persony.length === 0 && !creating && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-lg mb-2">Žádné persony</p>
          <p className="text-sm">Vytvořte první personu kliknutím na tlačítko výše.</p>
        </div>
      )}
    </div>
  );
}
