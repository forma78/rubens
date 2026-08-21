"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The 5 real CANVAS_PROFILES keys (src/syndicate/canvas.js) — the picker
// only ever shows what the runner actually knows how to render.
const CANVAS_FORMATS = ["60x80", "70x100", "90x120", "100x100", "120x90"] as const;
type CanvasFormat = (typeof CANVAS_FORMATS)[number];

// config/syndicate.json's real defaults, mirrored the same way
// lib/roles.ts mirrors config/roles.json — Vercel's Root Directory is
// `site`, so nothing outside it is guaranteed to exist in the build.
const ESTIMATE = { rounds: 5, proposalsPerRound: 32, studies: 4, judges: 4 };

type Slot =
  | { status: "empty" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; url: string; previewUrl: string; path: string }
  | { status: "error"; message: string };

const emptySlots: Slot[] = [{ status: "empty" }, { status: "empty" }, { status: "empty" }, { status: "empty" }];

export function BriefForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [canvasFormat, setCanvasFormat] = useState<CanvasFormat | null>(null);
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);

  const hasReference = slots.some((s) => s.status === "done");
  const canSubmit = canvasFormat !== null && hasReference && instruction.trim().length > 0 && !submitting;

  async function handleFileChosen(index: number, file: File) {
    const previewUrl = URL.createObjectURL(file);
    setSlots((prev) => prev.map((s, i) => (i === index ? { status: "uploading", previewUrl } : s)));

    const supabase = createClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${userId}/${crypto.randomUUID()}-L${index}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("references").upload(path, file);
    if (uploadError) {
      setSlots((prev) => prev.map((s, i) => (i === index ? { status: "error", message: uploadError.message } : s)));
      return;
    }

    const { data } = supabase.storage.from("references").getPublicUrl(path);
    setSlots((prev) => prev.map((s, i) => (i === index ? { status: "done", url: data.publicUrl, previewUrl, path } : s)));
  }

  // "Remove" has to actually remove the upload, not just clear the form
  // field — otherwise every reconsidered choice leaves an orphaned object
  // in the references bucket forever. Best-effort: if the delete call
  // fails, the slot still clears (an unused object floating in storage
  // beats a form the owner can't move past).
  async function removeSlot(index: number) {
    const slot = slots[index];
    if (slot.status === "done") {
      URL.revokeObjectURL(slot.previewUrl);
      const supabase = createClient();
      await supabase.storage.from("references").remove([slot.path]);
    }
    setSlots((prev) => prev.map((s, i) => (i === index ? { status: "empty" } : s)));
  }

  async function handleGo() {
    // "Confirms before it fires" (the note under the button) has to be
    // real, not just copy — this is a real paid shift, not a preview.
    const confirmed = window.confirm(
      `Launch a real shift on ${canvasFormat}? This calls Anthropic, xAI and OpenAI for real and spends real money. It goes live on the public Archive immediately.`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const referenceUrls = slots.map((s) => (s.status === "done" ? s.url : null));

    // No `slug` here — schema.sql's next_shift_slug() default assigns the
    // real YYYYMMDD+NN URL atomically on the DB side, not a client-side
    // Date.now() guess. published defaults true the same way: this brief
    // is public the second the row exists.
    const { data: brief, error: insertError } = await supabase
      .from("briefs")
      .insert({
        instruction: instruction.trim(),
        canvas_format: canvasFormat,
        reference_urls: referenceUrls,
        status: "pending",
      })
      .select("id,slug")
      .single();

    if (insertError || !brief) {
      setError(insertError?.message ?? "could not create the brief");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/shift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefId: brief.id }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `could not launch the shift (${res.status})`);
      setSubmitting(false);
      return;
    }

    router.push(`/shift/${brief.slug}`);
  }

  return (
    <div className="layout-with-sidebar">
      <div className="panel">
        <div className="panel-head">
          <span>Compose a shift</span>
          <span className="mono" style={{ fontWeight: 400, color: "var(--muted)" }}>
            draft · v1
          </span>
        </div>
        <div className="panel-body">
          <div className="section-label">Canvas size</div>
          <div className="formats" role="radiogroup" aria-label="Canvas format" style={{ marginBottom: 26 }}>
            {CANVAS_FORMATS.map((fmt) => (
              <button
                key={fmt}
                type="button"
                className="fmt"
                role="radio"
                aria-checked={canvasFormat === fmt}
                onClick={() => setCanvasFormat(fmt)}
              >
                {fmt}
              </button>
            ))}
          </div>

          <div className="section-label">Colour — four hand-painted studies</div>
          <div className="studies" style={{ marginBottom: 8 }}>
            {slots.map((slot, i) => (
              <div key={i} className={slot.status === "empty" ? undefined : "study"}>
                {slot.status === "empty" && (
                  <button type="button" className="study empty" onClick={() => fileInputs.current[i]?.click()}>
                    <span className="plus">+</span>
                    <span>Add image</span>
                  </button>
                )}
                {(slot.status === "uploading" || slot.status === "done") && (
                  <>
                    <img src={slot.previewUrl} alt={`Reference ${i}`} />
                    <div className="meta">
                      <span className="name">L[{i}]</span>
                      {slot.status === "uploading" ? (
                        <span className="name">uploading…</span>
                      ) : (
                        <button type="button" className="remove" onClick={() => removeSlot(i)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                )}
                {slot.status === "error" && (
                  <div className="meta">
                    <span className="name">{slot.message}</span>
                    <button type="button" className="remove" onClick={() => removeSlot(i)}>
                      Try again
                    </button>
                  </div>
                )}
                <input
                  ref={(el) => {
                    fileInputs.current[i] = el;
                  }}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileChosen(i, file);
                    e.target.value = "";
                  }}
                />
              </div>
            ))}

            <button type="button" className="go" disabled={!canSubmit} onClick={handleGo}>
              {submitting ? "…" : "Go!"}
            </button>
          </div>
          <p className="gonote" style={{ marginBottom: 26 }}>
            A real shift, real spend — not a preview. Confirms before it fires.
          </p>

          <div className="section-label">Instruction</div>
          {error && <p className="error">{error}</p>}
          <label className="field">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Anxious. The ribbons pulled tight, the cloth crowded under them."
            />
          </label>
        </div>
      </div>

      <div>
        <div className="panel">
          <div className="panel-head">Estimated spend</div>
          <div className="panel-body">
            <div className="stat-row">
              <span className="k">rounds</span>
              <span>{ESTIMATE.rounds}</span>
            </div>
            <div className="stat-row">
              <span className="k">proposals</span>
              <span>{ESTIMATE.proposalsPerRound}</span>
            </div>
            <div className="stat-row">
              <span className="k">studies</span>
              <span>{slots.filter((s) => s.status === "done").length || ESTIMATE.studies}</span>
            </div>
            <div className="stat-row">
              <span className="k">judges</span>
              <span>{ESTIMATE.judges}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">Who can fire a shift</div>
          <div className="panel-body">
            <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6 }}>
              <strong>Studio</strong> — composes the brief, fires Go!, watches it run.
            </p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              Everyone else reads the Archive and watches a shift arrive. No spend.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
