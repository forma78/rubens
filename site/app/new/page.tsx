import { createClient } from "@/lib/supabase/server";
import { Chrome } from "@/components/chrome";
import { BriefForm } from "./brief-form";

// Open to guests. They see exactly what a shift is made of and cannot fire
// one: BriefForm locks Go! and the upload row without a user, and
// /api/shift re-checks the session server-side regardless of what the page
// allowed. Nothing here was ever kept safe by being hidden.
export default async function NewBriefPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Chrome active="new" crumb="rubens-pearl / new">
      <div className="page-head">
        <h1 className="page-title">New brief</h1>
      </div>
      <BriefForm userId={user?.id ?? null} />
    </Chrome>
  );
}
