import { PermissionGate } from "@/components/permission-gate";

export default async function NewTranslationKeyLayout({
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
      message="Your role cannot add translation keys. Ask the application owner if you need to."
    >
      {children}
    </PermissionGate>
  );
}
