"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MODEL_LABELS: Record<string, string> = {
  "evo-fast":         "evo-fast (qwen2.5:14b)",
  "evo-chat":         "evo-chat (qwen2.5:72b)",
  "evo-planner":      "evo-planner (deepseek-r1:32b)",
  "claude-haiku":     "Claude Haiku",
  "claude-sonnet":    "Claude Sonnet",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
};

export default function PersonaNewForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    slug: "",
    jmeno: "",
    role: "",
    model: "evo-fast",
    system_prompt: "",
    aktivni: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Auto-generovat slug z jména
  function handleJmenoChange(val: string) {
    set("jmeno", val);
    if (!form.slug || form.slug === slugify(form.jmeno)) {
      set("slug", slugify(val));
    }
  }

  function slugify(s: string) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const resp = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
      }
      router.push(`/dashboard/personas/${form.slug}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Jméno</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            value={form.jmeno}
            onChange={(e) => handleJmenoChange(e.target.value)}
            placeholder="Např. Produktový manažer"
            required
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Slug (ID)</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-600"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            placeholder="produktovy-manazer"
            pattern="[a-z0-9\-]+"
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
          placeholder="Krátký popis role v review procesu"
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
        <label htmlFor="aktivni" className="text-sm text-gray-300">
          Aktivní od začátku
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-400">Chyba: {error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium"
        >
          {saving ? "Vytvářím..." : "Vytvořit personu"}
        </button>
      </div>
    </form>
  );
}
