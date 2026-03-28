import { redirect } from "next/navigation";

export default async function ProjectPage({ params }: { params: Promise<{ projekt: string }> }) {
  const { projekt } = await params;
  redirect(`/dashboard/project/${projekt}/tasks`);
}
