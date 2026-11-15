import assert from 'node:assert/strict';

// A new authorized session may follow an old credit stop. Within a session,
// deterministic failures are never retried and every successful case is unique.
export function verifyCollectionSessions(requests, starts=[], totalCases=144) {
  const paid=requests.filter(r=>r.kind==='PAID_INFERENCE');
  const groups=new Map(),successes=new Set();
  for(const r of paid){
    const match=/^(gemma|qwen)-(.+)-request-\d+\.json$/.exec(r.file);assert.ok(match,'Unrecognized capture filename');
    const stamp=match[2];if(!groups.has(stamp))groups.set(stamp,[]);groups.get(stamp).push(r);
    if(r.httpStatus===200){const key=r.model+'#'+r.caseId;assert.ok(!successes.has(key),'Successful case was paid twice');successes.add(key);}
  }
  const receipts=[];
  for(const [stamp,calls] of groups){
    calls.sort((a,b)=>a.ordinal-b.ordinal);assert.equal(new Set(calls.map(c=>c.ordinal)).size,calls.length);
    const catalog=requests.find(r=>r.kind==='CATALOG'&&r.file.startsWith('catalog-'+stamp+'-request-')&&r.httpStatus===200);
    assert.ok(catalog,'Session lacks successful current catalog');assert.ok(Date.parse(catalog.receivedAt)<=Date.parse(calls[0].startedAt));
    for(let i=1;i<calls.length;i++)assert.ok(Date.parse(calls[i-1].receivedAt??calls[i-1].completedAt)<=Date.parse(calls[i].startedAt),'Overlapping inference requests');
    const byCase=new Map();
    for(const c of calls){const key=c.model+'#'+c.caseId;if(!byCase.has(key))byCase.set(key,[]);byCase.get(key).push(c);}
    for(const attempts of byCase.values()){
      assert.ok(attempts.length<=4,'Frozen retry attempt limit exceeded');
      for(const failure of attempts.slice(0,-1))assert.ok(failure.status==='TRANSPORT_ERROR'||[408,425,429].includes(failure.httpStatus)||failure.httpStatus>=500,'Deterministic response retried within session');
    }
    const start=starts.find(s=>s.stamp===stamp);
    if(start?.qwenFirst){
      assert.ok(start.targetOrder[0].includes('/Qwen'));
      const qwen=calls.filter(c=>c.model.includes('/Qwen')),gemma=calls.filter(c=>c.model.includes('/Gemma'));
      if(start.initialCases.qwen<totalCases)assert.ok(calls[0].model.includes('/Qwen'),'Gemma ran before priority Qwen');
      if(gemma.length){
        assert.equal(start.initialCases.qwen+qwen.filter(c=>c.httpStatus===200).length,totalCases,'Gemma ran before Qwen completed');
        if(qwen.length)assert.ok(Date.parse(gemma[0].startedAt)>=Math.max(...qwen.map(c=>Date.parse(c.receivedAt??c.completedAt))));
      }
    }
    const credits=calls.filter(c=>c.httpStatus===402);
    if(credits.length){assert.equal(credits.length,1);assert.equal(calls.at(-1),credits[0],'Inference continued after insufficient credit');}
    receipts.push({stamp,qwenFirst:start?.qwenFirst??false,attempts:calls.length,successfulCases:calls.filter(c=>c.httpStatus===200).length,retries:calls.length-byCase.size,creditStopped:credits.length===1});
  }
  return receipts;
}
