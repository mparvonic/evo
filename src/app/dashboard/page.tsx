import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ProjectList from "@/components/ProjectList";
import SystemStats from "@/components/SystemStats";
import ChatModelDefault from "@/components/ChatModelDefault";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-6">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">EVO Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              {new Date().toLocaleDateString("cs-CZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard/chats" className="text-gray-300 hover:text-white">Chaty</Link>
            <Link href="/dashboard/personas" className="text-gray-300 hover:text-white">Persony</Link>
            <Link href="/legai" className="text-blue-400 hover:text-blue-300">/legai</Link>
            <form action="/api/auth/signout" method="POST">
              <button className="text-gray-500 hover:text-gray-300">Odhlásit</button>
            </form>
          </nav>
        </header>

        <ProjectList />

        {/* Nastavení chatů */}
        <div className="mt-8 pt-6 border-t border-gray-800">
          <ChatModelDefault />
        </div>
      </div>

      <SystemStats />
    </div>
  );
}
