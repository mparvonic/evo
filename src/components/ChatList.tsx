"use client";

import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import DeleteChatModal from "./DeleteChatModal";

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
  const [deletingChat, setDeletingChat] = useState<ChatMeta | null>(null);

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

  async function handleDeleteConfirm(filesToDelete: string[]) {
    if (!deletingChat) return;
    await fetch(`/api/chats/${deletingChat.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_outputs: filesToDelete }),
    });
    setDeletingChat(null);
    await mutate();
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
            <div key={chat.id} className="relative group/card">
              <Link
                href={`/dashboard/chats/${chat.id}`}
                className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition-colors group"
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
                  <div className="text-right text-xs text-gray-500 shrink-0 pr-7">
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
              {/* Tlačítko smazání — zobrazí se při hoveru */}
              <button
                onClick={(e) => { e.preventDefault(); setDeletingChat(chat); }}
                title="Smazat chat"
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-gray-800 opacity-0 group-hover/card:opacity-100 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {deletingChat && (
        <DeleteChatModal
          chatId={deletingChat.id}
          chatTitle={deletingChat.title}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingChat(null)}
        />
      )}
    </div>
  );
}
