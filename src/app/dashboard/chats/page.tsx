import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChatList from "@/components/ChatList";

export default async function ChatsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen p-6">
      <ChatList />
    </div>
  );
}
