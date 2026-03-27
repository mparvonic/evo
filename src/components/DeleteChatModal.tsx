"use client";

import { useState, useEffect } from "react";

type Output = {
  filename: string;
  size: number;
};

type Props = {
  chatId: string;
  chatTitle: string;
  onConfirm: (filesToDelete: string[]) => Promise<void>;
  onCancel: () => void;
};

export default function DeleteChatModal({ chatId, chatTitle, onConfirm, onCancel }: Props) {
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/chats/${chatId}/outputs`)
      .then((r) => r.json())
      .then((data: Output[]) => {
        setOutputs(data);
        // Výchozí: všechny soubory zaškrtnuté
        setChecked(new Set(data.map((f) => f.filename)));
      })
      .catch(() => setOutputs([]));
  }, [chatId]);

  function toggle(filename: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  async function handleConfirm() {
    setDeleting(true);
    try {
      await onConfirm(Array.from(checked));
    } finally {
      setDeleting(false);
    }
  }

  const hasOutputs = outputs && outputs.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-1">Smazat chat</h2>
          <p className="text-gray-400 text-sm mb-5">
            <span className="text-white font-medium">{chatTitle}</span>
            {" "}— konverzace bude trvale odstraněna.
          </p>

          {outputs === null ? (
            <p className="text-gray-500 text-sm py-2">Načítám výstupy…</p>
          ) : hasOutputs ? (
            <div>
              <p className="text-sm text-gray-300 mb-3">
                Chat obsahuje {outputs.length} {outputs.length === 1 ? "výstupní soubor" : outputs.length < 5 ? "výstupní soubory" : "výstupních souborů"}.
                Vyber, které chceš smazat:
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {outputs.map((f) => (
                  <label
                    key={f.filename}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(f.filename)}
                      onChange={() => toggle(f.filename)}
                      className="w-4 h-4 accent-blue-500"
                    />
                    <span className="text-sm font-mono text-blue-300 flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-gray-500 shrink-0">{(f.size / 1024).toFixed(1)} kB</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setChecked(new Set(outputs.map((f) => f.filename)))}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Vybrat vše
                </button>
                <span className="text-gray-700">·</span>
                <button
                  onClick={() => setChecked(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Zrušit výběr
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            Zrušit
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting || outputs === null}
            className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {deleting ? "Mažu…" : "Smazat chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
