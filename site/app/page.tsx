import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// C1 (the public feed) isn't built in this pass — the only visitor this
// site knows about right now is the owner, so the root just routes to
// wherever they actually go next.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/new" : "/login");
}
