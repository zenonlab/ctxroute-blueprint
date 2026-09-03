/* global CSS, FormData, document, fetch */
const TOKEN_STORAGE_KEY = 'progress-dashboard-token';
export function initializeDashboardToken(browser = globalThis) {
  if (!browser.document) return '';
  let fragment = '';
  let stored = '';
  try { fragment = decodeURIComponent(browser.location.hash.slice(1)); } catch {}
  try { stored = browser.sessionStorage.getItem(TOKEN_STORAGE_KEY) || ''; } catch {}
  if (fragment) {
    try { browser.sessionStorage.setItem(TOKEN_STORAGE_KEY, fragment); } catch {}
    browser.history.replaceState(null, '', browser.location.pathname);
  }
  return fragment || stored;
}
const inBrowser = typeof document !== 'undefined';
const token = initializeDashboardToken();
let revision = '';
let progress = { goals: [] };
const histories = new Map();
const timers = new Map();
let dragged = null;
let deleted = null;
let toastTimer;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const splitLines = value => value.split('\n').map(item => item.trim()).filter(Boolean);
const slug = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 64).replace(/-$/u, '') || 'step';

function notice(message, error = false) { const node = $('#notice'); node.textContent = message; node.className = error ? 'error' : ''; }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'X-Progress-Token': token, 'Content-Type': 'application/json', ...options.headers } });
  const value = await response.json().catch(() => ({ error: 'Invalid response' }));
  if (response.status === 409) { await reloadPreservingDrafts(); throw new Error('Revision conflict: draft preserved'); }
  if (!response.ok) throw new Error(value.error || 'Dashboard error');
  return value;
}
async function load() { try { applyServer(await request('/api/progress')); notice('Up to date'); } catch (error) { notice(error.message, true); } }
function applyServer(value) { progress = value.progress; revision = value.revision; render(); }
function retainView(value) { progress = value.progress; revision = value.revision; }
function collectDrafts() { return $$('[data-step-card]').map(card => ({ goalId: card.dataset.goal, stepId: card.dataset.step, value: snapshot(card), open: !$('.step-details', card).hidden })); }
async function reloadPreservingDrafts() {
  const drafts = collectDrafts();
  const response = await fetch('/api/progress', { headers: { 'X-Progress-Token': token, 'Content-Type': 'application/json' } });
  applyServer(await response.json());
  for (const draft of drafts) {
    const card = document.querySelector(`[data-step-card][data-goal="${CSS.escape(draft.goalId)}"][data-step="${CSS.escape(draft.stepId)}"]`);
    if (card) { restore(card, draft.value); setOpen(card, draft.open); setSaveState(card, 'Modified'); }
  }
}
function listEditor(name, label, values) { return `<label class="field ${['acceptance', 'evidence'].includes(name) ? 'wide' : ''}">${label}<span class="line-editor"><span class="gutter" aria-hidden="true"></span><textarea data-field="${name}" aria-label="${label}" spellcheck="false">${escapeHtml(values.join('\n'))}</textarea></span></label>`; }
function stepCard(goal, step) {
  const options = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map(status => `<option${status === step.status ? ' selected' : ''}>${status}</option>`).join('');
  const disabled = goal.steps.length === 1 ? ' disabled title="At least one step is required"' : '';
  return `<article class="step" draggable="true" data-step-card data-goal="${escapeHtml(goal.id)}" data-step="${escapeHtml(step.id)}"><div class="step-header"><button class="drag-handle" type="button" aria-label="Move ${escapeHtml(step.title)}" title="Drag or use Alt + arrow keys">⠿</button><h3 class="step-heading">${escapeHtml(step.title)}</h3><select class="status" aria-label="Status of ${escapeHtml(step.title)}" data-status>${options}</select><button class="toggle" type="button" aria-expanded="false" aria-label="Show details"><span class="chevron" aria-hidden="true"></span></button></div><div class="step-details" hidden><div class="fields"><label class="field wide">Title<input data-field="title" maxlength="500" value="${escapeHtml(step.title)}"></label>${listEditor('acceptance', 'Acceptance criteria — one entry per line', step.acceptance)}${listEditor('files', 'Files — one entry per line', step.files)}${listEditor('commands', 'Commands — one entry per line', step.commands)}${listEditor('evidence', 'Evidence — one entry per line', step.evidence)}</div><p class="field-error" data-error role="alert"></p><footer class="card-footer"><span class="save-state">Saved</span><div class="step-actions"><span class="history-actions"><button type="button" data-undo disabled>Undo</button><button type="button" data-redo disabled>Redo</button></span><button type="button" class="danger" data-delete${disabled}>Delete</button></div></footer></div></article>`;
}
function executionMode(mode) { return mode === 'manual' || mode === 'collaborative' ? 'manual' : 'automatic'; }
function goalView(goal) {
  const mode = executionMode(goal.executionMode);
  const collapsed = goal.status === 'DONE';
  return `<article class="goal${collapsed ? ' goal-complete' : ''}" data-goal-card="${escapeHtml(goal.id)}"><header class="goal-header"><div class="goal-title"><p class="eyebrow">${escapeHtml(goal.id)} · ${escapeHtml(goal.status)}</p><label class="goal-title-field"><span>Goal name <i aria-hidden="true">✎</i></span><input data-goal-title maxlength="500" value="${escapeHtml(goal.title)}"></label><span class="save-state" data-goal-save>Saved</span></div><div class="goal-actions"><label>Mode <select data-mode><option${mode === 'automatic' ? ' selected' : ''}>automatic</option><option${mode === 'manual' ? ' selected' : ''}>manual</option></select></label><span class="mode-wrap"><button class="mode-help quiet" type="button" aria-describedby="mode-help-${escapeHtml(goal.id)}">?</button><span class="tooltip" role="tooltip" id="mode-help-${escapeHtml(goal.id)}"><b>automatic</b>: continue through normal implementation and verification.<br><b>manual</b>: pause only for a visual review or an important product/design decision.<br>Mode never changes permissions.</span></span><button class="goal-toggle" type="button" aria-expanded="${String(!collapsed)}" aria-label="${collapsed ? 'Show' : 'Hide'} steps"><span class="chevron" aria-hidden="true"></span></button></div></header><div data-goal-content${collapsed ? ' hidden' : ''}><section class="steps" aria-label="Steps for ${escapeHtml(goal.title)}">${goal.steps.map(step => stepCard(goal, step)).join('')}</section>${addStep(goal)}</div></article>`;
}
function addStep(goal) { return `<details class="add-step"><summary>+ Add a step</summary><form class="add-form" data-add-step data-goal="${escapeHtml(goal.id)}"><label>Title<input name="title" maxlength="500" required></label><label>Immutable ID<input name="id" pattern="[a-z][a-z0-9-]{0,63}" required></label><label>First acceptance criterion<input name="acceptance" maxlength="500" required></label><label>First file<input name="file" maxlength="500"></label><label>First command<input name="command" maxlength="500"></label><div class="dialog-actions"><button class="primary" type="submit">Create</button></div><p class="field-error" data-add-error></p></form></details>`; }
function render() { const showDone = $('#show-done').checked; $('#show-done-label').textContent = `${showDone ? 'Hide' : 'Show'} completed goals`; const goals = progress.goals.filter(goal => showDone || goal.status !== 'DONE'); const empty = progress.goals.length ? '<div class="empty"><strong>All goals are complete.</strong><p>You can review them without reopening them.</p><button type="button" data-show-completed>Show completed goals</button></div>' : '<div class="empty"><strong>No approved plans.</strong><p>Create a plan to start tracking progress.</p></div>'; $('#goals').innerHTML = goals.length ? goals.map(goalView).join('') : empty; $$('[data-step-card]').forEach(card => { initializeHistory(card); updateGutters(card); }); }
function snapshot(card) { return Object.fromEntries(['title', 'acceptance', 'files', 'commands', 'evidence'].map(name => [name, $(`[data-field="${name}"]`, card).value])); }
function restore(card, value) { for (const [name, text] of Object.entries(value)) $(`[data-field="${name}"]`, card).value = text; $('.step-heading', card).textContent = value.title; updateGutters(card); }
function historyKey(card) { return `${card.dataset.goal}/${card.dataset.step}`; }
function initializeHistory(card) { const key = historyKey(card); if (!histories.has(key)) histories.set(key, { entries: [snapshot(card)], index: 0 }); updateHistoryButtons(card); }
function recordHistory(card) { const history = histories.get(historyKey(card)); const value = snapshot(card); if (JSON.stringify(history.entries[history.index]) === JSON.stringify(value)) return; history.entries.splice(history.index + 1); history.entries.push(value); if (history.entries.length > 100) history.entries.shift(); history.index = history.entries.length - 1; updateHistoryButtons(card); }
function moveHistory(card, delta) { const history = histories.get(historyKey(card)); const next = history.index + delta; if (next < 0 || next >= history.entries.length) return; history.index = next; restore(card, history.entries[next]); updateHistoryButtons(card); markModified(card); scheduleSave(card); }
function updateHistoryButtons(card) { const history = histories.get(historyKey(card)); $('[data-undo]', card).disabled = history.index === 0; $('[data-redo]', card).disabled = history.index === history.entries.length - 1; }
function updateGutters(root) { $$('textarea[data-field]', root).forEach(area => { const gutter = area.previousElementSibling; gutter.textContent = Array.from({ length: Math.max(1, area.value.split('\n').length) }, (_, index) => index + 1).join('\n'); gutter.scrollTop = area.scrollTop; }); }
function setOpen(card, open) { $('.step-details', card).hidden = !open; const button = $('.toggle', card); button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-label', open ? 'Hide details' : 'Show details'); }
function setGoalOpen(goal, open) { $('[data-goal-content]', goal).hidden = !open; const button = $('.goal-toggle', goal); button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} steps`); }
function setSaveState(card, text, error = false) { const node = $('.save-state', card); node.textContent = text; node.classList.toggle('error', error); }
function markModified(card) { setSaveState(card, 'Modified'); $('[data-error]', card).textContent = ''; }
function scheduleSave(card) { clearTimeout(timers.get(historyKey(card))); timers.set(historyKey(card), setTimeout(() => saveCard(card), 500)); }
async function saveCard(card) { const value = snapshot(card); setSaveState(card, 'Saving…'); try { retainView(await request(`/api/goals/${encodeURIComponent(card.dataset.goal)}/steps/${encodeURIComponent(card.dataset.step)}`, { method: 'PATCH', body: JSON.stringify({ revision, title: value.title, acceptance: splitLines(value.acceptance), files: splitLines(value.files), commands: splitLines(value.commands), evidence: splitLines(value.evidence) }) })); setSaveState(card, 'Saved'); notice('Step saved'); } catch (error) { setSaveState(card, error.message, true); $('[data-error]', card).textContent = error.message; } }
async function updateStatus(card, select) { const previous = progress.goals.find(goal => goal.id === card.dataset.goal)?.steps.find(step => step.id === card.dataset.step)?.status; const evidence = splitLines($('[data-field="evidence"]', card).value); if (select.value === 'DONE' && evidence.length === 0) { select.value = previous; setOpen(card, true); $('[data-error]', card).textContent = 'Add evidence before marking this step DONE.'; $('[data-field="evidence"]', card).focus(); return; } try { applyServer(await request(`/api/goals/${encodeURIComponent(card.dataset.goal)}/steps/${encodeURIComponent(card.dataset.step)}`, { method: 'PATCH', body: JSON.stringify({ revision, status: select.value, evidence }) })); notice('Status saved'); } catch (error) { select.value = previous; notice(error.message, true); } }
function confirmAction(title, description, label = 'Confirm') { const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; const confirm = $('button[value="confirm"]', dialog); confirm.textContent = label; dialog.showModal(); confirm.focus(); return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); }); }
async function changeMode(select) { const goal = select.closest('[data-goal-card]'); const current = executionMode(progress.goals.find(item => item.id === goal.dataset.goalCard).executionMode); try { applyServer(await request(`/api/goals/${encodeURIComponent(goal.dataset.goalCard)}/mode`, { method: 'PATCH', body: JSON.stringify({ revision, mode: select.value }) })); notice('Mode saved'); } catch (error) { select.value = current; notice(error.message, true); } }
function scheduleGoalTitle(input) { const card = input.closest('[data-goal-card]'); const key = `goal/${card.dataset.goalCard}`; $('[data-goal-save]', card).textContent = 'Modified'; clearTimeout(timers.get(key)); timers.set(key, setTimeout(async () => { const state = $('[data-goal-save]', card); state.textContent = 'Saving…'; try { retainView(await request(`/api/goals/${encodeURIComponent(card.dataset.goalCard)}`, { method: 'PATCH', body: JSON.stringify({ revision, title: input.value }) })); state.textContent = 'Saved'; notice('Goal saved'); } catch (error) { state.textContent = error.message; state.classList.add('error'); } }, 500)); }
async function addNewStep(form) { const data = new FormData(form); const step = { id: data.get('id'), title: data.get('title'), acceptance: [data.get('acceptance')].filter(Boolean), files: [data.get('file')].filter(Boolean), commands: [data.get('command')].filter(Boolean) }; try { applyServer(await request(`/api/goals/${encodeURIComponent(form.dataset.goal)}/steps`, { method: 'POST', body: JSON.stringify({ revision, step }) })); notice('Step created'); } catch (error) { $('[data-add-error]', form).textContent = error.message; } }
async function deleteStep(card) { if (!await confirmAction('Delete this step?', `“${$('.step-heading', card).textContent}” will be removed from the goal.`, 'Delete')) return; const goal = progress.goals.find(item => item.id === card.dataset.goal); const step = goal.steps.find(item => item.id === card.dataset.step); const order = goal.steps.map(item => item.id); try { applyServer(await request(`/api/goals/${encodeURIComponent(goal.id)}/steps/${encodeURIComponent(step.id)}`, { method: 'DELETE', body: JSON.stringify({ revision }) })); deleted = { goalId: goal.id, step, order }; showToast('Step deleted'); } catch (error) { notice(error.message, true); } }
function showToast(message) { clearTimeout(toastTimer); const toast = $('#toast'); $('span', toast).textContent = message; toast.hidden = false; toastTimer = setTimeout(() => { toast.hidden = true; deleted = null; }, 8000); }
async function restoreDeleted() { if (!deleted) return; const item = deleted; deleted = null; $('#toast').hidden = true; try { let value = await request(`/api/goals/${encodeURIComponent(item.goalId)}/steps`, { method: 'POST', body: JSON.stringify({ revision, step: item.step }) }); revision = value.revision; progress = value.progress; value = await request(`/api/goals/${encodeURIComponent(item.goalId)}/steps/order`, { method: 'PUT', body: JSON.stringify({ revision, stepIds: item.order }) }); applyServer(value); notice('Step restored'); } catch (error) { notice(error.message, true); } }
async function persistOrder(goalId, ids) { try { applyServer(await request(`/api/goals/${encodeURIComponent(goalId)}/steps/order`, { method: 'PUT', body: JSON.stringify({ revision, stepIds: ids }) })); notice('Order saved'); } catch (error) { notice(error.message, true); } }
function moveCard(card, delta) { const container = card.parentElement; const cards = $$('[data-step-card]', container); const target = cards[cards.indexOf(card) + delta]; if (!target) return; if (delta < 0) container.insertBefore(card, target); else container.insertBefore(target, card); persistOrder(card.dataset.goal, $$('[data-step-card]', container).map(item => item.dataset.step)); card.querySelector('.drag-handle').focus(); }

if (inBrowser) {
$('#show-done').addEventListener('change', render);
$('#refresh').addEventListener('click', load);
$('#goals').addEventListener('click', event => { const card = event.target.closest('[data-step-card]'); const goal = event.target.closest('[data-goal-card]'); if (event.target.closest('[data-show-completed]')) { $('#show-done').checked = true; render(); } else if (event.target.closest('.goal-toggle') && goal) setGoalOpen(goal, $('[data-goal-content]', goal).hidden); else if (event.target.closest('.toggle') && card) setOpen(card, $('.step-details', card).hidden); else if (event.target.closest('[data-undo]') && card) moveHistory(card, -1); else if (event.target.closest('[data-redo]') && card) moveHistory(card, 1); else if (event.target.closest('[data-delete]') && card) deleteStep(card); });
$('#goals').addEventListener('input', event => { const card = event.target.closest('[data-step-card]'); if (event.target.matches('[data-field]') && card) { if (event.target.matches('textarea')) updateGutters(card); if (event.target.dataset.field === 'title') $('.step-heading', card).textContent = event.target.value; recordHistory(card); markModified(card); scheduleSave(card); } else if (event.target.matches('[data-goal-title]')) scheduleGoalTitle(event.target); else if (event.target.matches('[data-add-step] input[name="title"]')) { const id = event.target.form.elements.id; if (!id.dataset.edited) id.value = slug(event.target.value); } else if (event.target.matches('[data-add-step] input[name="id"]')) event.target.dataset.edited = 'true'; });
$('#goals').addEventListener('change', event => { const card = event.target.closest('[data-step-card]'); if (event.target.matches('[data-status]') && card) updateStatus(card, event.target); else if (event.target.matches('[data-mode]')) changeMode(event.target); });
$('#goals').addEventListener('submit', event => { if (event.target.matches('[data-add-step]')) { event.preventDefault(); addNewStep(event.target); } });
$('#goals').addEventListener('scroll', event => { if (event.target.matches('textarea[data-field]')) event.target.previousElementSibling.scrollTop = event.target.scrollTop; }, true);
$('#goals').addEventListener('keydown', event => { const card = event.target.closest('[data-step-card]'); if (card && event.target.closest('.drag-handle') && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); moveCard(card, event.key === 'ArrowUp' ? -1 : 1); } else if (card && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); moveHistory(card, event.shiftKey ? 1 : -1); } });
$('#goals').addEventListener('pointerdown', event => { const handle = event.target.closest('.drag-handle'); if (handle) handle.closest('[data-step-card]').dataset.dragReady = 'true'; });
$('#goals').addEventListener('pointerup', event => { const card = event.target.closest('[data-step-card]'); if (card && card !== dragged) delete card.dataset.dragReady; });
$('#goals').addEventListener('dragstart', event => { const card = event.target.closest('[data-step-card]'); if (!card?.dataset.dragReady) { event.preventDefault(); return; } dragged = card; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; });
$('#goals').addEventListener('dragover', event => { const card = event.target.closest('[data-step-card]'); if (!dragged || !card || card === dragged || card.dataset.goal !== dragged.dataset.goal) return; event.preventDefault(); $$('.drop-before').forEach(item => item.classList.remove('drop-before')); card.classList.add('drop-before'); });
$('#goals').addEventListener('drop', event => { const target = event.target.closest('[data-step-card]'); if (!dragged || !target || target === dragged) return; event.preventDefault(); if (event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2) target.after(dragged); else target.before(dragged); persistOrder(dragged.dataset.goal, $$('[data-step-card]', target.parentElement).map(item => item.dataset.step)); });
$('#goals').addEventListener('dragend', () => { $$('.dragging,.drop-before').forEach(item => item.classList.remove('dragging', 'drop-before')); if (dragged) delete dragged.dataset.dragReady; dragged = null; });
$('#toast button').addEventListener('click', restoreDeleted);
$('#new-plan').addEventListener('click', () => $('#plan-dialog').showModal());
$('#cancel-plan').addEventListener('click', () => $('#plan-dialog').close());
$('#plan-form').addEventListener('submit', async event => { event.preventDefault(); const errorNode = $('[data-plan-error]'); errorNode.textContent = ''; try { const plan = JSON.parse(new FormData(event.target).get('plan')); const checked = await request('/api/plans/validate', { method: 'POST', body: JSON.stringify({ revision, plan }) }); if (!checked.validation.ok) throw new Error(checked.validation.errors.join(' · ')); applyServer(await request('/api/plans/approve', { method: 'POST', body: JSON.stringify({ revision, plan: { ...plan, approved: true } }) })); $('#plan-dialog').close(); event.target.reset(); notice('Plan created'); } catch (error) { errorNode.textContent = error.message; } });
load();
}

export { request };
