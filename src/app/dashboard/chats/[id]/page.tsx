import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChatDetail from "@/components/ChatDetail";

export default async function ChatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  return (
    <div className="h-screen overflow-hidden">
      <ChatDetail chatId={id} />
    </div>
  );
}
