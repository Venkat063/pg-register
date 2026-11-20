import StampBadge from "./StampBadge.jsx";

const fmt = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

const fmtShort = (d) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";

// Same rule as the Building filter: plain numbers = New, ends with a letter = Old.
const buildingOf = (room) => {
  if (/^\d+$/.test(room || "")) return "New";
  if (/[A-Za-z]$/.test(room || "")) return "Old";
  return "";
};

// The "photo" area of each card is tinted by payment status.
const TONES = {
  paid: { from: "#3F6F52", to: "#14261c", glow: "rgba(159,194,169,0.45)" },
  pending: { from: "#9a7428", to: "#1d2a1f", glow: "rgba(227,195,113,0.40)" },
  partial: { from: "#9a7428", to: "#22402F", glow: "rgba(227,195,113,0.40)" },
  overdue: { from: "#B24A3C", to: "#2a1612", glow: "rgba(226,166,155,0.45)" },
};

function DueLabel({ days }) {
  if (days == null) return null;
  if (days < 0) return <span className="text-rust font-semibold">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="text-rust font-semibold">due today</span>;
  if (days <= 7) return <span className="text-brass-dark font-semibold">in {days}d</span>;
  return <span className="text-ink-700/60">in {days}d</span>;
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function TenantCard({ tenant, index, onPay, onEdit, onDelete, canWrite }) {
  const p = tenant.current_payment;
  const status = p?.status || "pending";
  const tone = TONES[status] || TONES.pending;
  const building = buildingOf(tenant.room_no);
  const paidPct = p && p.amount_due > 0 ? Math.min(100, Math.round((p.amount_paid / p.amount_due) * 100)) : 0;
  const initial = (tenant.name || "?").trim().charAt(0).toUpperCase();

  return (
    <article
      className="card-enter group relative flex flex-col rounded-2xl border border-paper-line/80 bg-paper p-2.5 sm:p-3 shadow-[0_10px_28px_-14px_rgba(0,0,0,0.7)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_40px_-16px_rgba(0,0,0,0.75)] hover:border-brass/60"
      style={{ animationDelay: `${Math.min(index, 14) * 45}ms` }}
    >
      {/* "Product photo": room tile */}
      <div
        className="relative h-24 sm:h-28 overflow-hidden rounded-xl"
        style={{ background: `linear-gradient(145deg, ${tone.from}, ${tone.to})` }}
      >
        <div className="tile-windows absolute inset-0" />
        <div
          className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl"
          style={{ background: tone.glow }}
        />

        {building && (
          <span className="absolute left-2 top-2 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-paper/90 backdrop-blur-sm">
            {building}
          </span>
        )}

        {canWrite && (
          <button
            onClick={() => onDelete(tenant)}
            aria-label={`Delete ${tenant.name}`}
            title="Delete tenant"
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 text-paper/80 backdrop-blur-sm transition-colors hover:bg-rust hover:text-white"
          >
            <TrashIcon />
          </button>
        )}

        <div className="absolute inset-0 flex flex-col items-center justify-center pb-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-paper/60">Room</span>
          <span className="font-display text-3xl sm:text-4xl font-semibold leading-none text-paper drop-shadow-md">
            {tenant.room_no}
          </span>
        </div>
      </div>

      {/* Avatar overlapping the tile, like a profile badge */}
      <div className="relative -mt-4 flex justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-paper bg-ink-800 font-display text-sm font-semibold text-brass-light shadow-md">
          {initial}
        </span>
      </div>

      {/* Product-style details */}
      <div className="mt-1 flex-1 text-center">
        <h3 className="truncate font-display text-sm sm:text-base font-semibold leading-tight text-ink-900">
          {tenant.name}
        </h3>
        <p className="truncate font-body text-[11px] text-ink-700/55">{tenant.phone || "No phone added"}</p>

        <p className="mt-1 font-body text-base sm:text-lg font-bold text-sage">
          {fmt(tenant.rent_amount)}
          <span className="ml-0.5 text-[10px] font-medium text-ink-700/50">/month</span>
        </p>

        <div className="mt-1.5 flex justify-center">
          <StampBadge status={status} />
        </div>

        <p className="mt-2 font-mono text-[11px] text-ink-700/75">
          Due {fmtShort(p?.due_date)} · <DueLabel days={p?.days_until_due} />
        </p>

        {/* Paid progress */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-paper-line/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sage to-sage-light transition-all duration-700"
            style={{ width: `${paidPct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px]">
          <span className="text-sage">{fmt(p?.amount_paid)} paid</span>
          <span className="text-rust">{fmt(p?.balance)} due</span>
        </div>
      </div>

      {/* Joined button pair, like "Add to Cart | Buy Now" */}
      {canWrite && (
        <div className="mt-2.5 flex overflow-hidden rounded-md border border-ink-700/25 text-[11px] sm:text-xs font-semibold">
          <button
            onClick={() => onPay(tenant)}
            disabled={!p || p.balance <= 0}
            className="flex-1 bg-sage/10 py-2 text-sage transition-colors hover:bg-sage/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="sm:hidden">Pay</span>
            <span className="hidden sm:inline">Record payment</span>
          </button>
          <button
            onClick={() => onEdit(tenant)}
            className="flex-1 border-l border-ink-700/25 py-2 text-ink-800 transition-colors hover:bg-ink-700/10"
          >
            Edit
          </button>
        </div>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-paper-line/80 bg-paper/90 p-3">
      <div className="shimmer h-28 rounded-xl" />
      <div className="shimmer mx-auto mt-6 h-3.5 w-3/4 rounded" />
      <div className="shimmer mx-auto mt-2 h-3 w-1/2 rounded" />
      <div className="shimmer mx-auto mt-3 h-4 w-2/5 rounded" />
      <div className="shimmer mt-4 h-8 rounded-md" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-paper-line/70 bg-paper/95 py-16 text-center shadow-lg">
      <p className="font-display text-xl text-ink-800 mb-1">No tenants match this view</p>
      <p className="font-body text-sm text-ink-700/60">Try clearing a filter, or add a new tenant to the register.</p>
    </div>
  );
}

export default function TenantTable({ tenants, onPay, onEdit, onDelete, loading, canWrite = true }) {
  const gridCls = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

  if (loading) {
    return (
      <div className={gridCls}>
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (tenants.length === 0) return <EmptyState />;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg sm:text-xl font-semibold text-paper">
          Tenants <span className="ml-1 font-mono text-sm text-paper/40">({tenants.length})</span>
        </h2>
      </div>
      <div className={gridCls}>
        {tenants.map((t, i) => (
          <TenantCard
            key={t.id}
            tenant={t}
            index={i}
            onPay={onPay}
            onEdit={onEdit}
            onDelete={onDelete}
            canWrite={canWrite}
          />
        ))}
      </div>
    </section>
  );
}
