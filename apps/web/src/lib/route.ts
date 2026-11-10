import { useEffect, useState } from 'react';

export function useRoute(): { path: string[]; query: URLSearchParams } {
  const parse = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [p, q = ''] = h.split('?');
    return { path: p.split('/').filter(Boolean), query: new URLSearchParams(q) };
  };
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => { setR(parse()); window.scrollTo({ top: 0 }); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export const go = (to: string) => { location.hash = to.startsWith('#') ? to : '#' + to; };
