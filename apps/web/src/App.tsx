import { Logo } from './components/ui';
import { WalletButton } from './components/Wallet';
import { BurnPill } from './components/BurnHero';
import { useApp } from './lib/store';
import { useRoute } from './lib/route';
import { Home } from './pages/Home';
import { Elections } from './pages/Elections';
import { ElectionPage } from './pages/Election';
import { Create } from './pages/Create';
import { Rails } from './pages/Rails';
import { Basket } from './pages/Basket';
import { Leaderboard } from './pages/Leaderboard';
import { Build } from './pages/Build';
import { Me } from './pages/Me';
import { Score } from './pages/Score';

const NAV = [
  ['elections', 'Elections', 'M4 5h16v3H4zM4 11h16v3H4zM4 17h10v3H4z'],
  ['basket', 'Stocks', 'M3 9h18l-2 11H5zM8 9l3-5M16 9l-3-5'],
  ['rails', 'Sign', 'M5 3v18M19 3v18M5 8h14M5 16h14'],
  ['leaderboard', 'Board', 'M5 20V10h4v10zM10 20V4h4v16zM15 20v-7h4v7z'],
  ['create', 'Create', 'M12 5v14M5 12h14'],
] as const;

export function App() {
  const { path } = useRoute();
  const { cfg, dep, ready, error, mode, snap } = useApp();
  const page = path[0] ?? '';
  let view;
  if (!ready) view = <div className="wrap"><div className="skeleton" style={{ minHeight: 240 }} /></div>;
  else if (!dep) view = <NotDeployed />;
  else if (page === '') view = <Home />;
  else if (page === 'elections') view = <Elections />;
  else if (page === 'e') view = <ElectionPage id={Number(path[1])} />;
  else if (page === 'create') view = <Create />;
  else if (page === 'rails' || page === 'gate') view = <Rails focus={path[1] ? Number(path[1]) : undefined} />;
  else if (page === 'basket') view = <Basket />;
  else if (page === 'leaderboard') view = <Leaderboard />;
  else if (page === 'build') view = <Build />;
  else if (page === 'me') view = <Me />;
  else if (page === 'score') view = <Score address={path[1]} />;
  else view = <Home />;
  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="logo" href="#/"><Logo /><span className="keep">Flatland</span></a>
          <nav className="nav" aria-label="Main">
            {NAV.map(([k, label]) => <a key={k} href={`#/${k}`} className={page === k || (k === 'elections' && page === 'e') ? 'on' : ''}>{label}</a>)}
            <a href="#/build" className={page === 'build' ? 'on' : ''}>Build</a>
          </nav>
          <div className="spacer" />
          {dep ? <BurnPill /> : null}
          {cfg ? <span className="chain-pill" title={mode === 'indexer' ? 'Live from the indexer' : 'Reading the chain directly'}><span className={'dot' + (error ? ' off' : '')} />chain {cfg.chainId}</span> : null}
          <WalletButton />
        </div>
      </header>
      <main><div className="wrap">{error && snap ? <div className="banner small">Connection hiccup — showing the last data. ({error})</div> : null}{view}</div></main>
      <footer className="foot">
        <div className="wrap grid g3">
          <div><div className="row"><Logo size={28} /><b>Flatland</b></div><p className="small muted" style={{ marginTop: 8 }}>Built on the World is Fair rules, open to everyone. An open protocol that extends World is Fair with permissionless elections, executable outcomes and Sign.</p></div>
          <div className="small"><b>Trust model</b><p className="muted">Wallet votes are fully on-chain. “Just send 1 $WIF” votes are attested by an indexer with a public audit export, a challenge-by-burn window, and on-chain votes always standing.</p></div>
          <div className="small"><b>Links</b><p><a href="#/build">Embed Sign · API · Agent (MCP)</a><br /><a href={cfg?.dexUrl ?? '#'} target="_blank" rel="noreferrer">World is Flat</a> · <a href={cfg?.explorer ?? '#'} target="_blank" rel="noreferrer">Explorer</a></p></div>
        </div>
      </footer>
      <nav className="tabbar" aria-label="Main">
        {NAV.map(([k, label, d]) => (
          <a key={k} href={`#/${k}`} className={page === k || (k === 'elections' && page === 'e') ? 'on' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>{label}
          </a>
        ))}
      </nav>
    </>
  );
}

function NotDeployed() {
  return (
    <div className="card" style={{ maxWidth: 640, margin: '40px auto' }}>
      <h2>Not deployed yet</h2>
      <p>This build has no <code>deployment.json</code>. After running the deploy script, copy <code>deployments/&lt;network&gt;.json</code> next to <code>index.html</code> as <code>deployment.json</code> (or set <code>deploymentUrl</code> in <code>config.json</code>).</p>
      <p className="muted small">See README → “Deploy”.</p>
    </div>
  );
}
