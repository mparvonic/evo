import TaskTrace from "@/components/TaskTrace";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ projekt: string; id: string }>;
}) {
  const { projekt, id } = await params;
  return <TaskTrace projekt={projekt} taskId={id} />;
}
