"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Message = { role: "user" | "assistant"; content: string; ts?: string };

// WebSocket URL: v produkci /api/chat → WS na EVO-X2 přes Apache proxy
// Apache musí upgradovat WebSocket connection pro ws:// protokol
function getWsUrl() {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/chat`;
}

export default function Chat({ projekt }: { projekt: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamBuf = useRef("");

  const connect = useCallback(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3s
      setTimeout(connect, 3000);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "token") {
        streamBuf.current += msg.content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.content === "…") {
            return [...prev.slice(0, -1), { role: "assistant", content: streamBuf.current }];
          }
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, content: streamBuf.current }];
          }
          return prev;
        });
      } else if (msg.type === "done") {
        setStreaming(false);
        streamBuf.current = "";
      } else if (msg.type === "error") {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${msg.content}` }]);
        setStreaming(false);
        streamBuf.current = "";
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send() {
    if (!input.trim() || streaming || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    streamBuf.current = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "…" }]);
    setStreaming(true);
    wsRef.current.send(JSON.stringify({ projekt, zprava: text }));
  }

  return (
    <div className="flex flex-col h-[70vh] bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 text-xs text-gray-500">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        {connected ? "Připojeno k EVO-X2" : "Připojování..."}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-gray-600 text-sm text-center mt-8">
            Zeptejte se na cokoliv o projektu <strong>{projekt}</strong>
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-blue-700 text-white"
                  : "bg-gray-800 text-gray-200"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-gray-800 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Napište zprávu..."
          disabled={!connected || streaming}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!connected || streaming || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
        >
          {streaming ? "…" : "Odeslat"}
        </button>
      </div>
    </div>
  );
}
