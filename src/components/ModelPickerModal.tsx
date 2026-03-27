"use client";

import { CHAT_MODELS, ModelInfo } from "@/lib/models";

type Props = {
  current: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  /** Pokud je true, zobrazí se sekce "Nastavit jako výchozí" */
  showSetDefault?: boolean;
  onSetDefault?: (modelId: string) => void;
  defaultModelId?: string;
};

function Dots({ value, color }: { value: number; color: string }) {
  return (
    <span className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${i <= value ? color : "bg-gray-700"}`}
        />
      ))}
    </span>
  );
}

const PROVIDER_ORDER = ["local", "anthropic", "google"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  local: "Lokální (Ollama)",
  anthropic: "Anthropic",
  google: "Google",
};

export default function ModelPickerModal({
  current,
  onSelect,
  onClose,
  showSetDefault,
  onSetDefault,
  defaultModelId,
}: Props) {
  const grouped = PROVIDER_ORDER.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    models: CHAT_MODELS.filter((m) => m.provider === provider),
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold">Výběr modelu</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Legenda */}
        <div className="flex gap-6 px-6 py-3 border-b border-gray-800 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="flex gap-0.5">{[1,2,3,4,5].map(i=><span key={i} className="w-2 h-2 rounded-full bg-blue-500"/>)}</span> = nejlepší</span>
          <span className="flex items-center gap-2">
            <Dots value={3} color="bg-yellow-500" /> Rychlost
          </span>
          <span className="flex items-center gap-2">
            <Dots value={3} color="bg-blue-500" /> Kvalita
          </span>
          <span className="flex items-center gap-2">
            <Dots value={3} color="bg-green-500" /> Čeština
          </span>
        </div>

        {/* Tabulka po skupinách */}
        <div className="divide-y divide-gray-800">
          {grouped.map(({ provider, label, models }) => (
            <div key={provider}>
              <div className="px-6 py-2 bg-gray-800/50">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {label}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-600 border-b border-gray-800">
                    <th className="text-left pl-6 pr-3 py-2 font-normal">Model</th>
                    <th className="text-left px-3 py-2 font-normal hidden sm:table-cell">Kontext</th>
                    <th className="text-left px-3 py-2 font-normal hidden md:table-cell">Input /1M</th>
                    <th className="text-left px-3 py-2 font-normal hidden md:table-cell">Output /1M</th>
                    <th className="text-left px-3 py-2 font-normal hidden lg:table-cell">Kdy použít</th>
                    <th className="text-center px-3 py-2 font-normal">Rychlost</th>
                    <th className="text-center px-3 py-2 font-normal">Kvalita</th>
                    <th className="text-center px-3 py-2 font-normal">Čeština</th>
                    <th className="pr-6 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => {
                    const isActive = m.id === current;
                    const isDefault = m.id === defaultModelId;
                    return (
                      <tr
                        key={m.id}
                        onClick={() => { onSelect(m.id); onClose(); }}
                        className={`cursor-pointer transition-colors border-b border-gray-800/50 last:border-0 ${
                          isActive
                            ? "bg-blue-950/60 hover:bg-blue-950"
                            : "hover:bg-gray-800/60"
                        }`}
                      >
                        <td className="pl-6 pr-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${isActive ? "text-blue-300" : "text-gray-200"}`}>
                              {m.label}
                            </span>
                            {m.note && (
                              <span className="text-xs text-orange-400 bg-orange-950 px-1.5 py-0.5 rounded">
                                {m.note}
                              </span>
                            )}
                            {isDefault && (
                              <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                                výchozí
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-gray-400 hidden sm:table-cell">{m.context}</td>
                        <td className="px-3 py-3 text-gray-400 hidden md:table-cell">{m.inputPrice}</td>
                        <td className="px-3 py-3 text-gray-400 hidden md:table-cell">{m.outputPrice}</td>
                        <td className="px-3 py-3 text-gray-500 text-xs hidden lg:table-cell max-w-xs">{m.useCase}</td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex justify-center">
                            <Dots value={m.speed} color="bg-yellow-500" />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex justify-center">
                            <Dots value={m.quality} color="bg-blue-500" />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex justify-center">
                            <Dots value={m.czech} color="bg-green-500" />
                          </div>
                        </td>
                        <td className="pr-6 py-3 text-right">
                          {showSetDefault && onSetDefault && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSetDefault(m.id);
                              }}
                              title="Nastavit jako výchozí pro nové chaty"
                              className={`text-xs px-2 py-1 rounded transition-colors ${
                                isDefault
                                  ? "text-gray-500 cursor-default"
                                  : "text-gray-600 hover:text-gray-300 hover:bg-gray-700"
                              }`}
                            >
                              {isDefault ? "★ výchozí" : "☆ výchozí"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-600">
          Kliknutím na řádek přepneš model pro aktuální chat.
          {showSetDefault && " Hvězdičkou nastavíš výchozí model pro nové chaty."}
        </div>
      </div>
    </div>
  );
}
