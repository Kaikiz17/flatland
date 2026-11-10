/*!
 * Flatland widget — "Send 1 $WIF to act". Drop-in, zero dependencies, ~4 KB.
 *
 *   <script src="https://YOUR-FLATLAND/flatland-widget.js" data-gate="3" data-title="Sign the petition"></script>
 *
 * data-gate      required  gate id from the Sign page
 * data-title     optional  heading (titles live in events, not storage)
 * data-label     optional  button text (default "Send 1 $WIF to act")
 * data-callback  optional  name of a global function(result) called after a successful act
 * It also dispatches a `flatland:acted` CustomEvent on window with {gate, who, tx}.
 * Reads config.json / deployment.json next to this script. Works with any injected EVM wallet (Phantom, Trust, MetaMask…).
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var base = script.src.replace(/[^/]*$/, '');
  var gateId = parseInt(script.getAttribute('data-gate') || '', 10);
  var title = script.getAttribute('data-title') || 'Send $WIF to act';
  var label = script.getAttribute('data-label');
  var cbName = script.getAttribute('data-callback');
  var SEL = { act: '0xc9ee7e02', getGate: '0x6a822bf1', hasActed: '0xbbdb5c0b', approve: '0x095ea7b3', allowance: '0xdd62ed3e' };
  var pad = function (h) { return ('0000000000000000000000000000000000000000000000000000000000000000' + h.replace(/^0x/, '')).slice(-64); };
  var num = function (n) { return pad(BigInt(n).toString(16)); };
  var box = document.createElement('div');
  box.style.cssText = 'font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:420px;border:2px solid #10203a;border-radius:14px;background:#fbf8ef;color:#10203a;padding:16px;box-shadow:4px 4px 0 #10203a';
  script.parentNode.insertBefore(box, script.nextSibling);
  var h = document.createElement('div'); h.style.cssText = 'font-weight:800;font-size:1.05rem;margin-bottom:4px'; h.textContent = title;
  var meta = document.createElement('div'); meta.style.cssText = 'font-size:.85rem;color:#5b6780;margin-bottom:10px'; meta.textContent = 'Loading…';
  var btn = document.createElement('button');
  btn.style.cssText = 'font:inherit;font-weight:800;width:100%;cursor:pointer;border:2px solid #10203a;background:#ff5a36;color:#fff;padding:12px;border-radius:12px;box-shadow:3px 3px 0 #10203a';
  var msg = document.createElement('div'); msg.style.cssText = 'font-size:.82rem;margin-top:8px;word-break:break-word';
  var credit = document.createElement('a'); credit.href = base; credit.target = '_blank'; credit.rel = 'noopener'; credit.textContent = 'powered by Flatland — built on the World is Fair rules';
  credit.style.cssText = 'display:block;font-size:.7rem;color:#5b6780;margin-top:10px;text-decoration:none';
  box.appendChild(h); box.appendChild(meta); box.appendChild(btn); box.appendChild(msg); box.appendChild(credit);

  var cfg, dep, gate, who = null, rpcId = 1;
  function rpc(method, params) {
    return fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: method, params: params }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.result; });
  }
  var call = function (to, data) { return rpc('eth_call', [{ to: to, data: data }, 'latest']); };
  var provider = function () { return (window.phantom && window.phantom.ethereum) || window.ethereum; };
  var say = function (t, ok) { msg.style.color = ok ? '#2e9e5b' : '#c9302c'; msg.textContent = t; };
  var human = function (wei) { var s = (Number(BigInt(wei)) / 1e18); return s % 1 === 0 ? String(s) : s.toFixed(2); };

  function readGate() {
    return call(dep.gate, SEL.getGate + num(gateId)).then(function (r) {
      var w = r.slice(2).match(/.{64}/g);
      gate = { kind: parseInt(w[1], 16), start: parseInt(w[2], 16), end: parseInt(w[3], 16), cost: BigInt('0x' + w[4]), cap: parseInt(w[5], 16), count: parseInt(w[6], 16) };
      if (gate.cost === 0n) throw new Error('Gate not found');
    });
  }
  function readActed() {
    if (!who) return Promise.resolve(false);
    return call(dep.gate, SEL.hasActed + num(gateId) + pad(who)).then(function (r) { return BigInt(r) === 1n; });
  }
  function render(acted) {
    var kinds = ['signed', 'going', 'on the list', 'unlocked'];
    meta.textContent = gate.count + (gate.cap ? ' / ' + gate.cap : '') + ' ' + kinds[gate.kind] + ' · burns ' + human(gate.cost) + ' $WIF per wallet';
    var closed = (gate.end && Date.now() / 1000 >= gate.end) || (gate.cap && gate.count >= gate.cap);
    if (acted) { btn.textContent = '✓ You’re in'; btn.disabled = true; btn.style.background = '#2e9e5b'; btn.style.cursor = 'default'; }
    else if (closed) { btn.textContent = 'Closed'; btn.disabled = true; btn.style.opacity = .6; }
    else { btn.disabled = false; btn.textContent = who ? (label || 'Send ' + human(gate.cost) + ' $WIF to act') : 'Connect wallet'; }
  }
  function ensureChain(p) {
    var hex = '0x' + cfg.chainId.toString(16);
    return p.request({ method: 'eth_chainId' }).then(function (id) {
      if (id === hex) return;
      return p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }).catch(function (e) {
        if (e && (e.code === 4902 || /unrecognized|not added/i.test(e.message || ''))) {
          return p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: cfg.chainName || 'Chain ' + cfg.chainId, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [cfg.rpc], blockExplorerUrls: [cfg.explorer] }] });
        }
        throw e;
      });
    });
  }
  function waitReceipt(hash) {
    return new Promise(function (res, rej) {
      var n = 0;
      (function poll() {
        rpc('eth_getTransactionReceipt', [hash]).then(function (r) {
          if (r) return r.status === '0x1' ? res(r) : rej(new Error('Transaction reverted'));
          if (++n > 90) return rej(new Error('Timed out waiting for confirmation'));
          setTimeout(poll, 1500);
        }).catch(rej);
      })();
    });
  }
  function act(p) {
    return readActed().then(function (acted) {
      if (acted) { render(true); return; }
      return call(dep.wif, SEL.allowance + pad(who) + pad(dep.gate)).then(function (a) {
        if (BigInt(a) >= gate.cost) return;
        btn.textContent = 'Approve $WIF…';
        return p.request({ method: 'eth_sendTransaction', params: [{ from: who, to: dep.wif, data: SEL.approve + pad(dep.gate) + num(gate.cost) }] }).then(waitReceipt);
      }).then(function () {
        btn.textContent = 'Confirm…';
        return p.request({ method: 'eth_sendTransaction', params: [{ from: who, to: dep.gate, data: SEL.act + num(gateId) }] });
      }).then(function (hash) { btn.textContent = 'Waiting…'; return waitReceipt(hash).then(function () { return hash; }); })
        .then(function (hash) {
          say('Done ✓ ' + hash.slice(0, 10) + '…', true); gate.count++; render(true);
          var detail = { gate: gateId, who: who, tx: hash };
          window.dispatchEvent(new CustomEvent('flatland:acted', { detail: detail }));
          if (cbName && typeof window[cbName] === 'function') window[cbName](detail);
        });
    });
  }
  btn.onclick = function () {
    var p = provider();
    if (!p) { say('No wallet found. Open this page inside Phantom, Trust Wallet or MetaMask.', false); return; }
    btn.disabled = true; say('', true);
    var first = !who;
    var chain = who ? ensureChain(p) : p.request({ method: 'eth_requestAccounts' }).then(function (a) { who = a[0]; return ensureChain(p); });
    chain.then(function () {
      if (first) return readActed().then(function (acted) { render(acted); });
      return act(p);
    }).catch(function (e) { var m = (e && e.message) || String(e); say(/reject|denied/i.test(m) ? 'Cancelled in wallet.' : m.slice(0, 160), false); readActed().then(render).catch(function () { render(false); }); });
  };
  Promise.all([fetch(base + 'config.json').then(function (r) { return r.json(); }), fetch(base + 'deployment.json').then(function (r) { return r.json(); })])
    .then(function (r) { cfg = r[0]; dep = r[1]; if (isNaN(gateId)) throw new Error('data-gate missing'); return readGate(); })
    .then(function () {
      var p = provider();
      if (p) p.request({ method: 'eth_accounts' }).then(function (a) { who = a[0] || null; return readActed(); }).then(render).catch(function () { render(false); });
      else render(false);
    })
    .catch(function (e) { meta.textContent = 'Flatland widget error: ' + e.message; btn.style.display = 'none'; });
})();
