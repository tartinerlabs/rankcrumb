import { redirect } from "next/navigation";
import { Suspense } from "react";

// /apps/<id> opens the Board tab
export default function AppWorkspacePage({ params }: PageProps<"/apps/[id]">) {
  return (
    <Suspense fallback={null}>
      <ToBoard params={params} />
    </Suspense>
  );
}

async function ToBoard({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  redirect(`/apps/${id}/board`);
}
