"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Message = { role: "user" | "assistant"; content: string };

function getWsUrl() {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/chat`;
}

type ChatProps = {
  projekt: string;
  inputValue?: string;
  onInputChange?: (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
};

export default function Chat({ projekt, inputValue, onInputChange, inputRef }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [internalInput, setInternalInput] = useState("");
  const input = inputValue !== undefined ? inputValue : internalInput;
  const setInput = onInputChange ?? setInternalInput;
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
      setTimeout(connect, 3000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "token") {
        streamBuf.current += msg.content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { role: "assistant", content: streamBuf.current }];
          }
          return [...prev, { role: "assistant", content: streamBuf.current }];
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
    if (!input.trim() || streaming || wsRef.current?.readyState !== WebSocket.OPEN) return;
    const text = input.trim();
    setInput("");
    streamBuf.current = "";
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setStreaming(true);
    wsRef.current!.send(JSON.stringify({ projekt, zprava: text }));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Status */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-800 text-xs text-gray-600">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        {connected ? "připojeno" : "připojování..."}
      </div>

      {/* Zprávy */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-gray-700 text-xs text-center mt-6">
            Zeptejte se na cokoliv o projektu <strong className="text-gray-500">{projekt}</strong>
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-200"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-gray-800 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Napište zprávu..."
          disabled={!connected || streaming}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!connected || streaming || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}
