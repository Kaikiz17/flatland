/** Rasterise a same-origin SVG to a 1080×1080 PNG and trigger a download. */
export async function downloadPng(svgUrl: string, name: string, size = 1080): Promise<void> {
  const svg = await fetch(svgUrl).then((r) => { if (!r.ok) throw new Error('card missing'); return r.text(); });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, size, size);
    const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
    const href = URL.createObjectURL(png);
    const a = document.createElement('a');
    a.href = href; a.download = name.endsWith('.png') ? name : name + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
