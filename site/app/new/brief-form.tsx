"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The 5 real CANVAS_PROFILES keys (src/syndicate/canvas.js) — the picker
// only ever shows what the runner actually knows how to render.
const CANVAS_FORMATS = ["60x80", "70x100", "90x120", "100x100", "120x90"] as const;
type CanvasFormat = (typeof CANVAS_FORMATS)[number];

type Slot =
  | { status: "empty" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; url: string; previewUrl: string }
  | { status: "error"; message: string };

const emptySlots: Slot[] = [{ status: "empty" }, { status: "empty" }, { status: "empty" }, { status: "empty" }];

export function BriefForm({ userId }: { userId: string }) {
  const [canvasFormat, setCanvasFormat] = useState<CanvasFormat | null>(null);
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
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
    setSlots((prev) => prev.map((s, i) => (i === index ? { status: "done", url: data.publicUrl, previewUrl } : s)));
  }

  function removeSlot(index: number) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { status: "empty" } : s)));
  }

  async function handleGo() {
    // "Confirms before it fires" (the note under the button) has to be
    // real, not just copy — this is a real paid shift, not a preview.
    const confirmed = window.confirm(
      `Launch a real shift on ${canvasFormat}? This calls Anthropic, xAI and OpenAI for real and spends real money.`,
    );
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const referenceUrls = slots.map((s) => (s.status === "done" ? s.url : null));
    const slug = `brief-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const { data: brief, error: insertError } = await supabase
      .from("briefs")
      .insert({
        slug,
        instruction: instruction.trim(),
        canvas_format: canvasFormat,
        reference_urls: referenceUrls,
        status: "pending",
      })
      .select("id")
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

    setLaunched(brief.id);
    setSubmitting(false);
  }

  if (launched) {
    return (
      <section>
        <p>
          Shift launched — <code className="mono">{launched}</code>. GitHub Actions is running it now; check{" "}
          <code className="mono">runs/{launched}</code> once it lands, or the Supabase{" "}
          <code className="mono">briefs</code> table for live status.
        </p>
      </section>
    );
  }

  return (
    <>
      <section>
        <div className="sechead">
          <h2>Canvas size</h2>
        </div>
        <div className="formats" role="radiogroup" aria-label="Canvas format">
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
      </section>

      <section>
        <div className="sechead">
          <h2>Colour</h2>
        </div>
        <div className="studies">
          {slots.map((slot, i) => (
            <div key={i} className={slot.status === "empty" ? undefined : "study"}>
              {slot.status === "empty" && (
                <button
                  type="button"
                  className="study empty"
                  onClick={() => fileInputs.current[i]?.click()}
                >
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

          <button
            type="button"
            className="go"
            style={{ backgroundImage: "url(/rubens.jpg)" }}
            disabled={!canSubmit}
            onClick={handleGo}
          >
            {submitting ? "…" : "Go!"}
          </button>
        </div>
        <p className="gonote">A real shift, real spend — not a preview. Confirms before it fires.</p>
      </section>

      <section>
        <div className="sechead">
          <h2>Instruction</h2>
        </div>
        {error && <p className="error">{error}</p>}
        <label className="field">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Anxious. The ribbons pulled tight, the cloth crowded under them."
          />
        </label>
      </section>
    </>
  );
}
