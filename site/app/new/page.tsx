import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Chrome } from "@/components/chrome";
import { BriefForm } from "./brief-form";

// proxy.ts already redirects an unauthenticated request away from /new —
// this check is defence in depth (a server component can be reached in
// ways middleware doesn't always cover), not the only guard.
export default async function NewBriefPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <Chrome active="new" crumb="rubens-pearl / new">
      <div className="page-head">
        <h1 className="page-title">New brief</h1>
      </div>
      <BriefForm userId={user.id} />
    </Chrome>
  );
}
