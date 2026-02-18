import InviteAcceptanceCard from "@/components/org/InviteAcceptanceCard";

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const token = params?.token ?? "";

  return (
    <div className="min-h-screen px-6 py-10">
      <div className="max-w-xl mx-auto">
        <InviteAcceptanceCard token={token} />
      </div>
    </div>
  );
}
