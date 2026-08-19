import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BriefForm } from "./brief-form";

// middleware.ts already redirects an unauthenticated request away from
// /new — this check is defence in depth (a server component can be
// reached in ways middleware doesn't always cover), not the only guard.
export default async function NewBriefPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="wrap">
      <div className="masthead">
        <span className="word">
          Rubens<span className="accentword">Journal</span>
        </span>
      </div>
      <BriefForm userId={user.id} />
    </div>
  );
}
