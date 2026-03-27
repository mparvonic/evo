"use client";

import useSWR from "swr";
import Link from "next/link";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import DeleteChatModal from "./DeleteChatModal";
import ModelPickerModal from "./ModelPickerModal";
import { getDefaultModel, getModelInfo } from "@/lib/models";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  model?: string;
};

type ChatMeta = {
  id: string;
  title: string;
  message_count: number;
  output_count: number;
  personas: string[];
  messages: Message[];
};

type Output = {
  filename: string;
  size: number;
  modified: string;
  path: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}


// ── Záložka: Konverzace ────────────────────────────────────────────────────────

function ConversationTab({ chatId, meta, onSaved, model }: {
  chatId: string;
  meta: ChatMeta;
  onSaved: () => void;
  model: string;
}) {
  const [messages, setMessages] = useState<Message[]>(meta.messages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      ts: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamBuffer("");

    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, model }),
      });

      if (!res.body) throw new Error("Žádný stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "token") {
              fullContent += evt.content;
              setStreamBuffer(fullContent);
            } else if (evt.type === "done") {
              setMessages((prev) => [...prev, evt.message as Message]);
              setStreamBuffer("");
            } else if (evt.type === "error") {
              throw new Error(evt.content);
            }
          } catch {
            // ignoruj parse chyby
          }
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: "err", role: "assistant", content: `❌ Chyba: ${e}`, ts: new Date().toISOString() },
      ]);
      setStreamBuffer("");
    } finally {
      setStreaming(false);
    }
  }, [chatId, input, streaming, model]);

  async function handleSaveOutput(content: string, msgId: string) {
    setSaving(msgId);
    const filename = `odpoved_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`;
    try {
      await fetch(`/api/chats/${chatId}/outputs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content }),
      });
      onSaved();
    } finally {
      setSaving(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const assistantMessages = messages.filter((m) => m.role === "assistant");

  return (
    <div className="flex flex-col h-full">
      {/* Zprávy */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center text-gray-600 py-16 text-sm">
            Napiš první zprávu…
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            {/* Avatar */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
              msg.role === "user" ? "bg-blue-700 text-blue-100" : "bg-gray-700 text-gray-300"
            }`}>
              {msg.role === "user" ? "M" : "E"}
            </div>

            {/* Bublina */}
            <div className={`max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-700 text-blue-50 rounded-tr-sm"
                  : "bg-gray-800 text-gray-100 rounded-tl-sm"
              }`}>
                {msg.content}
              </div>
              <div className={`flex items-center gap-2 px-1 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <span className="text-xs text-gray-600">{fmtTime(msg.ts)}</span>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => handleSaveOutput(msg.content, msg.id)}
                    disabled={saving === msg.id}
                    title="Uložit do workspace"
                    className="text-xs text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40"
                  >
                    {saving === msg.id ? "ukládám…" : "💾"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming buffer */}
        {streamBuffer && (
          <div className="flex gap-3 flex-row">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 bg-gray-700 text-gray-300">
              E
            </div>
            <div className="max-w-[75%]">
              <div className="bg-gray-800 text-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                {streamBuffer}
                <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-0.5 animate-pulse rounded-sm" />
              </div>
            </div>
          </div>
        )}

        {/* Načítací indikátor před prvním tokenem */}
        {streaming && !streamBuffer && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gray-700 text-gray-300 flex items-center justify-center text-xs font-bold shrink-0">
              E
            </div>
            <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napiš zprávu… (Enter = odeslat, Shift+Enter = nový řádek)"
            disabled={streaming}
            rows={1}
            className="flex-1 bg-gray-800 border border-gray-700 focus:border-gray-500 rounded-xl px-4 py-3 text-sm resize-none outline-none transition-colors disabled:opacity-50 max-h-40 overflow-y-auto"
            style={{ minHeight: "48px" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors shrink-0"
          >
            Odeslat
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Záložka: Výstupy ────────────────────────────────────────────────────────────

function OutputsTab({ chatId }: { chatId: string }) {
  const { data: outputs } = useSWR<Output[]>(`/api/chats/${chatId}/outputs`, fetcher, {
    refreshInterval: 5000,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFile, setLoadingFile] = useState(false);

  async function loadFile(path: string, filename: string) {
    if (selected === filename) {
      setSelected(null);
      return;
    }
    setLoadingFile(true);
    setSelected(filename);
    try {
      // Čteme přes endpoint — path je relativní od /data/chats
      const res = await fetch(`/api/chats/${chatId}/outputs/${encodeURIComponent(filename)}`);
      if (res.ok) {
        setContent(await res.text());
      } else {
        setContent("(soubor nelze načíst)");
      }
    } finally {
      setLoadingFile(false);
    }
  }

  if (!outputs) return <div className="p-4 text-gray-500 text-sm">Načítám...</div>;

  if (outputs.length === 0) {
    return (
      <div className="p-8 text-center text-gray-600 text-sm">
        Žádné výstupy. Klikni na 💾 u odpovědi EVO.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      {outputs.map((f) => (
        <div key={f.filename}>
          <button
            onClick={() => loadFile(f.path, f.filename)}
            className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${
              selected === f.filename
                ? "border-blue-600 bg-blue-950"
                : "border-gray-800 bg-gray-900 hover:border-gray-600"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono text-blue-300">{f.filename}</span>
              <div className="text-xs text-gray-500">
                {(f.size / 1024).toFixed(1)} kB ·{" "}
                {new Date(f.modified).toLocaleString("cs-CZ", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            </div>
          </button>
          {selected === f.filename && (
            <div className="mt-1 bg-gray-900 border border-gray-800 rounded-lg p-4">
              {loadingFile ? (
                <p className="text-gray-500 text-sm">Načítám...</p>
              ) : (
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {content}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Záložka: Tasky (stub) ───────────────────────────────────────────────────────

function TasksTab() {
  return (
    <div className="p-8 text-center text-gray-600 text-sm">
      LangFuse trace viewer pro chaty — připravujeme.
    </div>
  );
}

// ── Hlavní komponenta ──────────────────────────────────────────────────────────

export default function ChatDetail({ chatId }: { chatId: string }) {
  const { data: meta, mutate } = useSWR<ChatMeta>(`/api/chats/${chatId}`, fetcher);
  const [tab, setTab] = useState<"konverzace" | "vystupy" | "tasky">("konverzace");
  const [selectedModel, setSelectedModel] = useState("evo-executor");
  const [showDelete, setShowDelete] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const router = useRouter();

  // Načti výchozí model z localStorage při prvním renderu
  useEffect(() => {
    setSelectedModel(getDefaultModel());
  }, []);

  if (!meta) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Načítám chat…
      </div>
    );
  }

  async function handleDeleteConfirm(filesToDelete: string[]) {
    await fetch(`/api/chats/${chatId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_outputs: filesToDelete }),
    });
    router.push("/dashboard/chats");
  }

  const tabs = [
    { id: "konverzace", label: "Konverzace" },
    { id: "vystupy", label: `Výstupy${meta.output_count > 0 ? ` (${meta.output_count})` : ""}` },
    { id: "tasky", label: "Tasky" },
  ] as const;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 shrink-0">
        <Link href="/dashboard/chats" className="text-gray-500 hover:text-gray-300 text-sm shrink-0">
          ← Chaty
        </Link>
        <h1 className="font-semibold truncate flex-1">{meta.title}</h1>
        {meta.personas.length > 0 && (
          <div className="flex gap-1">
            {meta.personas.map((p) => (
              <span key={p} className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">
                {p}
              </span>
            ))}
          </div>
        )}
        {/* Model selector */}
        <div className="flex items-center gap-1 shrink-0">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-l-lg rounded-r-none px-2 py-1.5 outline-none hover:border-gray-500 transition-colors"
          >
            {[selectedModel, ...(getModelInfo(selectedModel) ? [] : [])].filter(Boolean).map(() => null)}
            {/* Všechny modely jako options */}
            <option value="evo-executor">qwen2.5:72b — lokální</option>
            <option value="evo-chat">llama3.3:70b — lokální</option>
            <option value="evo-planner">deepseek-r1:32b — lokální</option>
            <option value="claude-haiku">Claude Haiku — cloud</option>
            <option value="claude-sonnet">Claude Sonnet — cloud</option>
            <option value="claude-opus">Claude Opus — cloud</option>
            <option value="gpt-4o-mini">GPT-4o mini — cloud</option>
            <option value="gpt-4o">GPT-4o — cloud</option>
            <option value="gpt-5">GPT-5 — cloud</option>
            <option value="o3-mini">o3-mini — reasoning</option>
            <option value="o4-mini">o4-mini — reasoning</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash — cloud</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro — cloud</option>
          </select>
          <button
            onClick={() => setShowPicker(true)}
            title="Přehled modelů"
            className="bg-gray-800 border border-gray-700 border-l-0 hover:border-gray-500 text-gray-400 hover:text-gray-200 text-xs rounded-r-lg px-2 py-1.5 transition-colors"
          >
            ⊞
          </button>
        </div>
        {/* Smazat chat */}
        <button
          onClick={() => setShowDelete(true)}
          title="Smazat chat"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Záložky */}
      <div className="flex gap-0 border-b border-gray-800 shrink-0 px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Obsah záložky */}
      <div className="flex-1 overflow-hidden">
        {tab === "konverzace" && (
          <ConversationTab chatId={chatId} meta={meta} onSaved={() => mutate()} model={selectedModel} />
        )}
        {tab === "vystupy" && (
          <div className="h-full overflow-y-auto">
            <OutputsTab chatId={chatId} />
          </div>
        )}
        {tab === "tasky" && <TasksTab />}
      </div>

      {showDelete && (
        <DeleteChatModal
          chatId={chatId}
          chatTitle={meta.title}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {showPicker && (
        <ModelPickerModal
          current={selectedModel}
          onSelect={setSelectedModel}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
