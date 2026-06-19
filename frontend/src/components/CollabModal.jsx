/* Team / collaboration modal: Members + Activity + Branding tabs.
 * Comments backend exists; UI defers to next sprint.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("cm_token")}` } });
const ROLES = ["pm", "estimator", "viewer"];

const ACTION_LABEL = {
  "member.invited": "invited",
  "member.removed": "removed",
  "member.role_changed": "changed role of",
  "comment.added": "commented on",
  "branding.updated": "updated the project branding",
  "bid.saved": "saved",
};

export default function CollabModal({ projectId, onClose }) {
  const [tab, setTab] = useState("members");

  return (
    <div
      data-testid="team-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0f0f0f] border border-white/10 w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="label-mono text-[#5588FF]">// COLLABORATION</div>
            <div className="font-display text-xl mt-1">Team & branding</div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white text-2xl leading-none">✕</button>
        </div>
        <nav className="flex border-b border-white/10 px-6">
          {[
            { id: "members",  label: "Members" },
            { id: "activity", label: "Activity" },
            { id: "branding", label: "Branding" },
          ].map((t) => (
            <button key={t.id}
              data-testid={`team-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 label-mono border-b-2 transition-colors ${tab === t.id ? "border-[#FFCC00] text-[#FFCC00]" : "border-transparent text-neutral-500 hover:text-white"}`}
            >{t.label}</button>
          ))}
        </nav>
        <div className="overflow-auto flex-1 p-6">
          {tab === "members"  && <MembersPanel projectId={projectId} />}
          {tab === "activity" && <ActivityPanel projectId={projectId} />}
          {tab === "branding" && <BrandingPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}

function MembersPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("estimator");
  const [busy, setBusy] = useState(false);

  const load = () => axios.get(`${API}/projects/${projectId}/members`, auth()).then((r) => setData(r.data));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  if (!data) return <div className="text-neutral-500 font-mono text-sm">Loading…</div>;
  const canManage = data.your_role === "owner" || data.your_role === "pm";

  const invite = async (e) => {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    try {
      await axios.post(`${API}/projects/${projectId}/members`, { email, role }, auth());
      setEmail("");
      await load();
    } catch (e) { alert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const changeRole = async (em, newRole) => {
    await axios.patch(`${API}/projects/${projectId}/members/${em}`, { role: newRole }, auth());
    await load();
  };
  const remove = async (em) => {
    if (!window.confirm(`Remove ${em} from this project?`)) return;
    await axios.delete(`${API}/projects/${projectId}/members/${em}`, auth());
    await load();
  };

  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-white/10 text-neutral-500 label-mono">
          <th className="py-2 pr-4 text-left">Email</th>
          <th className="py-2 pr-4 text-left">Role</th>
          <th className="py-2 pr-4 text-left">Status</th>
          <th className="py-2"></th>
        </tr></thead>
        <tbody>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4">{data.owner.email} <span className="text-neutral-500">({data.owner.name})</span></td>
            <td className="py-2 pr-4"><span className="label-mono text-[#FFCC00]">OWNER</span></td>
            <td className="py-2 pr-4 text-[#00CC66] label-mono">active</td>
            <td></td>
          </tr>
          {data.members.map((m) => (
            <tr key={m.user_email} className="border-b border-white/5">
              <td className="py-2 pr-4">{m.user_email}</td>
              <td className="py-2 pr-4">
                {canManage ? (
                  <select value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)}
                    className="bg-black border border-white/15 px-2 py-1 text-xs font-mono">
                    {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
                  </select>
                ) : <span className="label-mono">{m.role.toUpperCase()}</span>}
              </td>
              <td className="py-2 pr-4 label-mono">
                {m.accepted ? <span className="text-[#00CC66]">active</span> : <span className="text-[#FFCC00]">pending</span>}
              </td>
              <td className="py-2 text-right">
                {canManage && (
                  <button data-testid={`member-remove-${m.user_email}`}
                    onClick={() => remove(m.user_email)}
                    className="text-[#FF6666] hover:text-[#FF3333] text-xs label-mono">REMOVE</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canManage && (
        <form onSubmit={invite} className="mt-6 flex gap-2 items-end">
          <label className="flex-1">
            <div className="label-mono mb-1">Invite by email</div>
            <input data-testid="invite-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="estimator@firm.com"
              className="w-full bg-black border border-white/15 px-3 py-2 text-sm" required />
          </label>
          <label>
            <div className="label-mono mb-1">Role</div>
            <select data-testid="invite-role" value={role} onChange={(e) => setRole(e.target.value)}
              className="bg-black border border-white/15 px-3 py-2 text-sm">
              {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </label>
          <button data-testid="invite-submit"
            disabled={busy}
            className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50"
          >Invite</button>
        </form>
      )}
      <p className="mt-4 text-xs text-neutral-500 font-mono">
        Roles · <span className="text-[#FFCC00]">OWNER</span>: full · <span className="text-[#FFCC00]">PM</span>: edit + manage team ·
        <span className="text-[#FFCC00]"> ESTIMATOR</span>: edit materials/pricing/bids · <span className="text-[#FFCC00]">VIEWER</span>: read-only.
      </p>
    </div>
  );
}

function ActivityPanel({ projectId }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    axios.get(`${API}/projects/${projectId}/activity`, auth()).then((r) => setEvents(r.data));
  }, [projectId]);
  if (!events) return <div className="text-neutral-500 font-mono text-sm">Loading…</div>;
  if (!events.length) return <div className="text-neutral-500 font-mono text-sm">No activity yet.</div>;
  return (
    <ul className="space-y-2.5">
      {events.map((e) => (
        <li key={e.id} className="border border-white/5 bg-[#141414] px-4 py-2.5 flex items-baseline gap-3">
          <span className="text-[#FFCC00] font-mono text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</span>
          <span className="text-sm">
            <b>{e.user_email}</b>{" "}
            <span className="text-neutral-400">{ACTION_LABEL[e.action] || e.action}</span>{" "}
            {e.target_name && <span className="text-[#5588FF]">{e.target_name}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BrandingPanel({ projectId }) {
  const [b, setB] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/projects/${projectId}/branding`, auth()).then((r) => setB(r.data));
  }, [projectId]);

  if (!b) return <div className="text-neutral-500 font-mono text-sm">Loading…</div>;

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axios.put(`${API}/projects/${projectId}/branding`, {
        company_name: b.company_name || "",
        accent_color: b.accent_color || "#0055FF",
        tagline: b.tagline || "",
        logo_data_url: b.logo_data_url || "",
      }, auth());
      setB(data);
    } catch (e) { alert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };
  const onLogo = (file) => {
    if (!file) return;
    if (file.size > 400 * 1024) { alert("Logo must be < 400KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setB({ ...b, logo_data_url: reader.result });
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <p className="text-sm text-neutral-400 leading-relaxed">
        Customize the look of the public share link clients receive. Logo + accent color show in the header of <code className="text-[#FFCC00]">/share/&lt;token&gt;</code>.
      </p>
      <label className="block">
        <div className="label-mono mb-1">Company name</div>
        <input data-testid="branding-name" value={b.company_name || ""}
          onChange={(e) => setB({ ...b, company_name: e.target.value })}
          className="w-full bg-black border border-white/15 px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <div className="label-mono mb-1">Tagline</div>
        <input data-testid="branding-tagline" value={b.tagline || ""}
          onChange={(e) => setB({ ...b, tagline: e.target.value })}
          placeholder="Building tomorrow's spaces today"
          className="w-full bg-black border border-white/15 px-3 py-2 text-sm" />
      </label>
      <label className="block">
        <div className="label-mono mb-1">Accent color</div>
        <input data-testid="branding-color" type="color" value={b.accent_color || "#0055FF"}
          onChange={(e) => setB({ ...b, accent_color: e.target.value })}
          className="h-10 w-20 bg-black border border-white/15 cursor-pointer" />
      </label>
      <label className="block">
        <div className="label-mono mb-1">Logo (PNG/JPG, &lt;400KB)</div>
        <input data-testid="branding-logo" type="file" accept="image/png,image/jpeg,image/svg+xml"
          onChange={(e) => onLogo(e.target.files?.[0])}
          className="w-full text-xs text-neutral-400" />
        {b.logo_data_url && (
          <div className="mt-2 p-3 border border-white/10 bg-black inline-block">
            <img src={b.logo_data_url} alt="Logo preview" className="h-12 object-contain" />
          </div>
        )}
      </label>
      <button data-testid="branding-save" onClick={save} disabled={saving}
        className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-5 py-2 text-xs uppercase tracking-wider disabled:opacity-50">
        {saving ? "Saving…" : "Save branding"}
      </button>
    </div>
  );
}
