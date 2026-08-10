import { NoteScreen } from "./note-screen";

/**
 * An id here is an extraction the service produced. Nothing on the server can
 * tell a good one from a bad one, so the screen resolves it and says what it
 * could not find.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NoteScreen noteId={id} />;
}
