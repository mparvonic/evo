"use client";

import { useState } from "react";
import Chat from "@/components/Chat";

// Veřejná stránka — bez autentizace
// Zobrazuje prototype: vyhledávání zákonů + inline chat
export default function LegaiPage() {
  const [view, setView] = useState<"search" | "chat">("search");

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">LegAI</h1>
        <p className="text-gray-400 mt-1 text-sm">
          AI asistent pro legislativu · prototype
        </p>
      </header>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setView("search")}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            view === "search" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Procházet zákony
        </button>
        <button
          onClick={() => setView("chat")}
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            view === "chat" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Chat s AI
        </button>
      </div>

      {view === "search" ? (
        <LawSearch />
      ) : (
        <Chat projekt="legai" />
      )}
    </div>
  );
}

function LawSearch() {
  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500">
        <p className="text-sm">Vyhledávání v e-Sbírce</p>
        <p className="text-xs mt-2 text-gray-700">
          Tato sekce bude implementována po zpracování dat discovery pipeline.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {["Sbírka zákonů", "Konsolidovaná znění", "Novelizace"].map((label) => (
          <div
            key={label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center"
          >
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-gray-600 mt-1">45 souborů · 2.2 GB</p>
          </div>
        ))}
      </div>
    </div>
  );
}
