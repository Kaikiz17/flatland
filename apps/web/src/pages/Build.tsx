import { useApp } from '../lib/store';
import { Copy } from '../components/ui';

const Snip = ({ code, lang }: { code: string; lang?: string }) => (
  <div style={{ position: 'relative' }}>
    <pre className="code" aria-label={lang}>{code}</pre>
    <div style={{ position: 'absolute', top: 8, right: 8 }}><Copy text={code} /></div>
  </div>
);

export function Build() {
  const { dep, cfg } = useApp();
  const origin = (cfg?.appUrl ?? (location.origin + location.pathname.replace(/[^/]*$/, ''))).replace(/\/$/, '');
  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <h2>Build on Flatland</h2>
      <p className="muted">Everything here is permissionless. Flatland extends the World is Fair rules into an open protocol, so any app, bot or agent can run elections and plug into “send 1 $WIF to act”.</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>① Embed a rail (one tag)</h3>
        <p className="small">Petition, RSVP, allowlist or access gate on any site. Works with Phantom, Trust, MetaMask — injected wallets and in-app browsers.</p>
        <Snip lang="html" code={`<script src="${origin}/flatland-widget.js" data-gate="1" data-title="Sign the petition"></script>`} />
        <p className="small">Listen for it: <code>window.addEventListener('flatland:acted', e =&gt; …)</code> or set <code>data-callback="myFn"</code>.</p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>② Gate a smart contract</h3>
        <Snip lang="solidity" code={`import {WifGate, WifGated} from "flatland/WifGate.sol";

contract MyAirdrop is WifGated {
    constructor(WifGate gate) WifGated(gate) {}
    function claim(uint256 gateId) external onlyActed(gateId) { /* msg.sender burned $WIF to be here */ }
}

// or from anywhere:  WifGate(${dep?.gate ?? '0xGATE'}).hasActed(gateId, wallet)`} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>③ Read results (JSON)</h3>
        <Snip lang="bash" code={`curl ${origin}/api/elections
curl ${origin}/api/elections/1        # tallies, fairness score, groups, winner
curl ${origin}/api/stats`} />
        <p className="small muted">Plus public audit exports per election (Merkle root, leaf encoding, voter list, funding-source groups) for independent verification.</p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>④ Agents (MCP)</h3>
        <p className="small">An MCP server at <code>{origin}/api/mcp</code> exposes <b>list_elections</b>, <b>get_election</b>, <b>get_stats</b>, <b>prepare_create_election</b> (returns unsigned calldata — it never holds keys) and <b>vote_link</b>.</p>
        <Snip lang="json" code={`{ "mcpServers": { "flatland": { "url": "${origin}/api/mcp" } } }`} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>⑤ Telegram &amp; X vote bot</h3>
        <p className="small">Reply “vote B” under a post or in a group. The bot answers with a ready-to-send 1 $WIF transfer link — a wallet deep link to that option’s deposit box. No key custody, no wallet connection. (Open source in <code>packages/bot</code>; you run it with your own bot tokens.)</p>
      </div>

      <div className="card">
        <h3>⑥ Gasless first vote <span className="tag">experimental</span></h3>
        <p className="small">Newcomers with <b>0 ETH</b> can cast their first vote: a capped paymaster pool sponsors the gas for one vote per new account, while the vote still burns ≥1 $WIF. Per-op and daily caps, no withdraw function, nothing to farm. Paymaster: <code>{dep?.paymaster}</code>.</p>
      </div>
    </div>
  );
}
