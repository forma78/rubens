import { notFound } from "next/navigation";
import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftSeq } from "@/lib/shift";
import { LiveView } from "./live-view";

export default async function ShiftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: brief } = await supabase
    .from("briefs")
    .select("id,slug,instruction,canvas_format,rounds,status,created_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!brief) notFound();

  const [{ data: variants }, { data: comparisons }] = await Promise.all([
    supabase
      .from("variants")
      .select("id,round,label,source,agent_id,render_url,rating,survived,created_at")
      .eq("brief_id", brief.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("comparisons")
      .select("id,round,judge_id,vendor,why,winner_id,left_id,right_id,created_at")
      .eq("brief_id", brief.id)
      .order("created_at", { ascending: true }),
  ]);

  return (
    <Chrome active="shift" crumb={`rubens-pearl / shift-${shiftSeq(slug)} / live`}>
      <LiveView brief={brief} initialVariants={variants ?? []} initialComparisons={comparisons ?? []} />
    </Chrome>
  );
}
