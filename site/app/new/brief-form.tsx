"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The 5 real CANVAS_PROFILES keys (src/syndicate/canvas.js) — the picker
// only ever shows what the runner actually knows how to render.
const CANVAS_FORMATS = ["60x80", "70x100", "90x120", "100x100", "120x90"] as const;
type CanvasFormat = (typeof CANVAS_FORMATS)[number];

// src/syndicate/models.js is the runtime authority; this mirrors it the same
// way CANVAS_FORMATS mirrors canvas.js. Model 2 has no colour studies at all
// — its inks are named in its own state — so choosing it changes what the
// rest of this form even asks for.
const GENERATORS = [
  { id: 1, name: "Model 1 — dyed cloth", note: "colour fields, read out of your painted studies", usesStudies: true },
  { id: 2, name: "Model 2 — ruled cloth", note: "short ink bars from the generator's own ink library", usesStudies: false },
] as const;

// config/syndicate.json's real defaults, mirrored the same way
// lib/roles.ts mirrors config/roles.json — Vercel's Root Directory is
// `site`, so nothing outside it is guaranteed to exist in the build.
const ESTIMATE = { rounds: 1, proposalsPerRound: 32, studies: 4, judges: 6 };

type Slot =
  | { status: "empty" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; url: string; previewUrl: string; path: string }
  | { status: "error"; message: string };

const emptySlots: Slot[] = [{ status: "empty" }, { status: "empty" }, { status: "empty" }, { status: "empty" }];

// `userId` is null for a guest. A guest gets the whole page and none of the
// spending: Go! is locked, the study slots don't open a file picker (the
// references bucket is owner-only at the database anyway, so an upload would
// only fail confusingly), and /api/shift would refuse the dispatch regardless.
export function BriefForm({ userId }: { userId: string | null }) {
  const isGuest = userId === null;
  const router = useRouter();
  const [canvasFormat, setCanvasFormat] = useState<CanvasFormat | null>(null);
  const [generator, setGenerator] = useState<1 | 2 | null>(null);
  const [slots, setSlots] = useState<Slot[]>(emptySlots);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<(HTMLInputElement | null)[]>([]);

  const hasReference = slots.some((s) => s.status === "done");
  // A reference is required whichever generator runs. Model 2 does not read
  // it as a palette — its inks are named in its own state — but the judges
  // are shown the first one as the tonal target either way (run.js's
  // referenceJpeg), and run.js assumes at least one exists.
  const readsPalette = GENERATORS.find((g) => g.id === generator)?.usesStudies ?? true;
  const canSubmit =
    !isGuest &&
    canvasFormat !== null &&
    generator !== null &&
    hasReference &&
    instruction.trim().length > 0 &&
    !submitting;

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
    if (isGuest) return; // the button is already disabled; this is the second lock

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
        generator,
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
          <div className="section-label">Generator</div>
          <div className="formats" role="radiogroup" aria-label="Generator" style={{ marginBottom: 8 }}>
            {GENERATORS.map((g) => (
              <button
                key={g.id}
                type="button"
                className="fmt"
                role="radio"
                aria-checked={generator === g.id}
                onClick={() => setGenerator(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>
          <p className="gonote" style={{ marginBottom: 26 }}>
            {generator === null
              ? "Two parametric models, both drawing the same cloth. What differs is what gets laid inside the cells."
              : GENERATORS.find((g) => g.id === generator)?.note}
          </p>

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

          <div className="section-label">
            {readsPalette ? "Colour — four hand-painted studies" : "Colour — the target, not the palette"}
          </div>
          {!readsPalette && (
            <p className="gonote" style={{ marginBottom: 14 }}>
              Model 2 names its own inks, so nothing here is read as a palette. The first image is still what
              the judges are shown as the tonal target — red stripes and a green ribbon will steer how they
              argue, just not what the generator has to paint with.
            </p>
          )}
          <div className="studies" style={{ marginBottom: 8 }}>
            {slots.map((slot, i) => (
              <div key={i} className={slot.status === "empty" ? undefined : "study"}>
                {slot.status === "empty" && (
                  <button
                    type="button"
                    className="study empty"
                    disabled={isGuest}
                    title={isGuest ? "Studio only — a study is uploaded to the studio's own account" : undefined}
                    onClick={() => fileInputs.current[i]?.click()}
                  >
                    <span className="plus">{isGuest ? "\u{1F512}" : "+"}</span>
                    <span>{isGuest ? "Studio only" : "Add image"}</span>
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
              disabled={!canSubmit}
              title={isGuest ? "Studio only — guests cannot spend tokens" : "Fires a real, paid shift"}
              onClick={handleGo}
            >
              {isGuest ? "\u{1F512}" : submitting ? "…" : "Go!"}
            </button>
          </div>
          <p className="gonote" style={{ marginBottom: 26 }}>
            {isGuest
              ? "Go! is the studio's. Everything else on this page is yours to read."
              : "A real shift, real spend — not a preview. Confirms before it fires."}
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
          <div className="panel-head">Want one of your own?</div>
          <div className="panel-body">
            <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6 }}>
              You&apos;ve wandered into the artist&apos;s back room. That round button spends his actual
              money on real models, so it stays locked — nothing personal.
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6 }}>
              The whole syndicate is on GitHub though, MIT and all of it. Clone it, put it on your own
              server, feed it your own API keys and your own Supabase — and six opinionated judges will
              start arguing about <em>your</em> paintings instead of his. Same stubbornness. Your bill.
            </p>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
              <a href="https://github.com/forma78/rubens" target="_blank" rel="noreferrer">
                github.com/forma78/rubens
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
