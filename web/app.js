// Presentation only. Product API owns every decision and evidence state.
const $ = id => document.getElementById(id);
document.querySelector('.skip').onclick = e => { e.preventDefault(); $('workspace').focus(); };
const esc = v => String(v ?? 'Not recorded').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = v => `<details><summary>Raw API record</summary><pre>${esc(JSON.stringify(v, null, 2))}</pre></details>`;
const state = v => `<span class="state ${['DENY', 'FAIL', 'UNFIT', 'REVOKED', 'DISQUALIFIED'].includes(v) ? 'fail' : ['ALLOW', 'PASS', 'VALID', 'QUALIFIED'].includes(v) ? 'pass' : ''}">${esc(v)}</span>`;
const facts = rows => `<dl class="fact-list">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
const section = (title, body) => `<section class="section"><h2>${title}</h2>${body}</section>`;
const link = (hash, label) => `<a class="button" href="#${hash}">${label} →</a>`;
let view, portfolio, opener, renderVersion = 0;
async function get(path, options) { const response = await fetch(path, { cache: 'no-store', ...options }); if (!response.ok)
    throw new Error(`Request rejected (HTTP ${response.status}). Refresh or check your access.`); return response.json(); }
function inspect(title, body) { opener = document.activeElement; $('inspector-title').textContent = title; $('inspector-body').innerHTML = body; $('inspector').showModal(); }
$('close-inspector').onclick = () => $('inspector').close();
$('inspector').addEventListener('close', () => opener?.focus());
const names = { release: 'Release desk', evidence: 'Evidence & requirements', candidates: 'Qualification-first comparison', assurance: 'Assurance & reassessment', audit: 'Incident investigation', verification: 'Proof & admission verification' };
function heading(route) { return `<div class="page-heading"><div><span class="eyebrow">MODEL QUALIFICATION / ${esc(route.toUpperCase())}</span><h1>${names[route]}</h1><p class="description">${({ release: 'An exact proof is the unit of release. Start with authority, then investigate the evidence.', evidence: 'Requirements become evidence. Evidence explains the decision.', candidates: 'Admissary does not rank models. It ranks admissible choices.', assurance: 'Yesterday’s approval belongs to yesterday’s exact proof.', audit: 'Historical proof survives an incident. Current authority may not.', verification: 'Historical consistency and current deployment authority are separate checks.' })[route]}</p></div><span class="origin">${route === 'release' || route === 'evidence' ? 'Stored real evidence' : 'Provenance labeled per record'}</span></div>`; }
function liveEvidence() {
    const records = view.candidates.filter(c => c.execution);
    if (!records.length) return '';
    return section('Real candidate workload evidence', records.map(c => {
        const e = c.execution;
        return `<article><h3>${esc(c.label)}</h3><span class="origin">${esc(e.provenance)}</span>${facts([['Execution', e.completionStatus + ' · ' + e.casesCompleted + '/' + e.caseCount], ['Empirical fitness', c.empiricalFitness], ['Full qualification', c.qualificationState], ['Binding scope', e.bindingScope], ['Exact runtime artifact', e.exactArtifactBindingProven ? 'PROVEN' : 'UNPROVEN'], ['Run / status digest', e.runDigest]])}<details><summary>Inspect workload metrics and proof</summary>${e.metrics.length ? `<table><caption>${esc(c.label)} · frozen workload thresholds</caption><thead><tr><th>Requirement</th><th>Observed</th><th>Required</th><th>State</th></tr></thead><tbody>${e.metrics.map(m => `<tr><td data-label="Requirement">${esc(m.label)}<small>${esc(m.criticality)}</small></td><td data-label="Observed">${esc(Number.isInteger(m.observed) ? m.observed : Number(m.observed.toFixed(6)))}</td><td data-label="Required">${esc(m.operator)} ${esc(m.threshold)}</td><td data-label="State">${state(m.state)}</td></tr>`).join('')}</tbody></table>` : '<p>Incomplete execution has no complete-run metrics.</p>'}${raw(c)}</details></article>`;
    }).join(''));
}
function release() { const c = view.candidate; return `<div class="authority"><div class="authority-decision"><span class="eyebrow">CAN THIS SHIP?</span><strong>${c.deployAllowed ? 'ALLOW' : 'DENY'}</strong><small>Recorded authority</small></div><div class="authority-copy"><h2>${esc(c.model)}</h2><span class="muted">${esc(view.contract.environment)} / ${esc(view.contract.workload)}</span><div class="state-strip"><div><span>Empirical fitness</span><strong>${esc(c.empiricalFitness)}</strong></div><div><span>Full qualification</span><strong>${esc(c.overallQualification)}</strong></div><div><span>Exact artifact</span><strong>${c.exactArtifactBindingProven ? 'PROVEN' : 'UNPROVEN'}</strong></div></div></div></div><div class="callout">This is a verified stored evidence projection, captured ${esc(view.generatedAt)}. It is not a live deployment census. ${link('verification', 'Check current Product authority')}</div><div class="split">${section('What prevents this model from shipping?', `<ul class="rule-list"><li><a href="#evidence">Mandatory workload gates failed</a><p>Critical recall and schema validity fail. Aggregate quality cannot compensate.</p></li><li><a href="#evidence">Exact runtime artifact binding is unproven</a><p>Provider model identity does not prove immutable revision, tokenizer or weights.</p></li><li><a href="#verification">Review and approval are still required</a><p>${view.deploymentBlockers.map(esc).join(' · ')}</p></li></ul>`)}${section('Release proof', facts([['Contract', view.contract.id + ' @ ' + view.contract.version], ['Environment', view.contract.environment], ['Workload', view.contract.workload], ['Evidence provider', c.provider], ['Binding scope', c.bindingScope]]) + link('evidence', 'Inspect exact proof'))}</div>${section('Attention queue', `<ul class="rule-list"><li>${link('assurance', 'Investigate stale proof')}<p>Case B · controlled acceptance lifecycle with stored watcher evidence</p></li><li>${link('audit', 'Investigate revocation & rollback')}<p>Case D · acceptance fixture, historical signature versus current authority</p></li><li>${link('candidates', 'Review replacement eligibility')}<p>No genuine real qualified winner is recorded.</p></li></ul>`)} `; }
function evidence() { return section('Aggregate quality is not deployment fitness.', `<p class="description">Real Dolphin evidence · ${esc(view.integrations.dolphin.cases)} frozen workload cases. Mandatory failures determine empirical fitness; advisory latency does not independently block qualification.</p><table><caption>Workload requirements</caption><thead><tr><th>Requirement</th><th>Observed</th><th>Required</th><th>Evidence state</th><th>Inspect</th></tr></thead><tbody>${view.metrics.map((m, i) => `<tr class="${m.state === 'FAIL' && m.criticality === 'MANDATORY' ? 'metric-fail' : ''}"><td data-label="Requirement">${esc(m.label)}<small>${esc(m.criticality)}</small></td><td data-label="Observed">${esc(Number.isInteger(m.observed) ? m.observed : Number(m.observed.toFixed(6)))}</td><td data-label="Required">${esc(m.operator)} ${esc(m.threshold)}</td><td data-label="Evidence state">${state(m.state)}</td><td><button data-metric="${i}">Inspect evidence</button></td></tr>`).join('')}</tbody></table>`) + `<div class="split">${section('Exact identity & contract', facts([['Repository', view.candidate.model], ['Revision', 'UNPROVEN for hosted runtime'], ['Tokenizer', 'UNPROVEN for hosted runtime'], ['Artifact manifest', 'UNPROVEN for hosted runtime'], ['Contract', view.contract.id], ['Contract digest', view.contract.digest], ['Snapshot digest', view.snapshotDigest]]) + raw(view.contract))}${section('Unresolved proof obligations', `<p>Unknown evidence is not a pass. Full qualification remains ${esc(view.candidate.overallQualification)}.</p><ul class="rule-list">${view.missingObligations.map(x => `<li><code>${esc(x)}</code> ${state('UNKNOWN')}</li>`).join('')}</ul>`)}</div>` + liveEvidence() + section('Evidence inventory', `<p class="muted">Stored historical sources. Digests identify the accepted artifacts; no new inference is performed.</p><ul class="rule-list">${view.artifacts.map((a, i) => `<li><button data-artifact="${i}">${esc(a.label)} ↗</button><p>${esc(a.role)}</p><code>${esc(a.digest)}</code></li>`).join('')}</ul>`); }
function candidates() { const c = portfolio.cases.find(x => x.id === 'CASE_C'); return `<div class="callout"><strong>Qualification precedes economics.</strong> ${esc(c.headline)} The selected positive candidate is ${esc(c.facts.selectedClaimScope)}. No real qualified candidate exists in this evidence set.</div>` + section('Candidate eligibility', `<table><caption>Recorded candidate states and provenance</caption><thead><tr><th>Candidate</th><th>Qualification</th><th>Deployment</th><th>Reason</th></tr></thead><tbody>${view.candidates.map(c => `<tr><td data-label="Candidate">${esc(c.label)}<small>${esc(c.provenance)}</small></td><td data-label="Qualification">${state(c.qualificationState)}${c.empiricalFitness ? `<small>Empirical ${esc(c.empiricalFitness)}</small>` : ''}</td><td data-label="Recorded deployment">${state(c.deploymentState)}</td><td data-label="Reason">${esc(c.explanation)}</td></tr>`).join('')}</tbody></table>`) + section('Admissible selection · acceptance fixture', facts([['Real selection', c.facts.realSelectionStatus], ['Selected candidate', c.facts.selectedCandidateId], ['Claim scope', c.facts.selectedClaimScope], ['Real winner exists', c.facts.realQualifiedCandidateExists]]) + raw(c)); }
function assurance() { const c = portfolio.cases.find(x => x.id === 'CASE_B'); return `<div class="callout"><span class="origin">${esc(c.claimScope)}</span><p>${esc(c.headline)} Watcher CHECK_ERROR is not MATERIAL_CHANGE. Stored watcher observations do not prove a fresh check now.</p></div>` + section('Protected identity changed', `<div class="compare"><div><span class="eyebrow">BEFORE · EXACT APPROVED PROOF</span><strong>${c.facts.initialAllowed ? 'ALLOW' : 'DENY'}</strong><p>Qualification and approval bind the original identity.</p></div><div><span class="eyebrow">AFTER · MATERIAL CHANGE</span><strong>${c.facts.driftAllowed ? 'ALLOW' : 'DENY'}</strong><p>Reassessment ${c.facts.reassessmentRequested ? 'required' : 'not requested'}. Historical approval ${c.facts.historicalApprovalPreserved ? 'preserved' : 'not preserved'}.</p></div></div>`) + `<div class="split">${section('Invalidated proof branches', c.facts.invalidatedNodes.map(n => `<div class="branch"><code>${esc(n)}</code><span class="state fail">STALE</span></div>`).join(''))}${section('Restore current authority', `<ol class="steps"><li>Register the exact observed replacement identity.</li><li>Request and complete trusted replacement qualification.</li><li>Complete the matching Product reassessment.</li><li>Obtain fresh approval and matching signed attestation.</li><li>Check current Product admission.</li></ol><p>Approval inherited after requalification: ${esc(c.facts.requalificationInheritedApproval)}.</p>`)}</div>` + section('Reuse only what still applies', facts([['Unchanged proof', view.requalification.unchanged.reused + ' nodes reused'], ['Policy-only change', view.requalification.policyChange.reused.length + ' branches reusable'], ['Artifact change', view.requalification.artifactChange.recomputed.length + ' branches recomputed'], ['Stored watcher repository', c.facts.realWatcherRepository], ['Stored watcher outcome', c.facts.realWatcherOutcome]]) + raw(c)); }
function audit() { const c = portfolio.cases.find(x => x.id === 'CASE_D'), f = c.facts; return `<div class="callout"><span class="origin">ACCEPTANCE FIXTURE · STORED INCIDENT</span><p>${esc(f.incidentDeploymentId)} · inspect this incident without confusing historical cryptography with current authorization.</p></div>` + section('The signature survives. The authority does not.', `<div class="compare"><div><span class="eyebrow">HISTORICAL SIGNED PROOF</span><strong>${f.historicalAttestationCryptographicallyValid ? 'VALID' : 'INVALID'}</strong><p>Exact signed statement remains verifiable.</p></div><div><span class="eyebrow">CURRENT AUTHORITY AT INCIDENT</span><strong>${f.currentAuthorityAllowed ? 'ALLOW' : 'DENY'} — REVOKED</strong><p>Historical approval does not authorize a revoked release.</p></div></div>`) + `<div class="split">${section('Incident proof identity', facts([['Deployment', f.incidentDeploymentId], ['Approval record', f.approvalId], ['Attestation digest', f.attestationDigest], ['Audit digest', f.auditDigest], ['Recorded audit events', f.timelineEvents]]) + raw(c))}${section('Safe rollback candidate', facts([['Exact target', f.rollbackTargetId], ['Eligible targets', f.rollbackTargetCount], ['Eligibility', 'Qualified, exact-bound, approved, current, attested, same environment and workload']]) + `<p class="muted">This is the stored API-selected target. Recheck current authority before operating. This public view cannot execute rollback.</p>`)}</div>` + section('Investigation sequence', `<p class="muted">Portfolio investigation steps, not a reconstructed event ledger. Protected deployment audit returns server recording order and separate business occurrence times.</p><ol class="steps">${c.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`); }
function verification() {
    return `<div class="callout"><strong>Historical validity is not permission to ship.</strong> A signed historical proof may remain valid after revocation. Only the state-aware Product admission surface or CI can authorize deployment now.</div>` + section('Historical / offline fixture verification', `<p>THE MEMORABLE ATTACK · change a protected proof input. This runs the server verifier against an explicitly non-production acceptance fixture.</p><label for="scenario">Fixture scenario</label><select id="scenario"><option value="valid">Exact historical match</option><option value="revision">Changed model revision</option><option value="contract">Changed contract</option><option value="stale">Stale manifest</option><option value="unapproved">Unapproved manifest</option></select><div class="actions"><button id="verify">Verify historical fixture</button></div><div id="verify-status" class="status-message" role="status">Not checked. Current authority is not evaluated here.</div><div id="verify-result"></div>`) + section('Current deployment admission', `<p>Use the authenticated Product API with your existing ADMISSION or ADMIN role. The browser never derives authority from a manifest.</p><pre>POST /v1/product/deployments/:id/admission

node scripts/admissary-ci-check.mjs
  --product-state product.json
  --assurance-state assurance.json
  --trust-store public-trust.json
  --deployment-id deployment-id
  --context context.json</pre><form id="current-check"><label for="deployment-id">Deployment ID</label><input id="deployment-id" required autocomplete="off"><label for="access-token">Existing ADMISSION or ADMIN access token</label><input id="access-token" type="password" required autocomplete="off" aria-describedby="token-note"><p id="token-note" class="muted">Sent only to this local Product API. Kept out of browser storage and cleared after checking.</p><label for="current-context">Exact runtime context JSON</label><textarea id="current-context" aria-describedby="current-status" required spellcheck="false"></textarea><button type="submit">Check current authority</button><div id="current-status" class="status-message" role="status">No current authority check performed.</div><div id="current-result"></div></form><p>No public approval, revocation or rollback controls are exposed. Authentication and signing remain server-side.</p>`);
}
function protectedRead() { return section('Inspect authenticated Product records', `<p>Use an existing VIEWER-or-higher read role. Records are retrieved from this Product API, without browser-side authority decisions.</p><form id="records-form"><label for="record-kind">Record type</label><select id="record-kind"><option value="deployments">Deployments</option><option value="candidates">Candidate registry</option><option value="contracts">Contracts</option><option value="audit">Deployment audit & safe rollback</option><option value="qualification">Qualification run</option></select><label for="record-id">Deployment or qualification ID (for audit/run)</label><input id="record-id" aria-describedby="read-status" autocomplete="off"><label for="read-token">Existing read access token</label><input id="read-token" type="password" autocomplete="off" required><p class="muted">Memory only; cleared after the request. Protected records remain unavailable without a valid role.</p><button>Read Product records</button><div id="read-status" role="status" class="status-message">Not connected.</div><div id="read-result"></div></form>`); }
function render() { if (!view)
    return; renderVersion++; const requested = location.hash.slice(1) || 'release', route = names[requested] ? requested : 'release'; $('demo-causal-chain').hidden = route !== 'verification'; document.querySelectorAll('nav a').forEach(a => { if (a.hash === '#' + route)
    a.setAttribute('aria-current', 'page');
else
    a.removeAttribute('aria-current'); }); $('workspace').innerHTML = heading(route) + ({ release, evidence, candidates, assurance, audit, verification }[route]()) + protectedRead(); document.title = 'Admissary — ' + names[route]; $('workspace').setAttribute('aria-busy', 'false'); document.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { const m = view.metrics[Number(b.dataset.metric)]; inspect(m.label, facts([['Evidence state', m.state], ['Requirement', m.operator + ' ' + m.threshold], ['Observed', m.observed], ['Criticality', m.criticality], ['Provider', view.candidate.provider], ['Source', view.integrations.dolphin.artifactFile], ['Run digest', view.integrations.dolphin.runDigest], ['Captured', view.generatedAt], ['Provenance', 'REAL · stored historical evidence'], ['Decision affected', m.criticality === 'ADVISORY' ? 'Advisory only; cannot independently block qualification' : 'Empirical qualification']]) + raw(m)); }); document.querySelectorAll('[data-artifact]').forEach(b => b.onclick = () => { const a = view.artifacts[Number(b.dataset.artifact)]; inspect(a.label, facts([['Source', a.file], ['Digest', a.digest], ['Purpose', a.role], ['Provenance', 'Stored historical artifact reference']]) + raw(a)); }); if ($('records-form'))
    {$('records-form').onsubmit = readRecords;$('records-form').oninput=()=>{$('read-result').replaceChildren();$('read-status').textContent='Query changed. Read the record again.';};} if ($('verify'))
    $('verify').onclick = verify; if ($('current-check')) {
    $('current-check').onsubmit = checkCurrent;
    $('current-check').oninput = () => { $('current-result').replaceChildren(); $('current-status').textContent = 'Inputs changed. Run a new current authority check.'; };
} }
async function verify() { const version = renderVersion; const button = $('verify'), status = $('verify-status'); if (button.disabled)
    return; button.disabled = true; status.setAttribute('role','status');status.dataset.state = 'pending'; status.textContent = 'Checking historical fixture…'; $('verify-result').replaceChildren(); try {
    const p = await get('/v1/product/verifier-demo?scenario=' + encodeURIComponent($('scenario').value));
    if (version !== renderVersion)
        return;
    status.dataset.state = 'succeeded';
    status.textContent = 'Server check completed. Current authority: NOT EVALUATED.';
    $('verify-result').innerHTML = facts([['Historical consistency', p.result.allowed ? 'VALID' : 'INVALID'], ['Manifest digest', p.result.manifestDigest], ['Context digest', p.result.contextDigest]]) + raw(p.result);
}
catch (e) {
    status.setAttribute('role','alert');status.dataset.state = 'failed';
    status.textContent = e.message + ' No valid result was confirmed. Retry this check.';
}
finally {
    button.disabled = false;
} }
async function boot() { const button = $('refresh'); if (button.disabled)
    return; button.disabled = true; $('workspace').setAttribute('aria-busy', 'true'); $('load-status').textContent = 'Loading verified Product API evidence…'; try {
    const [v, p] = await Promise.all([get('/v1/product/judge-view'), get('/v1/product/scenarios')]);
    view = v;
    portfolio = p.portfolio;
    renderOperationalCases();
    render();
    $('load-status').textContent = 'Verified stored evidence · captured ' + view.generatedAt + ' · no live inference';
}
catch (e) {
    view = null; portfolio = null; renderVersion++;$('portfolio-content').replaceChildren();$('verification-scenarios').replaceChildren();$('demo-causal-chain').hidden = true;
    $('workspace').innerHTML = '<section class="empty"><h1>Evidence unavailable</h1><p>' + esc(e.message) + '</p><p>Use Refresh evidence to retry. No authority is inferred from an unavailable response.</p></section>';
    $('workspace').setAttribute('aria-busy', 'false');
    $('load-status').textContent = 'Evidence load failed; no current status confirmed.';
}
finally {
    button.disabled = false;
} }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); $('workspace').focus({ preventScroll: true }); });
$('refresh').onclick = boot;
boot();
async function checkCurrent(event) { event.preventDefault(); const version = renderVersion; const form = event.currentTarget, button = form.querySelector('button'), status = $('current-status'); if (button.disabled)
    return; let context; try {
    context = JSON.parse($('current-context').value);
    $('current-context').removeAttribute('aria-invalid');
}
catch {
    status.setAttribute('role','alert');status.dataset.state = 'failed';
    $('current-context').setAttribute('aria-invalid', 'true');
    status.textContent = 'Context must be valid JSON. Correct the context field and retry.';
    $('current-context').focus();
    return;
} Array.from(form.elements).forEach(e => e.disabled = true); status.setAttribute('role','status');status.dataset.state = 'pending'; status.textContent = 'Checking current Product and Assurance authority…'; $('current-result').replaceChildren(); const token = $('access-token').value; $('access-token').value = ''; try {
    const response = await fetch('/v1/product/deployments/' + encodeURIComponent($('deployment-id').value) + '/admission', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ schema: 'admissary-current-deployment-admission-request/v1', context }) });
    const result = await response.json();
    if (version !== renderVersion)
        return;
    if (![200, 409].includes(response.status) || result.schema !== 'admissary-current-deployment-admission-decision/v1')
        throw Object.assign(new Error('Current check rejected (HTTP ' + response.status + '). Check role, deployment ID and context.'), { confirmedRejection: true });
    status.dataset.state = 'succeeded';
    status.textContent = 'Verified server response: ' + result.decision + '. This result applies to the checked context at this instant.';
    $('current-result').innerHTML = facts([['Current authority', result.decision], ['Reasons', result.currentAuthority.reasons.join(' · ') || 'No blockers reported']]) + raw(result);
}
catch (e) {
    status.setAttribute('role','alert');status.dataset.state = e.confirmedRejection ? 'failed' : 'uncertain';
    status.textContent = 'No current authority confirmed. ' + e.message + ' Check the deployment before retrying.';
}
finally {
    Array.from(form.elements).forEach(e => e.disabled = false);
} }
async function readRecords(event) { event.preventDefault(); const version = renderVersion; const form=event.currentTarget,button = form.querySelector('button'), status = $('read-status'); if (button.disabled)
    return; const kind = $('record-kind').value, id = $('record-id').value.trim(); if (['audit', 'qualification'].includes(kind) && !id) {
    status.textContent = 'Enter the exact record ID.';
    $('record-id').focus();
    return;
} const path = kind === 'audit' ? '/v1/product/deployments/' + encodeURIComponent(id) + '/audit' : kind === 'qualification' ? '/v1/product/qualifications/' + encodeURIComponent(id) : '/v1/product/' + kind; const token = $('read-token').value; $('read-token').value = ''; Array.from(form.elements).forEach(e=>e.disabled=true); status.textContent = 'Reading protected Product records…'; $('read-result').replaceChildren(); try {
    const p = await get(path, { headers: { authorization: 'Bearer ' + token } });
    if (version !== renderVersion)
        return;
    status.textContent = 'Product records retrieved. Eligibility in a record is not a substitute for the signed current-admission check.';
    let body = '';
    if (p.audit) {
        const a = p.audit;
        body = facts([['Deployment', a.deployment.deploymentId], ['Eligibility', a.decision.allowed ? 'ALLOW' : 'DENY'], ['Reasons', a.decision.reasons.join(' · ')], ['Qualification', a.qualification.qualificationState], ['Candidate', a.candidate.repositoryOrModelId], ['Approval', a.approval?.state ?? 'NONE'], ['Attestation', a.attestation?.attestationDigest ?? 'NONE']]) + facts(Object.entries(a.exactIdentity)) + `<h3>Authoritative audit chronology</h3><ol class="steps">${a.timeline.map(e => `<li><strong>${esc(e.type)}</strong><p>Recorded ${esc(e.recordedAt)} · ${esc(e.orderBasis)} · append ${esc(e.appendSequence)}</p><p>Business occurrence ${esc(e.occurredAt)}</p><p>${esc(e.detail)}</p></li>`).join('')}</ol><h3>API-selected rollback targets</h3>${a.rollbackTargets.length ? facts(a.rollbackTargets.map(t => [t.deploymentId, t.reason])) : '<p>No eligible rollback target returned.</p>'}`;
    }
    else {
        const records = p.deployments ?? p.candidates ?? p.contracts ?? (p.run ? [p.run] : []);
        body = records.length ? records.map(r => `<details><summary>${esc(r.deployment?.deploymentId ?? r.candidateId ?? r.contractId ?? r.runId ?? 'Product record')}</summary>${facts(Object.entries(r.deployment??r).filter(([, v]) => v === null || typeof v !== 'object'))}${r.decision?facts(Object.entries(r.decision).map(([k,v])=>[k,Array.isArray(v)?v.join(' · '):v])):''}${r.blockers?facts([['Blockers',r.blockers.join(' · ')]]):''}${raw(r)}</details>`).join('') : '<p class="empty">No records returned. Register and qualify through your authorized operational workflow.</p>';
    }
    $('read-result').innerHTML = body + raw(p);
}
catch (e) {
    status.textContent = e.message + ' No protected record was confirmed.';
    status.setAttribute('role','alert');status.dataset.state = 'failed';
}
finally {
    Array.from(form.elements).forEach(e=>e.disabled=false);
} }

// Keep Tab cycling within the modal, including browsers that move focus to chrome.
$('inspector').addEventListener('keydown', event => {
    if(event.key !== 'Tab') return;
    const controls = [...$('inspector').querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

// Keep the existing canonical portfolio acceptance surface backed by Product API data.
function renderOperationalCases() {
    const destinations = {CASE_A:'release',CASE_B:'assurance',CASE_C:'candidates',CASE_D:'audit'};
    $('portfolio-content').innerHTML = '<ul class="rule-list">'+portfolio.cases.map(item=>
      `<li><a href="#${destinations[item.id]}">${esc(item.id)} · ${esc(item.title)}</a><p>${esc(item.claimScope)} · ${esc(item.outcome)}</p></li>`).join('')+'</ul>';
    $('verification-scenarios').innerHTML = '<ul class="rule-list">'+portfolio.cases.map(item=>
      `<li><strong>${esc(item.id)} · ${esc(item.title)}</strong><p>${esc(item.claimScope)} · ${esc(item.outcome)}</p><p>${esc(item.judgeTakeaway)}</p></li>`).join('')+'</ul>';
}
