import { notFound } from "next/navigation";
import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftSeq } from "@/lib/shift";
import { fetchAllRows } from "@/lib/rows";
import { LiveView, type Variant, type Comparison } from "./live-view";

export default async function ShiftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: brief } = await supabase
    .from("briefs")
    .select("id,slug,instruction,canvas_format,generator,rounds,status,created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!brief) notFound();

  // Paged, not a plain select — see lib/rows.ts. This shift's comparisons
  // run to thousands and the ranking Live draws is only as real as the
  // rows it is counted from.
  const [variants, comparisons] = await Promise.all([
    fetchAllRows<Variant>((from, to) =>
      supabase
        .from("variants")
        .select("id,round,label,source,agent_id,render_url,rating,survived,created_at")
        .eq("brief_id", brief.id)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<Comparison>((from, to) =>
      supabase
        .from("comparisons")
        .select("id,round,judge_id,vendor,why,winner_id,left_id,right_id,created_at")
        .eq("brief_id", brief.id)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
  ]);

  return (
    <Chrome active="shift" crumb={`rubens-pearl / shift-${shiftSeq(slug)} / live`}>
      <LiveView brief={brief} initialVariants={variants} initialComparisons={comparisons} />
    </Chrome>
  );
}
