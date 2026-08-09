import { ReviewScreen } from "./review-screen";

/**
 * An id here is either a local sample or an extraction from the service.
 *
 * Deliberately no `notFound()` guard: the samples live in client state and the
 * extractions live in a service this component cannot reach, so nothing on the
 * server can tell a bad id from a good one. The screen resolves it and shows
 * the reason when it cannot.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReviewScreen noteId={id} />;
}
