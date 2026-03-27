"use client";

import { useState, useEffect } from "react";
import { CHAT_MODELS, getDefaultModel, setDefaultModel, FALLBACK_MODEL } from "@/lib/models";
import ModelPickerModal from "./ModelPickerModal";

export default function ChatModelDefault() {
  const [defaultModel, setDefault] = useState(FALLBACK_MODEL);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setDefault(getDefaultModel());
  }, []);

  function handleSetDefault(modelId: string) {
    setDefaultModel(modelId);
    setDefault(modelId);
    setShowPicker(false);
  }

  const info = CHAT_MODELS.find((m) => m.id === defaultModel);

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-400">Výchozí model pro nové chaty:</span>
      <button
        onClick={() => setShowPicker(true)}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 text-gray-200 text-sm px-3 py-1.5 rounded-lg transition-colors"
      >
        <span className="font-medium">{info?.label ?? defaultModel}</span>
        <span className="text-gray-500 text-xs">({info?.providerLabel ?? ""})</span>
        <span className="text-gray-500 text-xs">⊞</span>
      </button>

      {showPicker && (
        <ModelPickerModal
          current={defaultModel}
          onSelect={() => {}}
          onClose={() => setShowPicker(false)}
          showSetDefault
          onSetDefault={handleSetDefault}
          defaultModelId={defaultModel}
        />
      )}
    </div>
  );
}
