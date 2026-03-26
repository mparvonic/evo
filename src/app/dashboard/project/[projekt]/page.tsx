import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ProjectDetail from "@/components/ProjectDetail";

export default async function ProjectPage({ params }: { params: Promise<{ projekt: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");

  const { projekt } = await params;
  return (
    <div className="h-screen overflow-hidden">
      <ProjectDetail projekt={projekt} />
    </div>
  );
}
