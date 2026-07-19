import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";

type Props = {
  roundNumber: number | null;
  deadlineUtc: string | null;
  children?: ReactNode;
};

function formatDeadline(deadlineUtc: string | null) {
  if (!deadlineUtc) return "soon.";
  return `${new Date(deadlineUtc).toLocaleString()}.`;
}

export function PreFirstPickHero({ roundNumber, deadlineUtc, children }: Props) {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
      <div className="font-semibold">{`Round ${roundNumber ?? "—"} Open`}</div>
      <div className="mt-1 text-slate-600">
        <div>You haven't made your first pick yet.</div>
        <div>{`Picks close ${formatDeadline(deadlineUtc)}`}</div>
      </div>
      <button
        type="button"
        className="btn btn-primary mt-4"
        onClick={() => navigate("/make-pick")}
      >
        Make Pick
      </button>
      {children ? <div className="mt-4 text-slate-600">{children}</div> : null}
    </div>
  );
}
