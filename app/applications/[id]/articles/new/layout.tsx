import { PermissionGate } from "@/components/permission-gate";

export default async function NewArticleLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  return (
    <PermissionGate
      applicationId={id}
      permission="content.edit"
      message="Your role cannot create articles. Ask the application owner if you need to."
    >
      {children}
    </PermissionGate>
  );
}
