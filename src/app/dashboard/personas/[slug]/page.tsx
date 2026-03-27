import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import PersonaDetail from "@/components/PersonaDetail";

export default async function PersonaDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const { slug } = await params;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard/personas" className="text-gray-500 hover:text-gray-300 text-sm">
            ← Persony
          </Link>
        </div>
        <PersonaDetail slug={slug} />
      </div>
    </div>
  );
}
