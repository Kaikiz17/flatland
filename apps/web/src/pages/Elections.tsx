import { useMemo, useState } from 'react';
import { useApp } from '../lib/store';
import { ElectionCard } from '../components/ElectionCard';
import { Empty } from '../components/ui';

export function Elections() {
  const { snap } = useApp();
  const [tab, setTab] = useState<'open' | 'ended' | 'all'>('open');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const all = [...(snap?.elections ?? [])].reverse();
    return all
      .filter((e) => (tab === 'all' ? true : tab === 'open' ? e.status === 'open' || e.status === 'upcoming' : e.status === 'ended' || e.status === 'finalized'))
      .filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase()) || e.options.some((o) => o.toLowerCase().includes(q.toLowerCase())));
  }, [snap, tab, q]);
  return (
    <>
      <div className="row between"><h2>Elections</h2><a className="btn" href="#/create">+ New election</a></div>
      <div className="tabs">
        {(['open', 'ended', 'all'] as const).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k === 'open' ? 'Open' : k === 'ended' ? 'Ended' : 'All'}</button>)}
      </div>
      <div className="field"><input placeholder="Search elections or options…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></div>
      {!snap ? <div className="skeleton" /> : list.length === 0 ? <Empty>Nothing here yet.</Empty> : <div className="grid g3">{list.map((e) => <ElectionCard key={e.id} e={e} />)}</div>}
    </>
  );
}
