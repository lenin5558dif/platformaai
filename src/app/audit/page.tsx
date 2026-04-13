import { redirect } from "next/navigation";

export default function AuditPageRedirect() {
  redirect("/admin/audit");
}
