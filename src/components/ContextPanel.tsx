"use client";

import useSWR from "swr";
import { useState, useCallback } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── Typy ────────────────────────────────────────────────────────────────────

type SourceItem = { url: string; label?: string; mode?: string };
type Sources = { default_domains?: string[]; items?: SourceItem[] };
type PersonaMeta = { slug: string; jmeno: string; aktivni: boolean; use_case_count: number };
type PersonaDetail = { slug: string; jmeno: string; use_cases?: string };

type UseCase = { id: string; title: string };
type SelectedPersona = { slug: string; name: string; ucs: string[] };

type ContextPanelProps = {
  projekt: string;
  onApply: (block: string) => void;
};

// ── UC parser ────────────────────────────────────────────────────────────────

function parseUseCases(ucText: string): UseCase[] {
  const ucs: UseCase[] = [];
  const lines = ucText.split("\n");
  for (const line of lines) {
    const m = line.match(/^##\s+(UC-\w+)[:\s]+(.*)/);
    if (m) ucs.push({ id: m[1], title: m[2].trim() });
  }
  return ucs;
}

// ── Persona řádek s UC ───────────────────────────────────────────────────────

function PersonaRow({
  persona,
  checked,
  selected,
  onToggle,
  onToggleUC,
}: {
  persona: PersonaMeta;
  checked: boolean;
  selected: SelectedPersona | undefined;
  onToggle: () => void;
  onToggleUC: (uc: string) => void;
}) {
  const { data: detail } = useSWR<PersonaDetail>(
    checked ? `/api/personas/${persona.slug}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  const ucs = detail?.use_cases ? parseUseCases(detail.use_cases) : [];

  return (
    <div>
      <label className="flex items-center gap-2 py-1.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="w-3 h-3 accent-blue-500"
        />
        <span className={`text-sm truncate ${checked ? "text-gray-200" : "text-gray-400 group-hover:text-gray-300"}`}>
          {persona.jmeno}
        </span>
        {persona.use_case_count > 0 && (
          <span className="text-xs text-gray-600 flex-shrink-0">
            {persona.use_case_count} UC
          </span>
        )}
      </label>
      {checked && ucs.length > 0 && (
        <div className="ml-5 space-y-1 mb-1">
          {ucs.map((uc) => (
            <label key={uc.id} className="flex items-start gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={selected?.ucs.includes(uc.id) ?? false}
                onChange={() => onToggleUC(uc.id)}
                className="w-3 h-3 mt-0.5 flex-shrink-0 accent-blue-400"
              />
              <span className="text-xs text-gray-500 group-hover:text-gray-400 leading-tight">
                <span className="font-mono text-gray-600">{uc.id}</span>{" "}
                {uc.title}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Hlavní komponenta ────────────────────────────────────────────────────────

export default function ContextPanel({ projekt, onApply }: ContextPanelProps) {
  const { data: sources } = useSWR<Sources>(`/api/projects/${projekt}/sources`, fetcher);
  const { data: allPersonas } = useSWR<PersonaMeta[]>("/api/personas", fetcher);

  // Zdroje
  const [sourceMode, setSourceMode] = useState<"GUIDED" | "REQUIRED">("GUIDED");
  const [checkedSources, setCheckedSources] = useState<Set<string>>(new Set());
  const [adHocInput, setAdHocInput] = useState("");
  const [adHocSources, setAdHocSources] = useState<SourceItem[]>([]);

  // Persony
  const [checkedPersonas, setCheckedPersonas] = useState<Set<string>>(new Set());
  const [selectedPersonas, setSelectedPersonas] = useState<Map<string, SelectedPersona>>(new Map());

  // Flash po Apply
  const [applied, setApplied] = useState(false);

  const projectSources: SourceItem[] = sources?.items ?? [];
  const activePersonas = (allPersonas ?? []).filter((p) => p.aktivni !== false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const toggleSource = useCallback((url: string) => {
    setCheckedSources((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  const addAdHoc = useCallback(() => {
    const v = adHocInput.trim();
    if (!v) return;
    setAdHocSources((prev) => [...prev, { url: v, label: v }]);
    // Auto-check new ad-hoc source
    setCheckedSources((prev) => new Set([...prev, v]));
    setAdHocInput("");
  }, [adHocInput]);

  const removeAdHoc = useCallback((url: string) => {
    setAdHocSources((prev) => prev.filter((s) => s.url !== url));
    setCheckedSources((prev) => {
      const next = new Set(prev);
      next.delete(url);
      return next;
    });
  }, []);

  const togglePersona = useCallback((persona: PersonaMeta) => {
    setCheckedPersonas((prev) => {
      const next = new Set(prev);
      if (next.has(persona.slug)) {
        next.delete(persona.slug);
        setSelectedPersonas((sp) => {
          const nsm = new Map(sp);
          nsm.delete(persona.slug);
          return nsm;
        });
      } else {
        next.add(persona.slug);
        setSelectedPersonas((sp) =>
          new Map(sp).set(persona.slug, { slug: persona.slug, name: persona.jmeno, ucs: [] })
        );
      }
      return next;
    });
  }, []);

  const toggleUC = useCallback((slug: string, ucId: string) => {
    setSelectedPersonas((prev) => {
      const nsm = new Map(prev);
      const p = nsm.get(slug);
      if (!p) return prev;
      const ucs = p.ucs.includes(ucId)
        ? p.ucs.filter((u) => u !== ucId)
        : [...p.ucs, ucId];
      nsm.set(slug, { ...p, ucs });
      return nsm;
    });
  }, []);

  // ── Sestavení [KONTEXT] bloku ────────────────────────────────────────────

  const buildBlock = useCallback((): string => {
    const lines: string[] = ["[KONTEXT]"];

    // Zdroje
    const allSources = [...projectSources, ...adHocSources].filter((s) =>
      checkedSources.has(s.url)
    );
    if (allSources.length > 0) {
      lines.push(`zdroje: ${sourceMode}`);
      for (const s of allSources) {
        const label = s.label && s.label !== s.url ? s.label : s.url;
        lines.push(`- ${label} (${s.url})`);
      }
    }

    // Persony
    const activeChecked = activePersonas.filter((p) => checkedPersonas.has(p.slug));
    if (activeChecked.length > 0) {
      lines.push("persony:");
      for (const p of activeChecked) {
        const sp = selectedPersonas.get(p.slug);
        if (sp && sp.ucs.length > 0) {
          lines.push(`- ${p.jmeno} (${sp.ucs.join(", ")})`);
        } else {
          lines.push(`- ${p.jmeno}`);
        }
      }
    }

    lines.push("[/KONTEXT]");
    return lines.join("\n");
  }, [projectSources, adHocSources, checkedSources, sourceMode, activePersonas, checkedPersonas, selectedPersonas]);

  const handleApply = useCallback(() => {
    const block = buildBlock();
    onApply(block);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  }, [buildBlock, onApply]);

  const hasSelection =
    [...checkedSources].some((url) =>
      [...projectSources, ...adHocSources].some((s) => s.url === url)
    ) || checkedPersonas.size > 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {/* Sekce 1 — Zdroje */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Zdroje</p>
            <button
              onClick={() => setSourceMode((m) => (m === "GUIDED" ? "REQUIRED" : "GUIDED"))}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                sourceMode === "REQUIRED"
                  ? "bg-orange-900 border-orange-700 text-orange-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-300"
              }`}
            >
              {sourceMode}
            </button>
          </div>

          {/* Projektové zdroje */}
          {projectSources.length > 0 && (
            <div className="space-y-0.5 mb-3">
              {projectSources.map((s) => (
                <label key={s.url} className="flex items-center gap-2 py-1.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={checkedSources.has(s.url)}
                    onChange={() => toggleSource(s.url)}
                    className="w-3 h-3 flex-shrink-0 accent-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${checkedSources.has(s.url) ? "text-gray-200" : "text-gray-400 group-hover:text-gray-300"}`}>
                      {s.label || s.url}
                    </p>
                    {s.label && s.label !== s.url && (
                      <p className="text-xs text-gray-700 truncate">{s.url}</p>
                    )}
                  </div>
                  {s.mode && (
                    <span className="text-xs bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">
                      {s.mode === "REQUIRED" ? "kb" : s.url.startsWith("http") ? "web" : "dataset"}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Ad-hoc zdroje */}
          {adHocSources.length > 0 && (
            <div className="space-y-0.5 mb-3 border-t border-gray-800 pt-2">
              <p className="text-xs text-gray-700 mb-1">Ad-hoc</p>
              {adHocSources.map((s) => (
                <div key={s.url} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 flex-1 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={checkedSources.has(s.url)}
                      onChange={() => toggleSource(s.url)}
                      className="w-3 h-3 flex-shrink-0 accent-blue-500"
                    />
                    <span className="text-sm text-gray-300 truncate">{s.url}</span>
                  </label>
                  <button
                    onClick={() => removeAdHoc(s.url)}
                    className="text-gray-700 hover:text-gray-400 text-xs flex-shrink-0 px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Přidat URL */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={adHocInput}
              onChange={(e) => setAdHocInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAdHoc()}
              placeholder="URL nebo doména..."
              className="flex-1 min-w-0 text-xs bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-500"
            />
            <button
              onClick={addAdHoc}
              disabled={!adHocInput.trim()}
              className="text-xs px-2 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-lg border border-gray-700 flex-shrink-0 transition-colors"
            >
              Přidat
            </button>
          </div>
        </section>

        {/* Sekce 2 — Persony */}
        <section>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Persony</p>
          {activePersonas.length === 0 && (
            <p className="text-xs text-gray-700">Žádné persony</p>
          )}
          <div className="space-y-0.5">
            {activePersonas.map((p) => (
              <PersonaRow
                key={p.slug}
                persona={p}
                checked={checkedPersonas.has(p.slug)}
                selected={selectedPersonas.get(p.slug)}
                onToggle={() => togglePersona(p)}
                onToggleUC={(uc) => toggleUC(p.slug, uc)}
              />
            ))}
          </div>
        </section>

        {/* Sekce 3 — Výchozí domény */}
        {sources?.default_domains && sources.default_domains.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Výchozí domény</p>
              <a
                href={`/dashboard/project/${projekt}/sources`}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Spravovat →
              </a>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sources.default_domains.map((d) => (
                <span
                  key={d}
                  className="text-xs bg-gray-900 border border-gray-800 text-gray-500 px-2 py-0.5 rounded-full"
                >
                  {d}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Tlačítko Použít v úkolu */}
      <div className="pt-3 border-t border-gray-800 flex-shrink-0 mt-3">
        <button
          onClick={handleApply}
          disabled={!hasSelection}
          className={`w-full py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
            applied
              ? "bg-green-700 text-green-100"
              : hasSelection
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-800 text-gray-600 cursor-not-allowed"
          }`}
        >
          {applied ? "✓ Vloženo" : "Použít v úkolu"}
        </button>
      </div>
    </div>
  );
}
