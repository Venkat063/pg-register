const fmt = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

// Small stroke icons (24x24 viewBox), drawn inline so there's no icon library to install.
const ICONS = {
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  rupee: (
    <>
      <path d="M6 4h12" />
      <path d="M6 9h12" />
      <path d="M9 4c5 0 6 5 0 5h-1l8 11" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
};

const TONES = {
  paper: { fg: "#F4EFDD", chip: "rgba(244,239,221,0.12)", glow: "rgba(244,239,221,0.16)" },
  sage: { fg: "#9FC2A9", chip: "rgba(159,194,169,0.16)", glow: "rgba(159,194,169,0.28)" },
  brass: { fg: "#E3C371", chip: "rgba(227,195,113,0.16)", glow: "rgba(227,195,113,0.26)" },
  rust: { fg: "#E2A69B", chip: "rgba(226,166,155,0.16)", glow: "rgba(226,166,155,0.28)" },
};

function Stat({ label, value, tone, icon, index }) {
  const t = TONES[tone];
  return (
    <div
      className="card-enter relative overflow-hidden rounded-xl border border-ink-600/50 bg-gradient-to-br from-ink-700/60 to-ink-800/80 backdrop-blur-sm px-3.5 sm:px-4 py-3 sm:py-3.5"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className="pointer-events-none absolute -right-7 -top-7 h-24 w-24 rounded-full blur-2xl"
        style={{ background: t.glow }}
      />
      <div className="relative flex items-center gap-2 mb-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: t.chip, color: t.fg }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[icon]}
          </svg>
        </span>
        <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-paper/55 font-body leading-tight">
          {label}
        </p>
      </div>
      <p className="relative font-mono text-xl sm:text-2xl font-semibold" style={{ color: t.fg }}>
        {value}
      </p>
    </div>
  );
}

export default function Dashboard({ data }) {
  if (!data) return null;

  const stats = [
    { label: "Tenants", value: data.total_tenants, tone: "paper", icon: "users" },
    { label: "Outstanding", value: fmt(data.pending_amount), tone: "rust", icon: "rupee" },
    { label: "Paid", value: data.paid_count, tone: "sage", icon: "check" },
    { label: "Pending / Partial", value: data.pending_count + data.partial_count, tone: "brass", icon: "clock" },
    { label: "Overdue", value: data.overdue_count, tone: "rust", icon: "alert" },
    { label: "Due in 7 days", value: data.due_within_7_days, tone: "brass", icon: "calendar" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
      {stats.map((s, i) => (
        <Stat key={s.label} {...s} index={i} />
      ))}
    </div>
  );
}
