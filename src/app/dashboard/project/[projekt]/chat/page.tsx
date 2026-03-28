"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import Chat from "@/components/Chat";
import ContextPanel from "@/components/ContextPanel";

const PANEL_KEY = "evo-context-panel-open";

export default function ChatPage() {
  const { projekt } = useParams<{ projekt: string }>();
  const storageKey = `${PANEL_KEY}-${projekt}`;

  // Panel visible state — persisted to localStorage per projekt
  const [panelOpen, setPanelOpen] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) setPanelOpen(stored === "true");
    setMounted(true);
  }, [storageKey]);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      const next = !prev;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  // Sdílený input state (lifted from Chat)
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Callback z ContextPanel — vloží [KONTEXT] blok na začátek inputu
  const handleContextApply = useCallback((block: string) => {
    setInputValue((prev) => {
      const clean = prev.trimStart();
      return block + (clean ? "\n" + clean : "");
    });
    // Fokus na input po vložení
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Prevent hydration mismatch — don't render panel state before reading localStorage
  if (!mounted) return null;

  return (
    <div
      className="flex gap-4"
      style={{ height: "calc(100vh - 160px)" }}
    >
      {/* Levá část — chat okno */}
      <div className="flex-1 min-w-0 relative">
        <Chat
          projekt={projekt}
          inputValue={inputValue}
          onInputChange={setInputValue}
          inputRef={inputRef}
        />
        {/* Tlačítko toggle panelu */}
        <button
          onClick={togglePanel}
          title={panelOpen ? "Skrýt kontext" : "Zobrazit kontext"}
          className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-gray-200 text-xs transition-colors"
        >
          {panelOpen ? "→" : "←"}
        </button>
      </div>

      {/* Pravá část — kontextový panel */}
      {panelOpen && (
        <div className="w-72 flex-shrink-0 bg-gray-900 border border-gray-800 rounded-xl px-4 py-4 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <p className="text-xs text-gray-400 font-medium">Kontext úkolu</p>
          </div>
          <ContextPanel projekt={projekt} onApply={handleContextApply} />
        </div>
      )}
    </div>
  );
}
