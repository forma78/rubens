import { JUDGES, GENERATORS, SYSTEM, initial, vendorLabel } from "@/lib/roles";

// Judges + Generators panels — used by both Live and Canon (design_handoff's
// "The cast"). Static, from config/roles.json (mirrored in lib/roles.ts):
// who's in the syndicate doesn't change per shift. A judge shows the model
// it actually answers on, not its role id — "rounds 1-5" used to sit here
// and said nothing once every judge judges every round.
export function CastSidebar() {
  return (
    <>
      <div className="panel">
        <div className="panel-head">Judges</div>
        <div className="panel-body">
          {JUDGES.map((j) => (
            <div className="cast-row" key={j.id}>
              <div className="cast-avatar" style={{ background: j.color }}>
                {initial(j.name)}
              </div>
              <div>
                <span className="cast-name">{j.name}</span>
                <span className="cast-tag">{j.model}</span>
              </div>
              <span className="cast-detail">{vendorLabel(j.vendor)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">Generators</div>
        <div className="panel-body">
          {GENERATORS.map((g) => (
            <div className="cast-row" key={g.id}>
              <div className="cast-avatar" style={{ background: g.color }}>
                {initial(g.name)}
              </div>
              <div>
                <span className="cast-name">{g.name}</span>
                <span className="cast-tag">{g.id}</span>
              </div>
              <span className="cast-detail">{vendorLabel(g.vendor)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">System</div>
        <div className="panel-body">
          <div className="cast-row">
            <div className="cast-avatar system" style={{ background: SYSTEM.color }}>
              {initial(SYSTEM.name)}
            </div>
            <div>
              <span className="cast-name">{SYSTEM.name}</span>
              <span className="cast-tag">{SYSTEM.tag}</span>
            </div>
            <span className="cast-detail">{SYSTEM.detail}</span>
          </div>
        </div>
      </div>
    </>
  );
}
