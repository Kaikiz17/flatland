/** Three-step "how it works" strip. */
export function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="steps" aria-label="How it works">
      {items.map(([h, t], i) => <li key={i}><b>{i + 1}</b><div><strong>{h}</strong><span>{t}</span></div></li>)}
    </ol>
  );
}
