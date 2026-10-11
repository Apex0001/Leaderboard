const REFRESH_INTERVAL = 15 * 60 * 1000;
const podium = document.querySelector('#podium');
const rankingBody = document.querySelector('#ranking-body');
const searchInput = document.querySelector('#search-input');
const refreshButton = document.querySelector('#refresh-button');
const toast = document.querySelector('#toast');
const manageButton = document.querySelector('#manage-button');
const manageToolbar = document.querySelector('#manage-toolbar');
const adminDialog = document.querySelector('#admin-dialog');
const adminForm = document.querySelector('#admin-form');
const addFields = document.querySelector('#add-fields');
const adminError = document.querySelector('#admin-error');
const adminPassword = document.querySelector('#admin-password');
const participantName = document.querySelector('#participant-name');
const participantProfile = document.querySelector('#participant-profile');
const submitAdminAction = document.querySelector('#submit-admin-action');
let adminMode = false;
let pendingAction = 'add';
let deleteTarget = null;
let participants = [];
let refreshTimer;
let toastTimer;
let maxSolved = 1;

const numberFormat = new Intl.NumberFormat('en-IN');
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?'; }
function avatarFallback(name) {
  const label = initials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="#252832"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#d7dae2">${label}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function avatarHtml(person, className) {
  const fallback = avatarFallback(person.name);
  const source = person.avatar || fallback;
  return `<img class="${className}" src="${escapeHtml(source)}" data-fallback="${escapeHtml(fallback)}" alt="${escapeHtml(person.name)} profile picture" loading="lazy">`;
}
function attachAvatarFallbacks(root = document) {
  root.querySelectorAll('img[data-fallback]').forEach(img => {
    img.addEventListener('error', () => {
      if (img.src !== img.dataset.fallback) img.src = img.dataset.fallback;
    }, { once: true });
  });
}
function profileLink(person, content, className = '') {
  return `<a class="${className}" href="${escapeHtml(person.profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(person.name)}'s LeetCode profile">${content}</a>`;
}
function podiumCard(person, place) {
  const classes = { 1: 'first', 2: 'second', 3: 'third' };
  const labels = {1: ['♛', 'CHAMPION'], 2: ['Ⅱ', '2ND PLACE'], 3: ['Ⅲ', '3RD PLACE']};
  const [symbol, label] = labels[place];
  const score = person.solved == null ? '—' : numberFormat.format(person.solved);
  return `<article class="podium-card ${classes[place]}">
    <div class="medal-label"><span class="medal-symbol">${symbol}</span>${label}</div>
    ${profileLink(person, avatarHtml(person, 'podium-avatar'))}
    ${profileLink(person, `<h3 class="person-name">${escapeHtml(person.name)}</h3>`)}
    <div class="person-handle">@${escapeHtml(person.username)}</div>
    <div class="score-number">${score}</div><div class="score-caption">PROBLEMS SOLVED</div>
    <div class="podium-base">${String(place).padStart(2, '0')}</div>
    <button class="delete-participant-button podium-delete" type="button" data-delete-username="${escapeHtml(person.username)}" data-delete-name="${escapeHtml(person.name)}" aria-label="Delete ${escapeHtml(person.name)}">Delete account</button>
  </article>`;
}
function renderPodium() {
  const leaders = participants.filter(p => p.solved != null).slice(0, 3);
  if (!leaders.length) {
    podium.innerHTML = '<div class="table-message">Top performers will appear when LeetCode profile data is available.</div>';
    return;
  }
  const order = [leaders[1], leaders[0], leaders[2]].filter(Boolean);
  podium.innerHTML = order.map(person => podiumCard(person, leaders.indexOf(person) + 1)).join('');
  attachAvatarFallbacks(podium);
}
function renderTable() {
  const query = searchInput.value.trim().toLowerCase();
  const allRanked = participants.filter(p => p.solved != null);
  maxSolved = Math.max(1, ...allRanked.map(p => p.solved || 0));
  const filtered = participants.filter((p, index) => index >= 3 && `${p.name} ${p.username}`.toLowerCase().includes(query));
  if (!filtered.length) {
    rankingBody.innerHTML = '<tr><td colspan="6" class="table-message">No participants match that search.</td></tr>';
  } else {
    rankingBody.innerHTML = filtered.map(person => {
      const rank = person.rank == null ? '—' : String(person.rank).padStart(2, '0');
      const solved = person.solved == null ? '<span class="solved-value unavailable">Unavailable</span>' : `<span class="solved-value">${numberFormat.format(person.solved)}</span>`;
      const progress = person.solved == null ? '' : `<div class="progress-track" aria-label="${Math.round(person.solved / maxSolved * 100)} percent of leader's score"><div class="progress-fill" style="width:${Math.max(2, person.solved / maxSolved * 100)}%"></div></div>`;
      return `<tr><td class="rank-col"><span class="rank-number">${rank}</span></td><td><div class="participant-cell">${profileLink(person, avatarHtml(person, 'table-avatar'))}<div class="participant-text">${profileLink(person, escapeHtml(person.name), 'participant-name')}<span class="participant-handle">@${escapeHtml(person.username)}</span></div></div></td><td>${solved}</td><td class="progress-col">${progress}</td><td>${profileLink(person, '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>', 'profile-link')}</td><td class="admin-action-cell"><button class="delete-participant-button" type="button" data-delete-username="${escapeHtml(person.username)}" data-delete-name="${escapeHtml(person.name)}">Delete</button></td></tr>`;
    }).join('');
  }
  document.querySelector('#showing-count').textContent = `Showing ${filtered.length} of ${participants.length} participants`;
  document.body.classList.toggle('manage-mode', adminMode);
  attachAvatarFallbacks(rankingBody);
}
function renderStats(updatedAt) {
  document.querySelector('#total-people').textContent = numberFormat.format(participants.length);
  const solved = participants.filter(p => p.solved != null).reduce((sum, p) => sum + p.solved, 0);
  const available = participants.filter(p => p.solved != null).length;
  document.querySelector('#total-solved').textContent = available ? numberFormat.format(solved) : '—';
  const date = updatedAt ? new Date(updatedAt) : new Date();
  document.querySelector('#last-updated').textContent = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.querySelector('#next-update').textContent = `${available}/${participants.length} profiles available`;
  const isOnline = available > 0;
  document.querySelector('#live-label').textContent = isOnline ? 'LIVE DATA' : 'DATA UNAVAILABLE';
  document.querySelector('.live-dot').classList.toggle('offline', !isOnline);
}
function renderAll(updatedAt) { renderPodium(); renderTable(); renderStats(updatedAt); }
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
async function loadLeaderboard({ manual = false } = {}) {
  refreshButton.classList.add('spinning');
  refreshButton.disabled = true;
  try {
    const response = await fetch('/api/leaderboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    participants = data.participants || [];
    renderAll(data.updatedAt);
    if (manual) showToast('Leaderboard refreshed.');
  } catch (error) {
    document.querySelector('#live-label').textContent = 'CONNECTION ISSUE';
    document.querySelector('.live-dot').classList.add('offline');
    if (!participants.length) {
      rankingBody.innerHTML = '<tr><td colspan="6" class="table-message">Could not load the leaderboard. Make sure the Node.js server is running, then refresh.</td></tr>';
      podium.innerHTML = '<div class="table-message">Waiting for leaderboard data…</div>';
    }
    if (manual) showToast('Could not refresh. Check the server connection.');
    console.error('Leaderboard fetch failed:', error);
  } finally {
    refreshButton.classList.remove('spinning');
    refreshButton.disabled = false;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadLeaderboard(), REFRESH_INTERVAL);
  }
}
searchInput.addEventListener('input', renderTable);
refreshButton.addEventListener('click', () => loadLeaderboard({ manual: true }));
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault(); searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = ''; renderTable(); searchInput.blur();
  }
});
function openAdminDialog(action, person = null) {
  pendingAction = action;
  deleteTarget = person;
  adminForm.reset();
  adminError.hidden = true;
  adminError.textContent = '';
  const isAdd = action === 'add';
  addFields.hidden = !isAdd;
  participantName.required = isAdd;
  participantProfile.required = isAdd;
  document.querySelector('#admin-dialog-title').innerHTML = isAdd ? 'Add participant<span class="heading-period">.</span>' : `Delete participant<span class="heading-period">.</span>`;
  document.querySelector('#admin-dialog-description').textContent = isAdd
    ? 'Add a LeetCode account to the live leaderboard.'
    : `Remove ${person?.name || 'this participant'} from the leaderboard? This cannot be undone.`;
  submitAdminAction.textContent = isAdd ? 'Add participant' : 'Delete account';
  submitAdminAction.classList.toggle('danger-button', !isAdd);
  submitAdminAction.classList.toggle('primary-button', isAdd);
  if (person) { participantName.value = person.name; participantProfile.value = person.profileUrl; }
  adminDialog.showModal();
  if (isAdd) participantName.focus(); else adminPassword.focus();
}
function closeAdminDialog() { adminDialog.close(); adminForm.reset(); }
manageButton.addEventListener('click', () => {
  adminMode = !adminMode;
  manageToolbar.hidden = !adminMode;
  manageButton.setAttribute('aria-expanded', String(adminMode));
  manageButton.textContent = adminMode ? 'Hide controls' : 'Manage accounts';
  renderPodium(); renderTable();
});
document.querySelector('#add-participant-button').addEventListener('click', () => openAdminDialog('add'));
document.querySelector('#close-admin-dialog').addEventListener('click', closeAdminDialog);
document.querySelector('#cancel-admin-dialog').addEventListener('click', closeAdminDialog);
adminDialog.addEventListener('click', event => { if (event.target === adminDialog) closeAdminDialog(); });
document.addEventListener('click', event => {
  const button = event.target.closest('[data-delete-username]');
  if (!button || !adminMode) return;
  openAdminDialog('delete', {
    username: button.dataset.deleteUsername,
    name: button.dataset.deleteName,
    profileUrl: `https://leetcode.com/u/${encodeURIComponent(button.dataset.deleteUsername)}/`
  });
});
adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminError.hidden = true;
  submitAdminAction.disabled = true;
  submitAdminAction.textContent = pendingAction === 'add' ? 'Adding…' : 'Deleting…';
  const payload = { password: adminPassword.value };
  let url = '/api/admin/participants';
  let method = 'POST';
  if (pendingAction === 'add') {
    payload.name = participantName.value.trim();
    payload.profileUrl = participantProfile.value.trim();
  } else {
    method = 'DELETE';
    url += `/${encodeURIComponent(deleteTarget.username)}`;
  }
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The action could not be completed.');
    closeAdminDialog();
    showToast(result.message || 'Changes saved.');
    await loadLeaderboard();
  } catch (error) {
    adminError.textContent = error.message || 'Could not save changes.';
    adminError.hidden = false;
    adminPassword.value = '';
    adminPassword.focus();
  } finally {
    submitAdminAction.disabled = false;
    submitAdminAction.textContent = pendingAction === 'add' ? 'Add participant' : 'Delete account';
  }
});

loadLeaderboard();
