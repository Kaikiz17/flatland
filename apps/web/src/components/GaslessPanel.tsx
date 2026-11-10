import { useEffect, useState } from 'react';
import { type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { accountAddress, buildSponsoredVoteOp, toBundlerOp, erc20Abi } from '@flatland/core';
import { useApp } from '../lib/store';
import { wif } from '../lib/format';

const KEY = 'flatland.gasless.owner';
const bigintJson = (_: string, v: unknown) => (typeof v === 'bigint' ? '0x' + v.toString(16) : v);

/** Experimental: a throwaway owner key in this browser controls a smart account whose FIRST vote's gas is sponsored. */
export function GaslessPanel({ electionId, option }: { electionId?: number; option?: number }) {
  const { cfg, dep, client } = useApp();
  const [owner] = useState(() => {
    let k = localStorage.getItem(KEY) as Hex | null;
    if (!k) { k = generatePrivateKey(); localStorage.setItem(KEY, k); }
    return privateKeyToAccount(k);
  });
  const [acct, setAcct] = useState<string>('');
  const [bal, setBal] = useState<bigint>(0n);
  const [msg, setMsg] = useState('');
  const [eid, setEid] = useState(electionId ?? 1);
  const [opt, setOpt] = useState(option ?? 0);
  useEffect(() => {
    if (!client || !dep) return;
    void accountAddress(client as any, dep, owner.address, 1n).then(async (a) => {
      setAcct(a);
      setBal((await client.readContract({ address: dep.wif, abi: erc20Abi, functionName: 'balanceOf', args: [a] })) as bigint);
    }).catch(() => {});
  }, [client, dep, owner.address, msg]);
  if (!cfg || !dep) return null;
  const send = async () => {
    if (!cfg.bundlerUrl) { setMsg('No bundler is configured for this deployment (config.json → bundlerUrl). Gasless votes are unavailable here.'); return; }
    try {
      setMsg('Signing…');
      const op = await buildSponsoredVoteOp({ client: client as any, dep, owner: owner.address, salt: 1n, electionId: eid, option: opt, sign: (h) => owner.signMessage({ message: { raw: h } }) });
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendUserOperation', params: [toBundlerOp(op), '0x0000000071727De22E5E9d8BAf0edAc6f37da032'] }, bigintJson);
      const r = await (await fetch(cfg.bundlerUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json();
      setMsg(r.error ? `Bundler rejected it: ${r.error.message}` : `Sent. UserOp ${String(r.result).slice(0, 12)}…`);
    } catch (e: any) { setMsg(e?.shortMessage ?? e?.message ?? 'Failed'); }
  };
  return (
    <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
      <h2>Gasless first vote <span className="tag">experimental</span></h2>
      <p className="small muted">No ETH? Send 1+ WIF to the smart account below, then cast your first vote with gas paid by a capped community paymaster. Once per account, and the vote still burns real WIF. The key lives only in this browser — use it for small amounts.</p>
      <p className="addr">{acct || '…'}</p>
      <p className="small">WIF balance: <b>{wif(bal)}</b></p>
      <div className="row" style={{ gap: 8 }}>
        <label className="small">Election # <input type="number" min={1} value={eid} onChange={(e) => setEid(Number(e.target.value))} style={{ width: 70 }} /></label>
        <label className="small">Option # <input type="number" min={0} value={opt} onChange={(e) => setOpt(Number(e.target.value))} style={{ width: 70 }} /></label>
        <button className="btn" onClick={send} disabled={bal === 0n}>Vote without gas</button>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
