"use client";

import { useParams } from "next/navigation";
import KnowledgeBase from "@/components/KnowledgeBase";

export default function KBPage() {
  const { projekt } = useParams<{ projekt: string }>();
  return <KnowledgeBase projekt={projekt} />;
}
