const FAMILIES = ["opus", "sonnet", "haiku"];

export function parseModel(id) {
  if (!id || typeof id !== "string" || id === "<synthetic>") return null;
  let base = id;
  let variant = null;
  const vm = base.match(/\[([^\]]+)\]$/);
  if (vm) {
    variant = vm[1];
    base = base.slice(0, vm.index);
  }
  base = base.replace(/-\d{8}$/, "");
  const lower = base.toLowerCase();
  let family = "unknown";
  let bestIdx = Infinity;
  for (const f of FAMILIES) {
    const i = lower.indexOf(f);
    if (i >= 0 && i < bestIdx) { bestIdx = i; family = f; }
  }
  let version = null;
  if (family !== "unknown") {
    let m;
    const D = String.raw`(\d+)`;
    if ((m = lower.match(new RegExp(`claude-${family}-${D}-${D}`)))) version = `${m[1]}.${m[2]}`;
    else if ((m = lower.match(new RegExp(`claude-${family}-${D}$`)))) version = m[1];
    else if ((m = lower.match(new RegExp(`claude-${D}-${D}-${family}`)))) version = `${m[1]}.${m[2]}`;
    else if ((m = lower.match(new RegExp(`claude-${D}-${family}`)))) version = m[1];
  }
  const label = family !== "unknown"
    ? (version ? `${family} ${version}` : family)
    : base.replace(/^claude-/, "").slice(0, 24);
  return { id, family, version, label, variant };
}
