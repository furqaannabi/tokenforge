import { notFound } from "next/navigation";
import { SEED_NOTES } from "@/lib/mock-data";
import { ReviewScreen } from "./review-screen";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!SEED_NOTES.some((note) => note.id === id)) notFound();
  return <ReviewScreen noteId={id} />;
}
