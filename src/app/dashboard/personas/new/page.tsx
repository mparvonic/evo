import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import PersonaNewForm from "@/components/PersonaNewForm";

export default async function PersonaNewPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/personas" className="text-gray-500 hover:text-gray-300 text-sm">
            ← Persony
          </Link>
        </div>
        <h1 className="text-xl font-bold mb-6">Nová persona</h1>
        <PersonaNewForm />
      </div>
    </div>
  );
}
