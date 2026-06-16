import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopbar } from "@/components/admin/AdminTopbar";

export const dynamic = "force-dynamic";

async function getNavCounts() {
  const supabase = createClient();
  const [props, demands, loanApps] = await Promise.all([
    supabase.from("properties").select("*", { count: "exact", head: true }).eq("status", "on_sale"),
    supabase.from("buyer_demands").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("loan_applications").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);
  return {
    propCount: props.count ?? 0,
    demandCount: demands.count ?? 0,
    loanAppCount: loanApps.count ?? 0,
  };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { propCount, demandCount, loanAppCount } = await getNavCounts();

  return (
    <div className="yfp-admin flex min-h-screen">
      <AdminSidebar propCount={propCount} demandCount={demandCount} loanAppCount={loanAppCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 p-7">{children}</main>
      </div>
    </div>
  );
}
