export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-brand-900 flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      <p className="text-white/70 text-sm">Loading…</p>
    </div>
  );
}
