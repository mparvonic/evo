"use client";

import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ChatMeta = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  output_count: number;
  last_message: string;
  personas: string[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("cs-CZ", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function ChatList() {
  const { data: chats, mutate } = useSWR<ChatMeta[]>("/api/chats", fetcher);
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleNewChat() {
    setCreating(true);
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Nový chat" }),
      });
      const chat = await res.json();
      await mutate();
      router.push(`/dashboard/chats/${chat.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-sm">
              ← Dashboard
            </Link>
          </div>
          <h1 className="text-2xl font-bold">Chaty</h1>
          <p className="text-gray-400 text-sm mt-1">Volné konverzace s EVO</p>
        </div>
        <button
          onClick={handleNewChat}
          disabled={creating}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {creating ? "Vytvářím..." : "+ Nový chat"}
        </button>
      </header>

      {!chats ? (
        <div className="text-gray-500 text-center py-16">Načítám...</div>
      ) : chats.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">Zatím žádné chaty.</p>
          <button
            onClick={handleNewChat}
            disabled={creating}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors"
          >
            Začni nový chat
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {chats.map((chat) => (
            <Link
              key={chat.id}
              href={`/dashboard/chats/${chat.id}`}
              className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold group-hover:text-blue-400 transition-colors truncate">
                    {chat.title}
                  </h2>
                  {chat.last_message && (
                    <p className="text-gray-500 text-sm mt-1 truncate">{chat.last_message}</p>
                  )}
                </div>
                <div className="text-right text-xs text-gray-500 shrink-0">
                  <p>{fmtDate(chat.updated_at)}</p>
                  <p className="mt-1">
                    {chat.message_count} zpráv
                    {chat.output_count > 0 && ` · ${chat.output_count} výstupů`}
                  </p>
                </div>
              </div>
              {chat.personas.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {chat.personas.map((p) => (
                    <span key={p} className="text-xs bg-purple-900 text-purple-300 px-2 py-0.5 rounded-full">
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
