import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import PersonaCatalog from "@/components/PersonaCatalog";

export default async function PersonasPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-6">
        <header className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/dashboard" className="text-gray-500 hover:text-gray-300 text-sm">
                ← Dashboard
              </Link>
            </div>
            <h1 className="text-2xl font-bold">Persony</h1>
            <p className="text-gray-400 text-sm mt-1">
              Review vrstva pro plánování a hodnocení tasků
            </p>
          </div>
        </header>

        <PersonaCatalog />
      </div>
    </div>
  );
}
