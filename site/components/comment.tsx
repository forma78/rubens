import { judgeById, initial, vendorLabel } from "@/lib/roles";

// The canon comment row — rubens-claude-design/Rubens Prototype.dc.html
// renders exactly this on both its Live and its Canon screen, and the
// screens Theo sent on 2026-08-21 are the single truth for it: a 36px
// square avatar in the judge's own colour, the name in link blue followed
// by "(role, vendor) · <tail>", the verdict itself, then the
// (Reply) (Thread) (Link) row. Live and Canon share this one component so
// a comment cannot read one way on one page and another way on the next.
//
// Reply/Thread/Link are the canon's own three links. Nobody but the studio
// can write here and the studio only reads (site-plan C1, no guest write
// path anywhere), so Reply is an anchor to the comment itself; Thread goes
// to the pairwise view where the rest of this pair's verdicts are, when
// there is one to go to.
//
// `index` carries the canon's thread rhythm: the first verdict on a pair
// is the post, the ones after it are the replies, and every other reply
// sits indented on the grey ground.
export function CommentRow({
  id,
  judgeId,
  vendor,
  why,
  tail,
  index = 0,
  threadHref,
}: {
  id: string;
  judgeId: string;
  vendor: string | null;
  why: string | null;
  tail: string;
  index?: number;
  threadHref?: string;
}) {
  const judge = judgeById(judgeId);
  const reply = index > 0;
  const anchor = `#comment-${id}`;

  return (
    <div className={`comment-row${reply ? " reply" : ""}${index % 2 === 1 ? " indented" : ""}`} id={`comment-${id}`}>
      <div className="comment-avatar" style={{ background: judge?.color ?? "#888" }}>
        {initial(judge?.name ?? "?")}
      </div>
      <div className="comment-body">
        <div className="comment-meta">
          <span className="name">{judge?.name ?? judgeId}</span> ({judgeId}, {vendorLabel(vendor)}) · {tail}
          {reply ? " · reply" : ""}
        </div>
        <p className="comment-text">{why}</p>
        <div className="comment-actions">
          (<a href={anchor}>Reply</a>) (<a href={threadHref ?? anchor}>Thread</a>) (<a href={anchor}>Link</a>)
        </div>
      </div>
    </div>
  );
}
