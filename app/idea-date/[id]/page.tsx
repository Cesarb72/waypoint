import IdeaDateLensClient from '../IdeaDateLensClient';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function IdeaDateByIdPage({ params }: PageProps) {
  const resolved = await params;
  return <IdeaDateLensClient planId={resolved.id} />;
}
