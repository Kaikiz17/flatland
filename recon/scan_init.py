import json,subprocess,sys
R='https://rpc.mainnet.chain.robinhood.com'
import urllib.request
def rpc(m,p):
    req=urllib.request.Request(R,json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{'content-type':'application/json','user-agent':'curl/8'})
    return json.load(urllib.request.urlopen(req,timeout=60))
PM='0x8366a39cc670b4001a1121b8f6a443a643e40951'
T='0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438'
pad=lambda a:'0x'+'0'*24+a[2:].lower()
USDG=pad('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')
WETH=pad('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')
head=int(rpc('eth_blockNumber',[])['result'],16)
out=[]
for s in range(0,head+1,5000000):
    e=min(s+4999999,head)
    r=rpc('eth_getLogs',[{"fromBlock":hex(s),"toBlock":hex(e),"address":PM,"topics":[T]}])
    if 'error' in r: print(r['error']);continue
    out+=r['result']
json.dump(out,open('init_logs.json','w'))
print(len(out))
