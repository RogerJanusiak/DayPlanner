// ════════════════════════════════════════════════════════════
//  CONSTANTS & STATE
// ════════════════════════════════════════════════════════════
const STORAGE_KEY = 'dayplanner_v7';
const CIRC = 2 * Math.PI * 44; // r=44 for timer ring

let state = {
  projects: [{
      id: 'deep-work',
      name: 'Deep Work',
      color: '#C2410C',
      emoji: '🧠'
    },
    {
      id: 'email',
      name: 'Email & Comms',
      color: '#1D4ED8',
      emoji: '📬'
    },
    {
      id: 'meetings',
      name: 'Meetings',
      color: '#6D28D9',
      emoji: '🤝'
    },
    {
      id: 'admin',
      name: 'Admin',
      color: '#047857',
      emoji: '📋'
    },
    {
      id: 'break',
      name: 'Break',
      color: '#92400E',
      emoji: '☕'
    },
  ],
  days: {},
  settings: {
    dailyGoal: 8,
    defaultBlockDuration: 30
  },
  projectTodos: {},
  projNotes: {},
  timerState: {
    activeBlock: null,
    startedAt: null,
    elapsedMs: 0,
    date: null
  }
  // projectTodos[projId] = [{id, text, done, doneDate, history:[{date, type:'done'|'progress', blockIdx}]}]
};
let ui = {
  currentDate: todayStr(),
  activeBlock: null,
  timerStartedAt: null,
  timerElapsedMs: 0,
  timerRunning: false,
  timerInterval: null,
  clockInterval: null,
  openDropdown: null,
  editingProjId: null,
  tab: 'plan',
  notesBlockIdx: null,
  notesDate: null,
  dragSrcIdx: null, // block-to-block drag
  dragProjId: null, // project-from-sidebar drag
  openProjTodosIds: null, // Set of expanded project todo group ids (null = all open)
  notesTabProjId: null, // selected project in Notes tab
  notesTabImportanceFilter: 0, // 0=All, 1-5=exact star rating
  notesTabTagFilter: [], // [] = All, else array of selected tag IDs
  notesTabMeetingFilter: false, // false=All, true=meetings only
  notesTabLeftOffFilter: false, // true=only show entries with left-off note
  notesTabImageFilter: false, // true=only show entries with embedded images
  notesIsStandalone: false, // true when modal is for a standalone project note
  notesProjId: null, // project id for standalone note modal
  notesStandaloneId: null, // id of existing standalone note being edited (null = new)
  focusBlock: null, // block idx shown in focus view
  notesLivePreview: true,
  soundMuted: false,
  pivot: null, // { blockA, blockB, activeSlot: 'A'|'B', elapsedA, elapsedB }
};

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateFromStr(ds) {
  return new Date(ds + 'T12:00:00')
}

function isWeekend(ds) {
  const d = dateFromStr(ds).getDay();
  return d === 0 || d === 6
}

function formatDateLabel(ds) {
  return dateFromStr(ds).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).toUpperCase()
}

function formatTime(h, half) {
  const hr = h % 12 || 12,
    ap = h < 12 ? 'AM' : 'PM';
  return `${hr}:${half?'30':'00'} ${ap}`
}

function formatSecs(s) {
  s = Math.max(0, Math.floor(s));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  }
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
}

function setDay(ds, data) {
  state.days[ds] = data
}

function currentDayData() {
  return getDay(ui.currentDate)
}

const BREAK_PROJ = { id: '__break__', name: 'Break', emoji: '☕', color: 'var(--muted)' };
const ARCHIVED_PROJ = { id: '__archived__', name: 'Archived', emoji: '🗃', color: 'var(--faint)' };

function getProject(id) {
  if (id === '__break__') return BREAK_PROJ;
  if (id === '__archived__') return ARCHIVED_PROJ;
  return state.projects.find(p => p.id === id);
}

function sortedDays() {
  return Object.keys(state.days).sort().reverse()
}

function isToday() {
  return ui.currentDate === todayStr()
}

function blockToTime(idx) {
  return [Math.floor(idx / 2) + 6, idx % 2]
}

function blockSequentialNum(blockIdx, ds) {
  const day = getDay(ds || ui.currentDate);
  const sched = day.schedule || {};
  const blockSpan = day.blockSpan || {};
  const spannedSlots = new Set();
  Object.entries(blockSpan).forEach(([startIdx, span]) => {
    for (let i = 1; i < span; i++) spannedSlots.add(+startIdx + i);
  });
  const starts = Object.keys(sched).map(Number).filter(i => !spannedSlots.has(i)).sort((a, b) => a - b);
  const pos = starts.indexOf(blockIdx);
  return pos >= 0 ? pos + 1 : null;
}

function escAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getTimerRemaining() {
  const dur = getBlockDuration(ui.activeBlock);
  const ms = ui.timerRunning ? ui.timerElapsedMs + (Date.now() - ui.timerStartedAt) : ui.timerElapsedMs;
  return Math.max(0, dur - ms / 1000);
}

function blockHasContent(idx, ds) {
  const n = ((state.days[ds || ui.currentDate] || {}).blockNotes || {})[idx];
  return n && ((n.note || '').trim() || (n.todos || []).length);
}

function currentHourFrac() {
  const n = new Date();
  return n.getHours() + n.getMinutes() / 60
}

// Count completed blocks as visual units (1-hour block = 1, not 2)
// Count done blocks the way the user sees them: each 1h block counts as 2.
// We iterate completed start-slots (skipping spanned continuation slots) and
// add the block's span, so a 1h start with span=2 contributes 2 even if its
// second slot is absent from completed (historical data inconsistency).
function countDoneBlocks(day) {
  const spans = day.blockSpan || {};
  const spanned = new Set();
  Object.entries(spans).forEach(([si, span]) => {
    for (let i = 1; i < span; i++) spanned.add(+si + i);
  });
  let count = 0;
  for (const idx of (day.completed || [])) {
    if (spanned.has(idx)) continue;
    count += spans[idx] || 1;
  }
  return count;
}

function dailyGoal() {
  return Math.max(1, +(state.settings.dailyGoal) || 8)
}
function dailyGoalForDay(ds) {
  const d = state.days[ds];
  if (d && d.dailyGoal) return Math.max(1, d.dailyGoal);
  return dailyGoal();
}

// ════════════════════════════════════════════════════════════
//  STREAK (weekends & time-off aware)
// ════════════════════════════════════════════════════════════
function computeStreak() {
  // Count consecutive days (any day of week) with >= 1 completed block.
  // Time-off days are skipped (don't count, don't break).
  // Empty weekends are also skipped (don't break if you just didn't work).
  // Today counts if it already has >= 1 block done.
  let streak = 0;
  const d = new Date();
  const today = todayStr();

  // Check today first — counts if it has blocks (even on time-off), doesn't break if it doesn't
  const todayData = state.days[today];
  if (countDoneBlocks(todayData || {}) >= 1) streak = 1;

  // Walk backward from yesterday
  d.setDate(d.getDate() - 1);
  while (true) {
    const ds = d.toISOString().slice(0, 10);
    const data = state.days[ds];
    const off = data?.timeOff || false;
    const done = countDoneBlocks(data || {});

    if (done >= 1) {
      // Has blocks (even on time-off) — counts toward streak
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (off) {
      // Time-off with no blocks: skip silently
      d.setDate(d.getDate() - 1);
      continue;
    } else if (isWeekend(ds)) {
      // Empty weekend: skip silently (don't penalize for not working weekends)
      d.setDate(d.getDate() - 1);
    } else {
      break; // Weekday with 0 blocks — streak ends
    }
  }
  return streak;
}

function firstRecordedDay() {
  const days = Object.entries(state.days)
    .filter(([, d]) => Object.keys(d.schedule || {}).length > 0 || (d.completed || []).length > 0)
    .map(([ds]) => ds)
    .sort();
  return days[0] || null;
}

// Momentum / decay: starts at 100, decays by 10 each weekday the goal is missed,
// restores by 5 each goal-met weekday. Clamps 0-100.
function computeMomentum() {
  const today = todayStr();
  const firstDay = firstRecordedDay();
  const days = Object.keys(state.days).filter(ds => ds <= today && (!firstDay || ds >= firstDay) && !isWeekend(ds) && !state.days[ds]?.timeOff).sort();
  let m = 100;
  for (const ds of days) {
    const done = countDoneBlocks(state.days[ds]);
    if (done >= dailyGoalForDay(ds)) m = Math.min(100, m + 5);
    else m = Math.max(0, m - 10);
  }
  return Math.round(m);
}

function computeStats() {
  // Only non-timeoff weekdays count for streak
  const today = todayStr();
  const firstDay = firstRecordedDay();
  const allDays = Object.entries(state.days).filter(([ds]) => ds <= today && (!firstDay || ds >= firstDay));
  const activeDays = allDays.filter(([ds, d]) => !d.timeOff && countDoneBlocks(d) > 0);
  const total = activeDays.reduce((s, [, d]) => s + countDoneBlocks(d), 0);
  const avg = activeDays.length ? (total / activeDays.length).toFixed(1) : '0.0';
  const best = activeDays.length ? Math.max(...activeDays.map(([, d]) => countDoneBlocks(d))) : 0;
  const streak = computeStreak();
  // completion rate: goals hit / total weekday work days
  const weekdayWorkDays = allDays.filter(([ds, d]) => !isWeekend(ds) && !d.timeOff);
  const goalsMet = weekdayWorkDays.filter(([ds, d]) => countDoneBlocks(d) >= dailyGoalForDay(ds)).length;
  const rate = weekdayWorkDays.length ? Math.round(goalsMet / weekdayWorkDays.length * 100) : 0;
  return {
    total,
    avg,
    best,
    streak,
    days: activeDays.length,
    rate,
    momentum: computeMomentum()
  };
}

// ════════════════════════════════════════════════════════════
//  PERSISTENCE
// ════════════════════════════════════════════════════════════
function ensureForwardDays() {
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    if (!state.days[ds]) {
      state.days[ds] = {
        schedule: {},
        completed: [],
        blockNotes: {},
        timeOff: isWeekend(ds)
      };
    }
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {}
  // Push YAML to local server (silently — no-op if server not running)
  try {
    const yaml = toYaml();
    fetch('/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/yaml'
        },
        body: yaml
      })
      .then(r => r.ok ? setServerStatus('saved') : setServerStatus('error'))
      .catch(() => setServerStatus('offline'));
  } catch (e) {}
}

function setServerStatus(status) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let text, color;
  if (status === 'saved') { text = `Saved ${t}`; color = 'var(--green)'; }
  else if (status === 'offline') { text = 'Offline'; color = 'var(--faint)'; }
  else { text = 'Save error'; color = 'var(--red)'; }
  const el = document.getElementById('save-status');
  if (el) { el.textContent = text; el.style.color = color; }
  // also update settings panel label if open
  const sp = document.getElementById('sp-io-bar-label');
  if (sp) sp.textContent = status === 'saved' ? `Auto-saved · last save ${t}` : status === 'offline' ? 'Auto-saved to browser · server offline' : 'Auto-saved to browser · file save error';
}
async function loadFromServer() {
  try {
    const r = await fetch('/load');
    if (r.status === 204) return false; // no file yet
    if (!r.ok) return false;
    const text = await r.text();
    const p = parseYaml(text);
    if (p.projects.length) state.projects = p.projects;
    if (p.settings && p.settings.dailyGoal) state.settings.dailyGoal = p.settings.dailyGoal;
    if (p.settings && p.settings.defaultBlockDuration) state.settings.defaultBlockDuration = p.settings.defaultBlockDuration;
    if (p.projectTodos && Object.keys(p.projectTodos).length) state.projectTodos = p.projectTodos;
    if (p.projNotes && Object.keys(p.projNotes).length) state.projNotes = p.projNotes;
    if (Object.keys(p.days).length) Object.assign(state.days, p.days);
    if (p.timerState && p.timerState.activeBlock !== null && p.timerState.activeBlock !== undefined) {
      state.timerState = {
        activeBlock: p.timerState.activeBlock,
        startedAt: p.timerState.startedAt || null,
        elapsedMs: p.timerState.elapsedMs || 0,
        date: p.timerState.date || null
      };
    }
    return true;
  } catch (e) {
    return false;
  }
}

function load() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) state = JSON.parse(r)
  } catch (e) {}
  if (!state.settings) state.settings = {
    dailyGoal: 8,
    defaultBlockDuration: 30
  };
  if (!state.settings.defaultBlockDuration) state.settings.defaultBlockDuration = 30;
  if (state.settings.todosDefaultOpen === undefined) state.settings.todosDefaultOpen = true;
  if (state.settings.theme === undefined) state.settings.theme = 'dark';
  document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : '';
  if (!state.settings.tags) state.settings.tags = [
    {id:'t1', color:'#E55555', name:''},
    {id:'t2', color:'#E8A838', name:''},
    {id:'t3', color:'#5CB85C', name:''},
    {id:'t4', color:'#5B9BD5', name:''},
    {id:'t5', color:'#9B6FD4', name:''},
  ];
  if (!state.projectTodos) state.projectTodos = {};
  if (!state.projNotes) state.projNotes = {};
  Object.keys(state.days).forEach(ds => {
    if (!state.days[ds].blockNotes) state.days[ds].blockNotes = {};
    if (!state.days[ds].blockSpan) state.days[ds].blockSpan = {};
    if (state.days[ds].timeOff === undefined) state.days[ds].timeOff = isWeekend(ds);
  });
  ensureForwardDays();
  save(); // persist the newly generated days
}
// Restore timer state after page load/refresh
function restoreTimerState() {
  const ts = state.timerState;
  if (!ts || ts.activeBlock === null || ts.activeBlock === undefined) return;
  if (ts.date !== todayStr()) {
    // Timer was from a different day — discard silently
    state.timerState = {
      activeBlock: null,
      startedAt: null,
      elapsedMs: 0,
      date: null
    };
    save();
    return;
  }
  // Calculate total elapsed ms (accumulated + time since startedAt if was running)
  let totalElapsed = ts.elapsedMs || 0;
  if (ts.startedAt) {
    totalElapsed += Date.now() - ts.startedAt;
  }
  if (totalElapsed >= 30 * 60 * 1000) {
    // Block should be auto-completed
    const blockIdx = ts.activeBlock;
    const ds = ts.date;
    const day = getDay(ds);
    if (!day.completed.includes(blockIdx)) {
      day.completed.push(blockIdx);
      setDay(ds, day);
    }
    state.timerState = {
      activeBlock: null,
      startedAt: null,
      elapsedMs: 0,
      date: null
    };
    save();
    console.log('[Timer] Auto-completed block', blockIdx, '(timer expired while away)');
  } else {
    // Resume timer from where we left off
    ui.activeBlock = ts.activeBlock;
    ui.timerElapsedMs = totalElapsed;
    ui.timerStartedAt = Date.now();
    ui.timerRunning = true;
    // Update persisted state with fresh startedAt
    state.timerState = {
      activeBlock: ts.activeBlock,
      startedAt: Date.now(),
      elapsedMs: totalElapsed,
      date: ts.date
    };
    save();
    ui.timerInterval = setInterval(tickTimer, 500);
    // focusBlock will be shown after renderAll() in init
    ui.focusBlock = ts.activeBlock;
  }
}

// Get or auto-init a day, setting timeOff=true for weekends by default
function getDay(ds) {
  if (!state.days[ds]) {
    state.days[ds] = {
      schedule: {},
      completed: [],
      blockNotes: {},
      blockSpan: {},
      timeOff: isWeekend(ds)
    };
  }
  const d = state.days[ds];
  if (!d.blockNotes) d.blockNotes = {};
  if (!d.blockSpan) d.blockSpan = {};
  if (d.timeOff === undefined) d.timeOff = isWeekend(ds);
  return d;
}
// Return the duration of a block in seconds (30 or 60 min based on span)
function getBlockDuration(idx, ds) {
  if (idx === null || idx === undefined) return 30 * 60;
  const span = ((getDay(ds || ui.currentDate).blockSpan) || {})[idx] || 1;
  return span * 30 * 60;
}

// ════════════════════════════════════════════════════════════
//  YAML
// ════════════════════════════════════════════════════════════
// ── YAML helpers ──────────────────────────────────────────────
function yStr(s) {
  return '"' + (s || '').replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/\n/g, '\\n') + '"'
}

function yBool(b) {
  return b ? 'true' : 'false'
}

function toYaml() {
  const L = ['# Day Planner Export', `# Generated: ${new Date().toISOString()}`, ''];

  // settings
  L.push('settings:');
  L.push(`  dailyGoal: ${dailyGoal()}`);
  L.push(`  defaultBlockDuration: ${state.settings.defaultBlockDuration || 30}`);
  L.push('');

  // timerState — active block timer (only written when a block is active)
  const ts = state.timerState;
  if (ts && ts.activeBlock !== null && ts.activeBlock !== undefined) {
    L.push('timerState:');
    L.push(`  activeBlock: ${ts.activeBlock}`);
    L.push(`  date: ${yStr(ts.date)}`);
    L.push(`  elapsedMs: ${ts.elapsedMs || 0}`);
    if (ts.startedAt) L.push(`  startedAt: ${yStr(new Date(ts.startedAt).toISOString())}`);
    L.push('');
  }

  // projects
  L.push('projects:');
  state.projects.forEach(p => {
    L.push(`  - id: ${yStr(p.id)}`);
    L.push(`    name: ${yStr(p.name)}`);
    L.push(`    emoji: ${yStr(p.emoji)}`);
    L.push(`    color: ${yStr(p.color)}`);
    if (p.parentId) L.push(`    parentId: ${yStr(p.parentId)}`);
  });
  L.push('');

  // projectTodos  — keyed by project id
  L.push('projectTodos:');
  let hasProjTodos = false;
  Object.entries(state.projectTodos || {}).forEach(([projId, todos]) => {
    if (!todos || !todos.length) return;
    hasProjTodos = true;
    L.push(`  ${yStr(projId)}:`);
    todos.forEach(t => {
      L.push(`    - id: ${yStr(t.id)}`);
      L.push(`      text: ${yStr(t.text)}`);
      L.push(`      done: ${yBool(t.done)}`);
      if ((t.history || []).length) {
        L.push('      history:');
        t.history.forEach(h => {
          const bk = h.blockIdx != null ? `, blockIdx: ${h.blockIdx}` : '';
          L.push(`        - {date: ${yStr(h.date)}, type: ${yStr(h.type)}${bk}}`);
        });
      }
    });
  });
  if (!hasProjTodos) L.push('  {}');
  L.push('');

  // projNotes — standalone notes on projects (no block required)
  L.push('projNotes:');
  let hasProjNotes = false;
  Object.entries(state.projNotes || {}).forEach(([projId, notes]) => {
    if (!notes || !notes.length) return;
    hasProjNotes = true;
    L.push(`  ${yStr(projId)}:`);
    notes.forEach(n => {
      L.push(`    - id: ${yStr(n.id)}`);
      L.push(`      date: ${yStr(n.date)}`);
      if (n.importance) L.push(`      importance: ${n.importance}`);
      if (n.meeting) L.push('      meeting: true');
      if ((n.tags || []).length) L.push(`      tags: [${n.tags.map(yStr).join(', ')}]`);
      if ((n.note || '').trim()) L.push(`      note: ${yStr(n.note)}`);
    });
  });
  if (!hasProjNotes) L.push('  {}');
  L.push('');

  // days
  L.push('days:');
  Object.entries(state.days).sort().forEach(([ds, data]) => {
    L.push(`  ${yStr(ds)}:`);
    if (data.dailyGoal) L.push(`    dailyGoal: ${data.dailyGoal}`);
    if (data.timeOff) L.push('    timeOff: true');

    const sched = data.schedule || {};
    if (Object.keys(sched).length) {
      L.push('    schedule:');
      // Build sequential map for this day's schedule
      const schedSpannedSlots = new Set();
      Object.entries(data.blockSpan || {}).forEach(([si, sp]) => {
        for (let i = 1; i < sp; i++) schedSpannedSlots.add(+si + i);
      });
      const schedStarts = Object.keys(sched).map(Number).filter(i => !schedSpannedSlots.has(i)).sort((a, b) => a - b);
      Object.entries(sched).sort((a, b) => +a[0] - +b[0]).forEach(([idx, pid]) => {
        const [h, half] = blockToTime(+idx);
        const seqPos = schedStarts.indexOf(+idx);
        const blockLabel = seqPos >= 0 ? `Block ${seqPos + 1}` : formatTime(h, half);
        L.push(`      ${idx}: ${yStr(pid)}  # ${blockLabel} · ${formatTime(h,half)}`);
      });
    }

    const done = data.completed || [];
    if (done.length) L.push(`    completed: [${[...done].sort((a,b)=>a-b).join(', ')}]`);

    // blockSpan — 1-hour block markers
    const spans = Object.entries(data.blockSpan || {}).filter(([, v]) => v >= 2);
    if (spans.length) {
      L.push('    blockSpan:');
      spans.forEach(([idx, sp]) => {
        const [h, half] = blockToTime(+idx);
        const seqPos = schedStarts.indexOf(+idx);
        const blockLabel = seqPos >= 0 ? `Block ${seqPos + 1}` : formatTime(h, half);
        L.push(`      ${idx}: ${sp}  # ${blockLabel} · ${formatTime(h,half)}`);
      });
    }

    // blockNotes — includes note, todos (with ids), projTodos pins, importance, tags, meeting
    const notes = data.blockNotes || {};
    const noteEntries = Object.entries(notes).filter(([, n]) =>
      (n.note || '').trim() || (n.todos || []).length || (n.projTodos || []).length ||
      n.importance || (n.tags || []).length || n.meeting || (n.resumeNote || '').trim()
    );
    if (noteEntries.length) {
      L.push('    blockNotes:');
      noteEntries.forEach(([idx, n]) => {
        const [h, half] = blockToTime(+idx);
        const seqPos = schedStarts.indexOf(+idx);
        const blockLabel = seqPos >= 0 ? `Block ${seqPos + 1}` : formatTime(h, half);
        L.push(`      ${idx}:  # ${blockLabel} · ${formatTime(h,half)}`);
        if (n.importance) L.push(`        importance: ${n.importance}`);
        if (n.meeting) L.push('        meeting: true');
        if ((n.tags || []).length) L.push(`        tags: [${n.tags.map(yStr).join(', ')}]`);
        if ((n.resumeNote || '').trim()) L.push(`        resumeNote: ${yStr(n.resumeNote)}`);
        if ((n.note || '').trim()) L.push(`        note: ${yStr(n.note)}`);
        if ((n.todos || []).length) {
          L.push('        todos:');
          n.todos.forEach(t => {
            L.push(`          - id: ${yStr(String(t.id))}`);
            L.push(`            text: ${yStr(t.text)}`);
            L.push(`            done: ${yBool(t.done)}`);
          });
        }
        if ((n.projTodos || []).length) {
          L.push('        projTodos:');
          n.projTodos.forEach(r => {
            L.push(`          - {projId: ${yStr(r.projId)}, todoId: ${yStr(r.todoId)}}`);
          });
        }
      });
    }
  });

  return L.join('\n');
}

function parseYaml(text) {
  const result = {
    projects: [],
    days: {},
    settings: {},
    projectTodos: {},
    projNotes: {}
  };
  // We use a simple indentation-aware state machine
  let mode = null; // 'settings'|'projects'|'projectTodos'|'days'
  let curProj = null; // current project object being built
  let curProjTodoId = null; // current projectTodos projId key
  let curProjTodoItem = null; // current todo item in projectTodos
  let curDay = null; // current day string
  let curNoteIdx = null; // current blockNote index
  let curTodoItem = null; // current block todo item being built
  let inSection = null; // sub-section: 'schedule'|'blockNotes'|'projTodosList'|'history'
  let inNoteSection = null; // 'todos'|'projTodos'

  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].replace(/\r$/, '');
    const trim = raw.trim();
    if (!trim || trim.startsWith('#')) continue;

    const indent = raw.match(/^(\s*)/)[1].length;

    // top-level section headers
    if (indent === 0) {
      if (trim === 'settings:') {
        mode = 'settings';
        inSection = null;
        curDay = null;
        continue
      }
      if (trim === 'projects:') {
        mode = 'projects';
        inSection = null;
        curDay = null;
        continue
      }
      if (trim === 'projectTodos:') {
        mode = 'projectTodos';
        inSection = null;
        curDay = null;
        continue
      }
      if (trim === 'projNotes:') {
        mode = 'projNotes';
        inSection = null;
        curDay = null;
        continue
      }
      if (trim === 'days:') {
        mode = 'days';
        inSection = null;
        curDay = null;
        continue
      }
      if (trim === 'timerState:') {
        mode = 'timerState';
        result.timerState = {};
        inSection = null;
        curDay = null;
        continue
      }
    }

    if (mode === 'settings') {
      const mGoal = trim.match(/^dailyGoal:\s*(\d+)/);
      if (mGoal) result.settings.dailyGoal = +mGoal[1];
      const mDur = trim.match(/^defaultBlockDuration:\s*(\d+)/);
      if (mDur) result.settings.defaultBlockDuration = +mDur[1];
      continue;
    }

    if (mode === 'timerState') {
      const mAB = trim.match(/^activeBlock:\s*(\d+)/);
      if (mAB) { result.timerState.activeBlock = +mAB[1]; continue; }
      const mDate = trim.match(/^date:\s*"([^"]*)"/);
      if (mDate) { result.timerState.date = mDate[1]; continue; }
      const mElapsed = trim.match(/^elapsedMs:\s*(\d+)/);
      if (mElapsed) { result.timerState.elapsedMs = +mElapsed[1]; continue; }
      const mStarted = trim.match(/^startedAt:\s*"([^"]*)"/);
      if (mStarted) { result.timerState.startedAt = new Date(mStarted[1]).getTime(); continue; }
      continue;
    }

    if (mode === 'projects') {
      if (trim.startsWith('- id:')) {
        const m = trim.match(/- id:\s*"([^"]+)"/);
        if (m) {
          curProj = {
            id: m[1],
            name: '',
            emoji: '',
            color: ''
          };
          result.projects.push(curProj);
        }
      } else if (curProj) {
        const nm = trim.match(/^name:\s*"([^"]*)"/);
        if (nm) curProj.name = nm[1];
        const em = trim.match(/^emoji:\s*"([^"]*)"/);
        if (em) curProj.emoji = em[1];
        const cm = trim.match(/^color:\s*"([^"]*)"/);
        if (cm) curProj.color = cm[1];
        const pm = trim.match(/^parentId:\s*"([^"]*)"/);
        if (pm) curProj.parentId = pm[1];
      }
      continue;
    }

    if (mode === 'projectTodos') {
      if (trim === '{}' || trim === '{}') continue; // empty marker
      if (indent === 2 && trim.endsWith(':')) {
        // project id key
        const m = trim.match(/^"([^"]+)":/);
        if (m) {
          curProjTodoId = m[1];
          if (!result.projectTodos[curProjTodoId]) result.projectTodos[curProjTodoId] = [];
          curProjTodoItem = null;
        }
        continue;
      }
      if (curProjTodoId) {
        if (indent === 4 && trim.startsWith('- id:')) {
          const m = trim.match(/- id:\s*"([^"]*)"/);
          if (m) {
            curProjTodoItem = {
              id: m[1],
              text: '',
              done: false,
              history: []
            };
            result.projectTodos[curProjTodoId].push(curProjTodoItem);
          }
          continue;
        }
        if (curProjTodoItem && indent === 6) {
          const tm = trim.match(/^text:\s*"([^"]*)"/);
          if (tm) {
            curProjTodoItem.text = tm[1].replace(/\\n/g, '\n');
            continue;
          }
          const dm = trim.match(/^done:\s*(true|false)/);
          if (dm) {
            curProjTodoItem.done = dm[1] === 'true';
            continue;
          }
          if (trim === 'history:') {
            inSection = 'history';
            continue;
          }
        }
        if (inSection === 'history' && indent === 8 && trim.startsWith('-')) {
          const dm = trim.match(/date:\s*"([^"]*)"/);
          const tp = trim.match(/type:\s*"([^"]*)"/);
          const bk = trim.match(/blockIdx:\s*(\d+)/);
          if (dm && tp && curProjTodoItem) {
            curProjTodoItem.history.push({
              date: dm[1],
              type: tp[1],
              blockIdx: bk ? +bk[1] : null
            });
          }
          continue;
        }
      }
      continue;
    }

    if (mode === 'projNotes') {
      if (trim === '{}') continue;
      if (indent === 2 && trim.endsWith(':')) {
        const m = trim.match(/^"([^"]+)":/);
        if (m) {
          curProjTodoId = m[1]; // reuse curProjTodoId as curProjNoteId
          if (!result.projNotes[curProjTodoId]) result.projNotes[curProjTodoId] = [];
          curProjTodoItem = null;
        }
        continue;
      }
      if (curProjTodoId) {
        if (indent === 4 && trim.startsWith('- id:')) {
          const m = trim.match(/- id:\s*"([^"]*)"/);
          if (m) {
            curProjTodoItem = { id: m[1], date: '', note: '' };
            result.projNotes[curProjTodoId].push(curProjTodoItem);
          }
          continue;
        }
        if (curProjTodoItem && indent === 6) {
          const dm = trim.match(/^date:\s*"([^"]*)"/);
          if (dm) { curProjTodoItem.date = dm[1]; continue; }
          const nm = trim.match(/^note:\s*(.*)/);
          if (nm) { curProjTodoItem.note = nm[1].replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n'); continue; }
          const im = trim.match(/^importance:\s*(\d+)/);
          if (im) { curProjTodoItem.importance = +im[1]; continue; }
          if (trim === 'meeting: true') { curProjTodoItem.meeting = true; continue; }
          const tgm = trim.match(/^tags:\s*\[([^\]]*)\]/);
          if (tgm) { curProjTodoItem.tags = tgm[1].split(',').map(s => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean); continue; }
        }
      }
      continue;
    }

    if (mode === 'days') {
      // day key: "2025-01-01":
      if (indent === 2 && !trim.startsWith('-')) {
        const dm = trim.match(/^"(\d{4}-\d{2}-\d{2})":/);
        if (dm) {
          curDay = dm[1];
          result.days[curDay] = {
            schedule: {},
            completed: [],
            blockNotes: {},
            blockSpan: {},
            timeOff: false
          };
          inSection = null;
          curNoteIdx = null;
          inNoteSection = null;
          curTodoItem = null;
          continue;
        }
      }
      if (!curDay) continue;

      if (indent === 4) {
        if (trim === 'timeOff: true') {
          result.days[curDay].timeOff = true;
          continue;
        }
        const dgm = trim.match(/^dailyGoal:\s*(\d+)/);
        if (dgm) {
          result.days[curDay].dailyGoal = +dgm[1];
          continue;
        }
        if (trim === 'schedule:') {
          inSection = 'schedule';
          inNoteSection = null;
          continue;
        }
        if (trim === 'blockNotes:') {
          inSection = 'blockNotes';
          inNoteSection = null;
          continue;
        }
        if (trim === 'blockSpan:') {
          inSection = 'blockSpan';
          inNoteSection = null;
          continue;
        }
        if (trim.startsWith('completed:')) {
          inSection = null;
          const nums = trim.match(/\d+/g);
          if (nums) result.days[curDay].completed = nums.map(Number);
          continue;
        }
      }

      if (inSection === 'blockSpan' && indent === 6) {
        const m = trim.match(/^(\d+):\s*(\d+)/);
        if (m) {
          if (!result.days[curDay].blockSpan) result.days[curDay].blockSpan = {};
          result.days[curDay].blockSpan[m[1]] = +m[2];
        }
        continue;
      }

      if (inSection === 'schedule' && indent === 6) {
        const m = trim.match(/^(\d+):\s*"([^"]+)"/);
        if (m) result.days[curDay].schedule[m[1]] = m[2];
        continue;
      }

      if (inSection === 'blockNotes') {
        if (indent === 6 && !trim.startsWith('-')) {
          const m = trim.match(/^(\d+):/);
          if (m) {
            curNoteIdx = m[1];
            result.days[curDay].blockNotes[curNoteIdx] = {
              note: '',
              todos: [],
              projTodos: []
            };
            inNoteSection = null;
            curTodoItem = null;
          }
          continue;
        }
        if (curNoteIdx) {
          if (indent === 8) {
            if (trim === 'todos:') {
              inNoteSection = 'todos';
              curTodoItem = null;
              continue;
            }
            if (trim === 'projTodos:') {
              inNoteSection = 'projTodos';
              continue;
            }
            const nm = trim.match(/^note:\s*"([^"]*)"/);
            if (nm) {
              result.days[curDay].blockNotes[curNoteIdx].note = nm[1].replace(/\\n/g, '\n');
              continue;
            }
            const im = trim.match(/^importance:\s*(\d)/);
            if (im) {
              result.days[curDay].blockNotes[curNoteIdx].importance = +im[1];
              continue;
            }
            if (trim === 'meeting: true') {
              result.days[curDay].blockNotes[curNoteIdx].meeting = true;
              continue;
            }
            const rnm = trim.match(/^resumeNote:\s*"((?:[^"\\]|\\.)*)"/);
            if (rnm) {
              result.days[curDay].blockNotes[curNoteIdx].resumeNote = rnm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              continue;
            }
            const tgm = trim.match(/^tags:\s*\[([^\]]*)\]/);
            if (tgm) {
              result.days[curDay].blockNotes[curNoteIdx].tags = tgm[1]
                .split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
              continue;
            }
          }
          if (inNoteSection === 'todos' && indent === 10) {
            if (trim.startsWith('- id:')) {
              const m = trim.match(/- id:\s*"([^"]*)"/);
              if (m) {
                curTodoItem = {
                  id: m[1],
                  text: '',
                  done: false
                };
                result.days[curDay].blockNotes[curNoteIdx].todos.push(curTodoItem);
              }
              continue;
            }
            if (curTodoItem) {
              const tm = trim.match(/^text:\s*"([^"]*)"/);
              if (tm) {
                curTodoItem.text = tm[1].replace(/\\n/g, '\n');
                continue;
              }
              const dm = trim.match(/^done:\s*(true|false)/);
              if (dm) {
                curTodoItem.done = dm[1] === 'true';
                continue;
              }
            }
          }
          if (inNoteSection === 'projTodos' && indent === 10 && trim.startsWith('-')) {
            const pm = trim.match(/projId:\s*"([^"]*)"/);
            const tm = trim.match(/todoId:\s*"([^"]*)"/);
            if (pm && tm) result.days[curDay].blockNotes[curNoteIdx].projTodos.push({
              projId: pm[1],
              todoId: tm[1]
            });
            continue;
          }
        }
      }
    }
  }
  return result;
}

function exportYaml() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toYaml()], {
    type: 'text/yaml'
  }));
  a.download = `day-planner-${todayStr()}.yaml`;
  a.click();
}

async function manualBackup() {
  const btn = document.getElementById('sp-manual-backup-btn');
  if (btn) { btn.textContent = '⏳ Backing up…'; btn.disabled = true; }
  try {
    const r = await fetch('/backup', { method: 'POST' });
    const j = await r.json();
    if (btn) {
      if (j.ok) {
        btn.textContent = '✓ Backup saved';
        setTimeout(() => { btn.textContent = '☁ Manual Backup'; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = '✗ Backup failed';
        setTimeout(() => { btn.textContent = '☁ Manual Backup'; btn.disabled = false; }, 2000);
      }
    }
  } catch (e) {
    if (btn) {
      btn.textContent = '✗ Backup failed';
      setTimeout(() => { btn.textContent = '☁ Manual Backup'; btn.disabled = false; }, 2000);
    }
  }
}

function importYaml(text) {
  try {
    const p = parseYaml(text);
    if (p.projects.length) state.projects = p.projects;
    if (p.settings.dailyGoal) state.settings.dailyGoal = p.settings.dailyGoal;
    if (p.settings.defaultBlockDuration) state.settings.defaultBlockDuration = p.settings.defaultBlockDuration;
    if (p.projectTodos && Object.keys(p.projectTodos).length) Object.assign(state.projectTodos, p.projectTodos);
    Object.assign(state.days, p.days);
    ensureForwardDays();
    save();
    renderAll();
    alert('Import successful!');
  } catch (e) {
    alert('Import failed.\n' + e.message)
  }
}

// ════════════════════════════════════════════════════════════
//  TIMER
// ════════════════════════════════════════════════════════════
function updateNotifEnableRow() {
  const row = document.getElementById('notif-enable-row');
  const btn = document.getElementById('notif-enable-btn');
  if (!row || !btn) return;
  if (!('Notification' in window)) { row.style.display = 'none'; return; }
  if (Notification.permission === 'granted') { row.style.display = 'none'; return; }
  row.style.display = 'block';
  // 'denied' means the browser blocked it — guide user to settings instead
  if (Notification.permission === 'denied') {
    btn.textContent = '🔕 Notifications blocked — click for help';
  } else {
    btn.textContent = '🔔 Enable Notifications';
  }
}

function enableNotifications() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked for this site.\n\nTo enable them:\n• Chrome: click the 🔒 icon in the address bar → Site settings → Notifications → Allow\n• Safari: Safari menu → Settings → Websites → Notifications → find this site → Allow');
    return;
  }
  Notification.requestPermission().then(updateNotifEnableRow);
}

function requestNotifPermission() {
  updateNotifEnableRow();
}

let _testTimerInterval = null;
let _testTimerSecs = 0;

function startTestTimer() {
  const btn = document.getElementById('notif-test-btn');
  if (_testTimerInterval) {
    clearInterval(_testTimerInterval);
    _testTimerInterval = null;
    if (btn) btn.textContent = '🧪 Test notification (1 min)';
    return;
  }
  const fire = () => {
    if (!('Notification' in window) || Notification.permission === 'granted') {
      fireTimerNotification({ emoji: '🧪', name: 'Test Block' }, -1);
    } else if (Notification.permission === 'denied') {
      alert('Notifications are blocked for this site.\n\nTo enable:\n• Chrome: click the 🔒 icon in the address bar → Site settings → Notifications → Allow\n• Safari: Safari menu → Settings → Websites → Notifications → find this site → Allow');
    } else {
      Notification.requestPermission().then(perm => {
        updateNotifEnableRow();
        if (perm === 'granted') fireTimerNotification({ emoji: '🧪', name: 'Test Block' }, -1);
      });
    }
  };
  _testTimerSecs = 60;
  if (btn) btn.textContent = `🧪 Cancel (${_testTimerSecs}s)`;
  _testTimerInterval = setInterval(() => {
    _testTimerSecs--;
    if (btn) btn.textContent = `🧪 Cancel (${_testTimerSecs}s)`;
    if (_testTimerSecs <= 0) {
      clearInterval(_testTimerInterval);
      _testTimerInterval = null;
      if (btn) btn.textContent = '🧪 Test notification (1 min)';
      fire();
    }
  }, 1000);
}

let _soundCtx = null;
let _soundInterval = null;

function _playChime() {
  try {
    const ctx = _soundCtx || (_soundCtx = new (window.AudioContext || window.webkitAudioContext)());
    const play = () => {
      [[0, 523], [0.18, 659], [0.36, 784]].forEach(([t, freq]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.28, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.55);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + 0.55);
      });
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(play);
    } else {
      play();
    }
  } catch (e) {}
}

function playCompletionSound() {
  if (ui.soundMuted) return;
  stopCompletionSound();
  _playChime();
  _soundInterval = setInterval(_playChime, 3500);
}

function stopCompletionSound() {
  if (_soundInterval) { clearInterval(_soundInterval); _soundInterval = null; }
}

function dismissPopup() {
  const popup = document.getElementById('block-complete-popup');
  if (popup) popup.classList.remove('visible');
  stopCompletionSound();
}

function showBlockCompletePopup(proj, completedIdx) {
  const popup = document.getElementById('block-complete-popup');
  if (!popup) return;

  const projNameEl = document.getElementById('bcp-proj-name');
  projNameEl.textContent = proj ? `${proj.emoji} ${proj.name}` : 'Block';
  projNameEl.style.color = proj ? proj.color : 'var(--text)';

  // Resume note textarea — pre-fill if already set
  const resumeInput = document.getElementById('bcp-resume-input');
  if (resumeInput) {
    const existing = (currentDayData().blockNotes || {})[completedIdx]?.resumeNote || '';
    resumeInput.value = existing;
    setTimeout(() => resumeInput.focus(), 120);
  }

  // Save resume note helper
  const saveResumeNote = () => {
    const text = (resumeInput?.value || '').trim();
    if (text) {
      const ds = todayStr();
      const d = getDay(ds);
      if (!d.blockNotes[completedIdx]) d.blockNotes[completedIdx] = { note: '', todos: [] };
      d.blockNotes[completedIdx].resumeNote = text;
      setDay(ds, d);
      save();
    }
  };

  const day = currentDayData();
  const sched = day.schedule || {};
  const done = new Set(day.completed || []);
  const nextIdx = Object.keys(sched).map(Number).sort((a, b) => a - b)
    .find(i => i > completedIdx && !done.has(i) && sched[i] !== '__break__');
  const nextBtn = document.getElementById('bcp-next-btn');
  nextBtn.style.display = nextIdx !== undefined ? '' : 'none';
  nextBtn.onclick = () => { saveResumeNote(); dismissPopup(); startTimer(nextIdx); };

  // Add Block button — shown when no next block is scheduled
  const addBlockBtn = document.getElementById('bcp-add-block-btn');
  const projPicker = document.getElementById('bcp-proj-picker');
  if (addBlockBtn) {
    addBlockBtn.style.display = nextIdx === undefined ? '' : 'none';
    if (projPicker) projPicker.style.display = 'none';
    addBlockBtn.onclick = () => {
      if (!projPicker) return;
      projPicker.innerHTML = '<div style="font-size:9px;color:var(--faint);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Choose a project:</div>';
      const projs = state.projects.filter(p => !p.archived);
      projs.forEach(p => {
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;text-align:left;background:none;border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;margin-bottom:4px;cursor:pointer;font-family:"DM Mono",monospace;font-size:10px;transition:all .12s';
        btn.innerHTML = `<span style="color:${p.color}">${p.emoji}</span> ${escAttr(p.name)}`;
        btn.onmouseenter = () => { btn.style.borderColor = p.color; btn.style.background = `${p.color}18`; };
        btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'none'; };
        btn.onclick = () => {
          const ds = todayStr();
          const dayD = getDay(ds);
          if (!dayD.schedule) dayD.schedule = {};
          let slot = completedIdx + 1;
          while (slot <= 35 && dayD.schedule[slot] !== undefined) slot++;
          if (slot > 35) { saveResumeNote(); dismissPopup(); return; }
          dayD.schedule[slot] = p.id;
          setDay(ds, dayD);
          save();
          saveResumeNote();
          dismissPopup();
          renderScheduleGrid();
          startTimer(slot);
        };
        projPicker.appendChild(btn);
      });
      projPicker.style.display = '';
      addBlockBtn.style.display = 'none';
    };
  }

  // Extend button — only for 30-min blocks with room to expand
  const extendBtn = document.getElementById('bcp-extend-btn');
  if (extendBtn) {
    const span = (day.blockSpan || {})[completedIdx] || 1;
    const canExtend = span === 1 && completedIdx + 1 <= 35;
    extendBtn.style.display = canExtend ? '' : 'none';
    extendBtn.onclick = () => extendBlockFromAlarm(completedIdx);
  }
  document.getElementById('bcp-dismiss-btn').onclick = () => { saveResumeNote(); dismissPopup(); };
  document.getElementById('bcp-sound-btn').onclick = () => { saveResumeNote(); dismissPopup(); };
  popup.classList.add('visible');
}


function fireTimerNotification(proj, completedIdx, showPopup = true) {
  const projName = proj ? `${proj.emoji} ${proj.name}` : '';
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Block Complete', {
      body: projName ? `${projName} — block finished!` : 'Your block is finished!',
    });
  }
  // Trigger native macOS notification with sound (works even when tab is unfocused)
  fetch('/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Block Complete',
      message: projName ? `${projName} — block finished!` : 'Your block is finished!'
    })
  }).catch(() => {});
  playCompletionSound();
  if (showPopup) showBlockCompletePopup(proj, completedIdx);
}

function startTimer(blockIdx) {
  clearInterval(ui.timerInterval);
  requestNotifPermission();
  ui.activeBlock = blockIdx;
  ui.timerElapsedMs = 0;
  ui.timerStartedAt = Date.now();
  ui.timerRunning = true;
  state.timerState = {
    activeBlock: blockIdx,
    startedAt: ui.timerStartedAt,
    elapsedMs: 0,
    date: todayStr()
  };
  save();
  ui.timerInterval = setInterval(tickTimer, 500);
  switchTab('today');
  showBlockFocus(blockIdx);
}

function tickTimer() {
  if (getTimerRemaining() <= 0) {
    const completedIdx = ui.activeBlock;
    const proj = getProject((currentDayData().schedule || {})[completedIdx]);
    // Save pivot partner before completeBlock clears ui.pivot
    const pivotPartner = ui.pivot
      ? (completedIdx === ui.pivot.blockA ? { idx: ui.pivot.blockB, elapsed: ui.pivot.elapsedB } : { idx: ui.pivot.blockA, elapsed: ui.pivot.elapsedA })
      : null;
    completeBlock(completedIdx);
    clearInterval(ui.timerInterval);
    ui.timerRunning = false;
    ui.timerElapsedMs = 0;
    ui.timerStartedAt = null;
    ui.activeBlock = null;
    state.timerState = { activeBlock: null, startedAt: null, elapsedMs: 0, date: null };
    save();
    if (pivotPartner !== null) {
      // Pivot: notify without popup, then auto-start the partner block
      fireTimerNotification(proj, completedIdx, false);
      ui.activeBlock = pivotPartner.idx;
      ui.timerElapsedMs = pivotPartner.elapsed;
      ui.timerStartedAt = Date.now();
      ui.timerRunning = true;
      state.timerState = { activeBlock: pivotPartner.idx, startedAt: ui.timerStartedAt, elapsedMs: pivotPartner.elapsed, date: todayStr() };
      save();
      ui.timerInterval = setInterval(tickTimer, 500);
      showBlockFocus(pivotPartner.idx);
      renderAll();
    } else {
      fireTimerNotification(proj, completedIdx);
      hideBlockFocus();
      renderAll();
    }
    return;
  }
  renderTimerCard();
  renderGamePanel();
  renderPlanBanner();
  // Update countdown in focus view header
  const focusTimeEl = document.getElementById('block-focus-time');
  if (focusTimeEl && focusTimeEl.dataset.countdown === '1') {
    focusTimeEl.textContent = formatSecs(getTimerRemaining());
  }
}

function pauseResumeTimer() {
  if (ui.timerRunning) {
    ui.timerElapsedMs += Date.now() - ui.timerStartedAt;
    ui.timerStartedAt = null;
    ui.timerRunning = false;
    clearInterval(ui.timerInterval);
    state.timerState = {
      ...state.timerState,
      startedAt: null,
      elapsedMs: ui.timerElapsedMs
    };
  } else {
    ui.timerStartedAt = Date.now();
    ui.timerRunning = true;
    ui.timerInterval = setInterval(tickTimer, 500);
    state.timerState = {
      ...state.timerState,
      startedAt: ui.timerStartedAt
    };
  }
  save();
  renderTimerCard();
}

function skipToFiveSeconds() {
  if (ui.activeBlock === null) return;
  const dur = getBlockDuration(ui.activeBlock);
  ui.timerElapsedMs = (dur - 5) * 1000;
  if (ui.timerRunning) ui.timerStartedAt = Date.now();
}

function promptAndDoneTimer() {
  if (ui.activeBlock === null) { doneTimer(); return; }
  const completedIdx = ui.activeBlock;
  const proj = getProject((currentDayData().schedule || {})[completedIdx]);

  // Save pivot partner before completeBlock clears ui.pivot
  const pivotPartner = ui.pivot
    ? (completedIdx === ui.pivot.blockA ? { idx: ui.pivot.blockB, elapsed: ui.pivot.elapsedB } : { idx: ui.pivot.blockA, elapsed: ui.pivot.elapsedA })
    : null;

  // Complete the block and clear timer state
  completeBlock(completedIdx);
  clearInterval(ui.timerInterval);
  ui.activeBlock = null;
  ui.timerRunning = false;
  ui.timerElapsedMs = 0;
  ui.timerStartedAt = null;
  state.timerState = { activeBlock: null, startedAt: null, elapsedMs: 0, date: null };
  save();

  if (pivotPartner !== null) {
    // Pivot: skip popup, auto-start the partner block
    hideBlockFocus();
    ui.activeBlock = pivotPartner.idx;
    ui.timerElapsedMs = pivotPartner.elapsed;
    ui.timerStartedAt = Date.now();
    ui.timerRunning = true;
    state.timerState = { activeBlock: pivotPartner.idx, startedAt: ui.timerStartedAt, elapsedMs: pivotPartner.elapsed, date: todayStr() };
    save();
    ui.timerInterval = setInterval(tickTimer, 500);
    showBlockFocus(pivotPartner.idx);
    renderAll();
    return;
  }

  // No pivot: show the block-complete popup (with left-off textarea)
  showBlockCompletePopup(proj, completedIdx);

  // After any popup action, also hide focus view and re-render
  ['bcp-next-btn', 'bcp-dismiss-btn', 'bcp-sound-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const orig = btn.onclick;
    btn.onclick = (...args) => { orig?.(...args); hideBlockFocus(); renderAll(); };
  });
}

function doneTimer() {
  if (ui.activeBlock !== null) completeBlock(ui.activeBlock);
  clearInterval(ui.timerInterval);
  ui.activeBlock = null;
  ui.timerRunning = false;
  ui.timerElapsedMs = 0;
  ui.timerStartedAt = null;
  state.timerState = {
    activeBlock: null,
    startedAt: null,
    elapsedMs: 0,
    date: null
  };
  save();
  hideBlockFocus();
  renderAll();
}

// ════════════════════════════════════════════════════════════
//  PIVOT
// ════════════════════════════════════════════════════════════
function openPivotPicker() {
  renderPivotPicker();
  document.getElementById('pivot-picker-overlay').classList.add('open');
}

function closePivotPicker() {
  document.getElementById('pivot-picker-overlay').classList.remove('open');
}

function renderPivotPicker() {
  const day = currentDayData();
  const sched = day.schedule || {};
  const done = new Set(day.completed || []);
  const spans = day.blockSpan || {};
  const spanned = new Set();
  Object.entries(spans).forEach(([si, span]) => {
    for (let i = 1; i < span; i++) spanned.add(+si + i);
  });
  const pivotableBlocks = Object.keys(sched)
    .map(Number)
    .filter(idx => !done.has(idx) && !spanned.has(idx) && idx !== ui.activeBlock && sched[idx] !== '__break__')
    .sort((a, b) => a - b);

  const list = document.getElementById('pivot-picker-list');
  list.innerHTML = '';
  if (pivotableBlocks.length === 0) {
    list.innerHTML = '<div style="color:var(--faint);font-family:\'DM Mono\',monospace;font-size:11px;padding:8px 0 12px">No other blocks on today\'s plan</div>';
  } else {
    pivotableBlocks.forEach(idx => {
      const proj = getProject(sched[idx]);
      if (!proj) return;
      const [h, half] = blockToTime(idx);
      const btn = document.createElement('button');
      btn.className = 'pivot-pick-btn';
      btn.innerHTML = `<span class="pivot-pick-color" style="background:${proj.color}"></span><span class="pivot-pick-name">${escHtml(proj.emoji + ' ' + proj.name)}</span><span class="pivot-pick-time">${formatTime(h, half)}</span>`;
      btn.onclick = () => { closePivotPicker(); startPivot(idx); };
      list.appendChild(btn);
    });
  }

  const newSection = document.getElementById('pivot-picker-new-section');
  newSection.innerHTML = '<div class="pivot-section-lbl" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">CREATE NEW BLOCK</div>';
  state.projects.filter(p => !p.archived).forEach(proj => {
    const btn = document.createElement('button');
    btn.className = 'pivot-pick-btn';
    btn.innerHTML = `<span class="pivot-pick-color" style="background:${proj.color}"></span><span class="pivot-pick-name">${escHtml(proj.emoji + ' ' + proj.name)}</span><span class="pivot-pick-time" style="color:var(--muted)">+ new</span>`;
    btn.onclick = () => { closePivotPicker(); createAndPivotBlock(proj.id); };
    newSection.appendChild(btn);
  });
}

function createAndPivotBlock(projId) {
  const day = currentDayData();
  if (!day.schedule) day.schedule = {};
  let targetSlot = null;
  for (let i = (ui.activeBlock !== null ? ui.activeBlock + 1 : 0); i <= 35; i++) {
    if (!day.schedule[i]) { targetSlot = i; break; }
  }
  if (targetSlot === null) {
    for (let i = 0; i < (ui.activeBlock !== null ? ui.activeBlock : 0); i++) {
      if (!day.schedule[i]) { targetSlot = i; break; }
    }
  }
  if (targetSlot === null) { alert('No empty time slots available today.'); return; }
  day.schedule[targetSlot] = projId;
  setDay(ui.currentDate, day);
  save();
  renderScheduleGrid();
  startPivot(targetSlot);
}

function startPivot(blockBIdx) {
  if (ui.activeBlock === null) return;
  const elapsedA = ui.timerRunning
    ? ui.timerElapsedMs + (Date.now() - ui.timerStartedAt)
    : ui.timerElapsedMs;
  ui.pivot = { blockA: ui.activeBlock, blockB: blockBIdx, activeSlot: 'A', elapsedA, elapsedB: 0 };
  renderTimerCard();
  renderBlockFocus();
  renderPlanBanner();
}

function switchPivot() {
  if (!ui.pivot) return;
  const { blockA, blockB, activeSlot } = ui.pivot;
  const currentElapsed = ui.timerRunning
    ? ui.timerElapsedMs + (Date.now() - ui.timerStartedAt)
    : ui.timerElapsedMs;
  clearInterval(ui.timerInterval);
  ui.timerRunning = false;
  if (activeSlot === 'A') {
    ui.pivot.elapsedA = currentElapsed;
    ui.pivot.activeSlot = 'B';
    ui.activeBlock = blockB;
    ui.timerElapsedMs = ui.pivot.elapsedB;
  } else {
    ui.pivot.elapsedB = currentElapsed;
    ui.pivot.activeSlot = 'A';
    ui.activeBlock = blockA;
    ui.timerElapsedMs = ui.pivot.elapsedA;
  }
  ui.timerStartedAt = Date.now();
  ui.timerRunning = true;
  state.timerState = { activeBlock: ui.activeBlock, startedAt: ui.timerStartedAt, elapsedMs: ui.timerElapsedMs, date: todayStr() };
  save();
  ui.timerInterval = setInterval(tickTimer, 500);
  showBlockFocus(ui.activeBlock);
  renderTimerCard();
  renderPlanBanner();
  renderScheduleGrid();
}

function endPivot() {
  if (!ui.pivot) return;
  const { blockA, blockB, activeSlot, elapsedA, elapsedB } = ui.pivot;
  // The paused block (the "other" one) becomes the new active block
  const otherIdx = activeSlot === 'A' ? blockB : blockA;
  const otherElapsed = activeSlot === 'A' ? elapsedB : elapsedA;
  // Stop current timer
  clearInterval(ui.timerInterval);
  ui.timerRunning = false;
  ui.pivot = null;
  // Start the paused block's timer from where it left off
  ui.activeBlock = otherIdx;
  ui.timerElapsedMs = otherElapsed;
  ui.timerStartedAt = Date.now();
  ui.timerRunning = true;
  state.timerState = { activeBlock: otherIdx, startedAt: ui.timerStartedAt, elapsedMs: otherElapsed, date: todayStr() };
  save();
  ui.timerInterval = setInterval(tickTimer, 500);
  showBlockFocus(otherIdx);
  renderAll();
}

function completeBlock(idx) {
  const day = currentDayData();
  const span = (day.blockSpan || {})[idx] || 1;
  let changed = false;
  for (let i = 0; i < span; i++) {
    if (!day.completed.includes(idx + i)) {
      day.completed.push(idx + i);
      changed = true;
    }
  }
  if (changed) {
    setDay(ui.currentDate, day);
    save();
  }
  // If this block is the active timer block, stop the timer
  if (ui.activeBlock === idx) {
    clearInterval(ui.timerInterval);
    ui.timerRunning = false;
    ui.timerElapsedMs = 0;
    ui.timerStartedAt = null;
    ui.activeBlock = null;
    state.timerState = { activeBlock: null, startedAt: null, elapsedMs: 0, date: null };
    if (ui.pivot) ui.pivot = null;
    save();
    hideBlockFocus();
  }
  // If this was the non-active pivot partner, end the pivot
  if (ui.pivot && (idx === ui.pivot.blockA || idx === ui.pivot.blockB)) {
    ui.pivot = null;
  }
}

// Shift all blocks from `fromIdx` onwards forward by one 30-min slot.
// Blocks that would overflow past slot 35 are silently dropped.
function shiftBlocksForward(day, fromIdx) {
  if (!day.schedule) day.schedule = {};
  if (!day.blockSpan) day.blockSpan = {};
  if (!day.blockNotes) day.blockNotes = {};
  for (let i = 35; i >= fromIdx; i--) {
    const dest = i + 1;
    if (dest <= 35) {
      if (day.schedule[i] !== undefined) day.schedule[dest] = day.schedule[i];
      if (day.blockSpan[i] !== undefined) day.blockSpan[dest] = day.blockSpan[i];
      if (day.blockNotes[i] !== undefined) day.blockNotes[dest] = day.blockNotes[i];
    }
    delete day.schedule[i];
    delete day.blockSpan[i];
    delete day.blockNotes[i];
  }
  day.completed = (day.completed || []).map(i => i >= fromIdx ? Math.min(i + 1, 35) : i);
}

// Shift all blocks from `fromIdx` onwards backward by one 30-min slot.
function shiftBlocksBackward(day, fromIdx) {
  if (fromIdx > 35) return;
  if (!day.schedule) return;
  if (!day.blockSpan) day.blockSpan = {};
  if (!day.blockNotes) day.blockNotes = {};
  for (let i = fromIdx; i <= 35; i++) {
    const src = i + 1;
    if (src <= 35) {
      if (day.schedule[src] !== undefined) day.schedule[i] = day.schedule[src]; else delete day.schedule[i];
      if (day.blockSpan[src] !== undefined) day.blockSpan[i] = day.blockSpan[src]; else delete day.blockSpan[i];
      if (day.blockNotes[src] !== undefined) day.blockNotes[i] = day.blockNotes[src]; else delete day.blockNotes[i];
    } else {
      delete day.schedule[i];
      delete day.blockSpan[i];
      delete day.blockNotes[i];
    }
  }
  day.completed = (day.completed || []).map(i => i >= fromIdx ? i - 1 : i);
}

// Shrink a 1-hour block back to 30 minutes, shifting later blocks back to fill the gap.
function shrinkBlock(blockIdx) {
  const day = currentDayData();
  if (!day.blockSpan) day.blockSpan = {};
  const span = day.blockSpan[blockIdx] || 1;
  if (span < 2) return;
  delete day.blockSpan[blockIdx];
  day.completed = (day.completed || []).filter(i => i !== blockIdx + 1);
  shiftBlocksBackward(day, blockIdx + 1);
  if (ui.activeBlock === blockIdx) {
    ui.timerElapsedMs = Math.min(ui.timerElapsedMs, 29 * 60 * 1000);
  }
  setDay(ui.currentDate, day);
  save();
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
  renderBlockFocus();
}

// Extend a currently-running 30-min block to 1 hour.
// Called from focus screen while timer is running.
function extendBlock(blockIdx) {
  const day = currentDayData();
  const span = (day.blockSpan || {})[blockIdx] || 1;
  if (span !== 1) return; // already 1hr or longer
  if (blockIdx + 1 > 35) { alert('Not enough room to extend this block.'); return; }
  const projId = (day.schedule || {})[blockIdx];
  if (!projId) return;
  if (!day.blockSpan) day.blockSpan = {};
  // If the next slot has a different project, push everything back to make room
  if (day.schedule[blockIdx + 1] && day.schedule[blockIdx + 1] !== projId) {
    shiftBlocksForward(day, blockIdx + 1);
  }
  // Clear the next slot and set this block to 1-hour span
  delete day.schedule[blockIdx + 1];
  day.completed = (day.completed || []).filter(i => i !== blockIdx + 1);
  if (day.blockNotes) delete day.blockNotes[blockIdx + 1];
  delete day.blockSpan[blockIdx + 1];
  day.schedule[blockIdx + 1] = projId;
  day.blockSpan[blockIdx] = 2;
  setDay(ui.currentDate, day);
  save();
  // Timer duration auto-updates from blockSpan — no elapsed time change needed
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
  renderBlockFocus();
}

// Extend a just-completed 30-min block by 30 more minutes and restart the timer.
// Called from the block complete popup.
function extendBlockFromAlarm(completedIdx) {
  const day = currentDayData();
  const span = (day.blockSpan || {})[completedIdx] || 1;
  if (span !== 1) return;
  if (completedIdx + 1 > 35) { alert('Not enough room to extend this block.'); return; }
  const projId = (day.schedule || {})[completedIdx];
  if (!projId) return;
  if (!day.blockSpan) day.blockSpan = {};
  // If the next slot has a different project, push everything back to make room
  if (day.schedule[completedIdx + 1] && day.schedule[completedIdx + 1] !== projId) {
    shiftBlocksForward(day, completedIdx + 1);
  }
  // Expand to 1-hour block
  delete day.schedule[completedIdx + 1];
  day.completed = day.completed.filter(i => i !== completedIdx && i !== completedIdx + 1);
  if (day.blockNotes) delete day.blockNotes[completedIdx + 1];
  delete day.blockSpan[completedIdx + 1];
  day.schedule[completedIdx + 1] = projId;
  day.blockSpan[completedIdx] = 2;
  setDay(ui.currentDate, day);
  // Dismiss the popup and stop sound
  dismissPopup();
  // Restart timer — 30 minutes already elapsed, 30 minutes remain
  clearInterval(ui.timerInterval);
  requestNotifPermission();
  ui.activeBlock = completedIdx;
  ui.timerElapsedMs = 30 * 60 * 1000;
  ui.timerStartedAt = Date.now();
  ui.timerRunning = true;
  state.timerState = {
    activeBlock: completedIdx,
    startedAt: ui.timerStartedAt,
    elapsedMs: ui.timerElapsedMs,
    date: todayStr()
  };
  save();
  ui.timerInterval = setInterval(tickTimer, 500);
  switchTab('today');
  showBlockFocus(completedIdx);
  renderAll();
}

// ════════════════════════════════════════════════════════════
//  SCHEDULE MUTATIONS
// ════════════════════════════════════════════════════════════
function assignBlock(blockIdx, projId) {
  const day = currentDayData();
  if (!day.blockSpan) day.blockSpan = {};
  if (!day.blockNotes) day.blockNotes = {};
  // If replacing the start of a 1-hr block, shrink and shift subsequent blocks back
  if ((day.blockSpan[blockIdx] || 1) >= 2) {
    delete day.blockSpan[blockIdx];
    day.completed = (day.completed || []).filter(i => i !== blockIdx + 1);
    delete day.blockNotes[blockIdx + 1];
    shiftBlocksBackward(day, blockIdx + 1);
  }
  // If replacing the second half of a 1-hr block, shrink its start and shift back
  const spanStart = Object.keys(day.blockSpan).map(Number).find(si => day.blockSpan[si] >= 2 && si + 1 === blockIdx);
  if (spanStart !== undefined) {
    delete day.blockSpan[spanStart];
    delete day.schedule[spanStart];
    day.completed = (day.completed || []).filter(i => i !== spanStart);
    delete day.blockNotes[spanStart];
    shiftBlocksBackward(day, blockIdx);
    // blockIdx has shifted back by 1; re-target the same logical position
    blockIdx = blockIdx - 1;
  }
  if (day.schedule[blockIdx] && day.schedule[blockIdx] !== projId) {
    delete day.blockNotes[blockIdx];
  }
  day.schedule[blockIdx] = projId;
  setDay(ui.currentDate, day);
  save();
  closeDropdown();
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
}

function assignBlock1hr(blockIdx, projId) {
  const day = currentDayData();
  if (!day.blockSpan) day.blockSpan = {};
  if (!day.blockNotes) day.blockNotes = {};
  // Clear notes on replaced slots
  if (day.schedule[blockIdx] && day.schedule[blockIdx] !== projId) delete day.blockNotes[blockIdx];
  if (day.schedule[blockIdx + 1] && day.schedule[blockIdx + 1] !== projId) delete day.blockNotes[blockIdx + 1];
  // Check if there's space for a 1-hour block
  if (blockIdx + 1 > 35) {
    alert('Not enough space for a 1-hour block at this time.');
    return;
  }
  const existingSpan = day.blockSpan[blockIdx] || 1;
  if (existingSpan >= 2) {
    // Replacing an existing 1-hr block: clear its span tag so we can reuse both slots cleanly
    delete day.blockSpan[blockIdx];
    day.completed = (day.completed || []).filter(i => i !== blockIdx + 1);
  } else if (day.schedule[blockIdx + 1]) {
    // Next slot is a separate block — push it forward to make room
    shiftBlocksForward(day, blockIdx + 1);
  }
  day.schedule[blockIdx] = projId;
  day.schedule[blockIdx + 1] = projId;
  day.blockSpan[blockIdx] = 2; // marks as 1-hour span start
  setDay(ui.currentDate, day);
  save();
  closeDropdown();
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
}

function clearBlock(blockIdx) {
  const day = currentDayData();
  const bn = (day.blockNotes || {})[blockIdx];
  const hasNote = (bn && bn.note || '').trim().length > 0;
  const todos = (bn && bn.todos) || [];
  const hasTodos = todos.length > 0;

  // Build warning message listing what will be lost
  const warnings = [];
  if (hasNote) warnings.push('the notes written for this block');
  if (hasTodos) warnings.push(todos.length + ' to-do item' + (todos.length !== 1 ? 's' : '') + ' (including from Today)');
  if (warnings.length) {
    const msg = 'Archiving this block will also remove ' + warnings.join(' and ') + '.\n\nThis cannot be undone. Continue?';
    if (!confirm(msg)) return;
  }

  const span = (day.blockSpan || {})[blockIdx] || 1;
  // Clear this block's slots and meta
  for (let i = 0; i < span; i++) {
    delete day.schedule[blockIdx + i];
    if (day.blockNotes) delete day.blockNotes[blockIdx + i];
  }
  if (day.blockSpan) delete day.blockSpan[blockIdx];
  day.completed = (day.completed || []).filter(i => i < blockIdx || i >= blockIdx + span);
  // Shift all subsequent blocks backward to close the gap
  for (let s = 0; s < span; s++) shiftBlocksBackward(day, blockIdx);
  if (ui.activeBlock === blockIdx) doneTimer();
  setDay(ui.currentDate, day);
  save();
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
}

function moveBlock(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const day = currentDayData();
  const sched = day.schedule || {};
  const notes = day.blockNotes || {};
  if (!day.blockSpan) day.blockSpan = {};
  const spans = day.blockSpan;

  const fromSpan = spans[fromIdx] || 1;

  if (fromSpan >= 2) {
    // Moving a 1-hour block — swap both slots with the destination pair
    if (toIdx + 1 > 35) { alert('Not enough room to move this block here.'); return; }

    const fp0 = sched[fromIdx], fp1 = sched[fromIdx + 1];
    const fn0 = notes[fromIdx];
    const fd0 = day.completed.includes(fromIdx);

    const tp0 = sched[toIdx], tp1 = sched[toIdx + 1];
    const tn0 = notes[toIdx], tn1 = notes[toIdx + 1];
    const td0 = day.completed.includes(toIdx), td1 = day.completed.includes(toIdx + 1);
    const toSpan0 = spans[toIdx] || 1;

    // Place 1-hour block at destination
    sched[toIdx] = fp0; sched[toIdx + 1] = fp1;
    spans[toIdx] = 2; delete spans[toIdx + 1];
    if (fn0) notes[toIdx] = fn0; else delete notes[toIdx];
    delete notes[toIdx + 1];

    // Place destination's content back at source slots
    if (tp0) sched[fromIdx] = tp0; else delete sched[fromIdx];
    if (tp1) sched[fromIdx + 1] = tp1; else delete sched[fromIdx + 1];
    delete spans[fromIdx];
    if (toSpan0 >= 2) spans[fromIdx] = 2;
    if (tn0) notes[fromIdx] = tn0; else delete notes[fromIdx];
    if (tn1) notes[fromIdx + 1] = tn1; else delete notes[fromIdx + 1];

    day.completed = day.completed.filter(i => i !== fromIdx && i !== fromIdx + 1 && i !== toIdx && i !== toIdx + 1);
    if (fd0) day.completed.push(toIdx);
    if (td0) day.completed.push(fromIdx);
    if (td1) day.completed.push(fromIdx + 1);

    if (ui.activeBlock === fromIdx) ui.activeBlock = toIdx;
    else if (ui.activeBlock === toIdx || ui.activeBlock === toIdx + 1) ui.activeBlock = fromIdx;
  } else {
    // 30-min block swap
    const fromProj = sched[fromIdx], toProj = sched[toIdx];
    if (toProj) sched[fromIdx] = toProj;
    else delete sched[fromIdx];
    sched[toIdx] = fromProj;
    const fromNote = notes[fromIdx], toNote = notes[toIdx];
    if (fromNote) notes[toIdx] = fromNote; else delete notes[toIdx];
    if (toNote) notes[fromIdx] = toNote; else delete notes[fromIdx];
    const fromDone = day.completed.includes(fromIdx), toDone = day.completed.includes(toIdx);
    day.completed = day.completed.filter(i => i !== fromIdx && i !== toIdx);
    if (fromDone) day.completed.push(toIdx);
    if (toDone) day.completed.push(fromIdx);
    if (ui.activeBlock === fromIdx) ui.activeBlock = toIdx;
    else if (ui.activeBlock === toIdx) ui.activeBlock = fromIdx;
  }

  day.schedule = sched;
  day.blockNotes = notes;
  setDay(ui.currentDate, day);
  save();
  renderScheduleGrid();
  renderSidebar();
  renderTodayTab();
  renderHeaderStats();
}

function compactSchedule() {
  const day = currentDayData();
  const sched = day.schedule || {};
  const blockSpan = day.blockSpan || {};
  const blockNotes = day.blockNotes || {};
  const doneSet = new Set(day.completed || []);
  const spannedSlots = new Set();
  Object.entries(blockSpan).forEach(([si, span]) => {
    for (let i = 1; i < span; i++) spannedSlots.add(+si + i);
  });
  const blocks = [];
  for (let i = 0; i <= 35; i++) {
    if (sched[i] && !spannedSlots.has(i)) {
      blocks.push({ projId: sched[i], span: blockSpan[i] || 1, done: doneSet.has(i), notes: blockNotes[i] || null });
    }
  }
  day.schedule = {};
  day.blockSpan = {};
  day.completed = [];
  day.blockNotes = {};
  let cursor = 0;
  blocks.forEach(b => {
    day.schedule[cursor] = b.projId;
    if (b.span >= 2) {
      day.blockSpan[cursor] = b.span;
      for (let i = 1; i < b.span; i++) day.schedule[cursor + i] = b.projId;
    }
    if (b.done) day.completed.push(cursor);
    if (b.notes) day.blockNotes[cursor] = b.notes;
    cursor += b.span;
  });
  setDay(ui.currentDate, day);
  save();
  renderScheduleGrid();
}

function toggleTimeOff() {
  const day = currentDayData();
  day.timeOff = !day.timeOff;
  setDay(ui.currentDate, day);
  save();
  renderAll();
}

// ════════════════════════════════════════════════════════════
//  NOTES MODAL
// ════════════════════════════════════════════════════════════
function openNotesModal(blockIdx, ds, notesOnly) {
  ui.notesBlockIdx = blockIdx;
  ui.notesDate = ds || ui.currentDate;
  const day = getDay(ui.notesDate),
    proj = getProject((day.schedule || {})[blockIdx]);
  const [h, half] = blockToTime(blockIdx);
  const ex = (day.blockNotes || {})[blockIdx] || {
    note: '',
    todos: []
  };
  document.getElementById('notes-modal-proj').textContent = proj ? `${proj.emoji} ${proj.name}` : 'Block';
  document.getElementById('notes-modal-proj').style.color = proj ? proj.color : 'var(--text)';
  const seqNum = blockSequentialNum(blockIdx, ui.notesDate);
  document.getElementById('notes-modal-time').textContent = seqNum !== null ? `Block ${seqNum}` : formatTime(h, half);
  document.getElementById('notes-textarea').value = ex.note || '';
  document.getElementById('notes-textarea')._savedValue = ex.note || '';
  const resumeTextarea = document.getElementById('notes-resume-textarea');
  if (resumeTextarea) resumeTextarea.value = ex.resumeNote || '';
  // Importance stars
  const impVal = ex.importance || 0;

  function updateStars(val) {
    document.querySelectorAll('#star-picker .star-btn').forEach(b => b.classList.toggle('active', +b.dataset.val <= val));
  }
  updateStars(impVal);
  document.querySelectorAll('#star-picker .star-btn').forEach(btn => {
    btn.onclick = () => {
      const cur = [...document.querySelectorAll('#star-picker .star-btn')].filter(b => b.classList.contains('active')).length;
      const newVal = (cur === +btn.dataset.val) ? 0 : +btn.dataset.val;
      updateStars(newVal);
    };
  });
  document.getElementById('clear-imp-btn').onclick = () => updateStars(0);
  // Tags
  const currentTags = ex.tags || [];
  const tagPicker = document.getElementById('notes-tag-picker');
  tagPicker.innerHTML = '';
  (state.settings.tags || []).forEach(tag => {
    const active = currentTags.includes(tag.id);
    const btn = document.createElement('button');
    btn.dataset.tagId = tag.id;
    btn.className = 'tag-pill-btn' + (active ? ' active' : '');
    btn.style.cssText = `border-color:${tag.color}50;--tag-color:${tag.color}`;
    btn.innerHTML = `<span style="background:${tag.color}"></span>${tag.name ? escAttr(tag.name) : ''}`;
    btn.onclick = () => btn.classList.toggle('active');
    tagPicker.appendChild(btn);
  });
  // Meeting toggle
  const meetingBtn = document.getElementById('notes-meeting-btn');
  meetingBtn.classList.toggle('active', !!ex.meeting);
  meetingBtn.onclick = () => meetingBtn.classList.toggle('active');
  // Markdown edit/preview setup
  const modal = document.getElementById('notes-modal');
  const textarea = document.getElementById('notes-textarea');
  const preview = document.getElementById('notes-md-preview');
  const editBtn = document.getElementById('notes-mode-edit');
  const previewBtn = document.getElementById('notes-mode-preview');
  const liveBtn = document.getElementById('notes-live-btn');
  const editArea = document.getElementById('notes-edit-area');
  // Reset state
  modal.classList.toggle('notes-only', !!notesOnly);
  modal.classList.remove('notes-standalone');
  editArea.classList.remove('live');
  textarea.oninput = null;
  preview.onclick = null;

  if (notesOnly) {
    editBtn.style.display = 'none';
    previewBtn.style.display = 'none';
    liveBtn.style.display = '';
    function updateLiveState() {
      liveBtn.classList.toggle('active', ui.notesLivePreview);
      liveBtn.textContent = ui.notesLivePreview ? 'HIDE PREVIEW' : 'SHOW PREVIEW';
      editArea.classList.toggle('live', ui.notesLivePreview);
      if (ui.notesLivePreview) preview.innerHTML = renderMarkdown(textarea.value);
    }
    updateLiveState();
    textarea.oninput = () => { if (editArea.classList.contains('live')) preview.innerHTML = renderMarkdown(textarea.value); };
    liveBtn.onclick = () => {
      ui.notesLivePreview = !ui.notesLivePreview;
      updateLiveState();
    };
  } else {
    editBtn.style.display = '';
    previewBtn.style.display = '';
    liveBtn.style.display = 'none';
    function showEdit() {
      textarea.style.display = '';
      preview.style.display = 'none';
      editBtn.classList.add('active');
      previewBtn.classList.remove('active');
    }
    function showPreview() {
      preview.innerHTML = renderMarkdown(textarea.value);
      textarea.style.display = 'none';
      preview.style.display = 'block';
      previewBtn.classList.add('active');
      editBtn.classList.remove('active');
    }
    showEdit();
    editBtn.onclick = showEdit;
    previewBtn.onclick = showPreview;
    preview.onclick = showEdit;
    renderBlockProjTodos(proj?.id, blockIdx, ui.notesDate);
  }

  document.getElementById('notes-overlay').classList.add('open');
  setTimeout(() => document.getElementById('notes-textarea').focus(), 50);
}

function renderTodoList(todos) {
  const list = document.getElementById('todo-list');
  list.innerHTML = '';
  todos.forEach(t => {
    const item = document.createElement('div');
    item.className = 'todo-item';
    item.dataset.id = t.id;
    item.innerHTML = `<input type="checkbox" class="todo-cb" ${t.done?'checked':''}><input type="text" class="todo-text${t.done?' done':''}" value="${escAttr(t.text)}"><button class="todo-del">✕</button>`;
    item.querySelector('.todo-cb').onchange = e => item.querySelector('.todo-text').classList.toggle('done', e.target.checked);
    item.querySelector('.todo-del').onclick = () => item.remove();
    list.appendChild(item);
  });
}

function openProjNoteModal(projId, noteId) {
  const proj = getProject(projId);
  ui.notesIsStandalone = true;
  ui.notesProjId = projId;
  ui.notesStandaloneId = noteId || null;

  const existing = noteId
    ? ((state.projNotes[projId] || []).find(n => n.id === noteId) || {})
    : {};

  document.getElementById('notes-modal-proj').textContent = proj ? `${proj.emoji} ${proj.name}` : 'Project';
  document.getElementById('notes-modal-proj').style.color = proj ? proj.color : 'var(--text)';
  document.getElementById('notes-modal-time').textContent = noteId ? (existing.date || '') : 'New Note';
  document.getElementById('notes-textarea').value = existing.note || '';
  document.getElementById('notes-textarea')._savedValue = existing.note || '';

  const impVal = existing.importance || 0;
  function updateStars(val) {
    document.querySelectorAll('#star-picker .star-btn').forEach(b => b.classList.toggle('active', +b.dataset.val <= val));
  }
  updateStars(impVal);
  document.querySelectorAll('#star-picker .star-btn').forEach(btn => {
    btn.onclick = () => {
      const cur = [...document.querySelectorAll('#star-picker .star-btn')].filter(b => b.classList.contains('active')).length;
      updateStars((cur === +btn.dataset.val) ? 0 : +btn.dataset.val);
    };
  });
  document.getElementById('clear-imp-btn').onclick = () => updateStars(0);

  const currentTags = existing.tags || [];
  const tagPicker = document.getElementById('notes-tag-picker');
  tagPicker.innerHTML = '';
  (state.settings.tags || []).forEach(tag => {
    const active = currentTags.includes(tag.id);
    const btn = document.createElement('button');
    btn.dataset.tagId = tag.id;
    btn.className = 'tag-pill-btn' + (active ? ' active' : '');
    btn.style.cssText = `border-color:${tag.color}50;--tag-color:${tag.color}`;
    btn.innerHTML = `<span style="background:${tag.color}"></span>${tag.name ? escAttr(tag.name) : ''}`;
    btn.onclick = () => btn.classList.toggle('active');
    tagPicker.appendChild(btn);
  });

  const meetingBtn = document.getElementById('notes-meeting-btn');
  meetingBtn.classList.toggle('active', !!existing.meeting);
  meetingBtn.onclick = () => meetingBtn.classList.toggle('active');

  const modal = document.getElementById('notes-modal');
  const textarea = document.getElementById('notes-textarea');
  const preview = document.getElementById('notes-md-preview');
  const editBtn = document.getElementById('notes-mode-edit');
  const previewBtn = document.getElementById('notes-mode-preview');
  const liveBtn = document.getElementById('notes-live-btn');
  const editArea = document.getElementById('notes-edit-area');

  modal.classList.remove('notes-only');
  modal.classList.add('notes-standalone');
  editArea.classList.remove('live');
  textarea.oninput = null;
  preview.onclick = null;
  editBtn.style.display = '';
  previewBtn.style.display = '';
  liveBtn.style.display = 'none';

  function showEdit() {
    textarea.style.display = '';
    preview.style.display = 'none';
    editBtn.classList.add('active');
    previewBtn.classList.remove('active');
  }
  function showPreview() {
    preview.innerHTML = renderMarkdown(textarea.value);
    textarea.style.display = 'none';
    preview.style.display = 'block';
    previewBtn.classList.add('active');
    editBtn.classList.remove('active');
  }
  showEdit();
  editBtn.onclick = showEdit;
  previewBtn.onclick = showPreview;
  preview.onclick = showEdit;

  document.getElementById('notes-overlay').classList.add('open');
  setTimeout(() => document.getElementById('notes-textarea').focus(), 50);
}

function saveNotesModal() {
  if (ui.notesIsStandalone) {
    const projId = ui.notesProjId;
    const note = document.getElementById('notes-textarea').value;
    const importance = [...document.querySelectorAll('#star-picker .star-btn')].filter(b => b.classList.contains('active')).length || null;
    const tags = [...document.querySelectorAll('#notes-tag-picker .tag-pill-btn.active')].map(b => b.dataset.tagId);
    const meeting = document.getElementById('notes-meeting-btn').classList.contains('active') || undefined;
    if (!state.projNotes[projId]) state.projNotes[projId] = [];
    const noteId = ui.notesStandaloneId;
    if (noteId) {
      const idx = state.projNotes[projId].findIndex(n => n.id === noteId);
      if (idx >= 0) {
        state.projNotes[projId][idx] = { ...state.projNotes[projId][idx], note, importance, tags: tags.length ? tags : undefined, meeting: meeting || undefined };
      }
    } else {
      state.projNotes[projId].push({ id: 'pn_' + Date.now(), date: todayStr(), note, importance, tags: tags.length ? tags : undefined, meeting: meeting || undefined });
    }
    save();
    closeNotesModal();
    renderNotesTab();
    return;
  }

  const blockIdx = ui.notesBlockIdx,
    ds = ui.notesDate;
  const note = document.getElementById('notes-textarea').value;
  const resumeNote = (document.getElementById('notes-resume-textarea')?.value || '').trim() || undefined;
  const importance = [...document.querySelectorAll('#star-picker .star-btn')].filter(b => b.classList.contains('active')).length || null;
  const tags = [...document.querySelectorAll('#notes-tag-picker .tag-pill-btn.active')].map(b => b.dataset.tagId);
  const meeting = document.getElementById('notes-meeting-btn').classList.contains('active') || undefined;
  const day = getDay(ds);
  if (!day.blockNotes) day.blockNotes = {};
  const existingProjTodos = (day.blockNotes[blockIdx] || {}).projTodos || [];
  day.blockNotes[blockIdx] = {
    note,
    resumeNote,
    todos: [],
    projTodos: existingProjTodos,
    importance,
    tags: tags.length ? tags : undefined,
    meeting: meeting || undefined
  };
  setDay(ds, day);
  save();
  closeNotesModal();
  renderScheduleGrid();
  renderTodayTab();
  renderNotesTab();
}

function closeNotesModal() {
  document.getElementById('notes-overlay').classList.remove('open');
  document.getElementById('notes-modal').classList.remove('notes-standalone');
  ui.notesBlockIdx = null;
  ui.notesDate = null;
  ui.notesIsStandalone = false;
  ui.notesProjId = null;
  ui.notesStandaloneId = null;
}


// ════════════════════════════════════════════════════════════
//  PROJECT TODOS
// ════════════════════════════════════════════════════════════
function getProjTodos(projId) {
  if (!state.projectTodos[projId]) state.projectTodos[projId] = [];
  return state.projectTodos[projId];
}

function addProjTodo(projId, text, dueDate) {
  if (!text.trim()) return;
  getProjTodos(projId).push({
    id: String(Date.now() + Math.random()),
    text: text.trim(),
    done: false,
    dueDate: dueDate || null,
    history: []
  });
  save();
}

function deleteProjTodo(projId, todoId) {
  state.projectTodos[projId] = (state.projectTodos[projId] || []).filter(t => t.id !== todoId);
  save();
}
// Mark project todo as fully done (from block or todos tab)
function completeProjTodo(projId, todoId, blockIdx, ds) {
  const todos = getProjTodos(projId);
  const t = todos.find(x => x.id === todoId);
  if (!t) return;
  t.done = true;
  t.history = t.history || [];
  t.history.push({
    date: ds || todayStr(),
    type: 'done',
    blockIdx: blockIdx ?? null
  });
  save();
}
// Mark progress on project todo (checked off daily, not global)
function progressProjTodo(projId, todoId, blockIdx, ds) {
  const todos = getProjTodos(projId);
  const t = todos.find(x => x.id === todoId);
  if (!t) return;
  t.history = t.history || [];
  // Toggle: if already progressed today, remove it
  const ds2 = ds || todayStr();
  const existingIdx = t.history.findIndex(h => h.date === ds2 && h.type === 'progress' && (blockIdx === undefined || h.blockIdx === blockIdx));
  if (existingIdx >= 0) {
    t.history.splice(existingIdx, 1);
  } else {
    t.history.push({
      date: ds2,
      type: 'progress',
      blockIdx: blockIdx ?? null
    });
  }
  save();
}

function hasProjTodoProgressToday(projId, todoId, ds) {
  const t = (getProjTodos(projId) || []).find(x => x.id === todoId);
  if (!t) return false;
  return (t.history || []).some(h => h.date === (ds || todayStr()) && h.type === 'progress');
}

// Render project todos in notes modal for the block's project
// Shows all project todos with "add to block" if not pinned, done/progress if pinned
function renderBlockProjTodos(projId, blockIdx, ds) {
  const section = document.getElementById('block-proj-todos-section');
  const list = document.getElementById('block-proj-todos-list');
  if (!projId) {
    section.style.display = 'none';
    return;
  }
  const proj = getProject(projId);
  const allTodos = getProjTodos(projId).filter(t => !t.done);
  section.style.display = 'block';
  document.getElementById('block-proj-todos-proj-name').textContent = proj ? `${proj.emoji} ${proj.name}` : '';
  list.innerHTML = '';
  const ds2 = ds || ui.currentDate;
  const dayD = getDay(ds2);
  const bn = dayD.blockNotes[blockIdx] || (dayD.blockNotes[blockIdx] = {
    note: '',
    todos: [],
    projTodos: []
  });
  if (!bn.projTodos) bn.projTodos = [];
  allTodos.forEach(t => {
    const isPinned = bn.projTodos.some(r => r.todoId === t.id && r.projId === projId);
    const progressed = isPinned && hasProjTodoProgressToday(projId, t.id, ds2);
    const item = document.createElement('div');
    item.className = 'block-proj-todo-item';
    if (isPinned) {
      item.innerHTML = `
        <input type="checkbox" class="block-proj-todo-cb-done" title="Mark as fully done">
        <span class="block-proj-todo-text">${escAttr(t.text)}</span>
        <input type="checkbox" class="block-proj-todo-cb-progress" title="Log progress today" ${progressed?'checked':''}>
        <span class="block-proj-todo-hint" style="color:var(--gold)">progress</span>
        <button class="block-proj-todo-unpin" title="Remove from block" style="background:none;border:none;color:var(--faint);cursor:pointer;font-size:10px;padding:0 2px">✕</button>`;
      item.querySelector('.block-proj-todo-cb-done').addEventListener('change', e => {
        if (e.target.checked) {
          completeProjTodo(projId, t.id, blockIdx, ds2);
          renderBlockProjTodos(projId, blockIdx, ds);
          renderTodayTodos();
          renderGamePanel();
          if (ui.tab === 'todos') renderTodosTab();
        }
      });
      item.querySelector('.block-proj-todo-cb-progress').addEventListener('change', () => {
        progressProjTodo(projId, t.id, blockIdx, ds2);
        renderBlockProjTodos(projId, blockIdx, ds);
        renderTodayTodos();
        renderGamePanel();
        if (ui.tab === 'todos') renderTodosTab();
      });
      item.querySelector('.block-proj-todo-unpin').addEventListener('click', () => {
        bn.projTodos = bn.projTodos.filter(r => !(r.todoId === t.id && r.projId === projId));
        setDay(ds2, dayD);
        save();
        renderBlockProjTodos(projId, blockIdx, ds);
        renderTodayTodos();
      });
    } else {
      item.innerHTML = `
        <span class="block-proj-todo-text" style="color:var(--muted)">${escAttr(t.text)}</span>
        <button class="block-proj-todo-pin" title="Add to this block" style="background:none;border:1px solid var(--border2);color:var(--faint);cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;padding:2px 6px;border-radius:4px;white-space:nowrap;transition:all .15s">+ add to block</button>`;
      item.querySelector('.block-proj-todo-pin').addEventListener('mouseenter', e => {
        e.target.style.borderColor = 'var(--green)';
        e.target.style.color = 'var(--green)';
      });
      item.querySelector('.block-proj-todo-pin').addEventListener('mouseleave', e => {
        e.target.style.borderColor = 'var(--border2)';
        e.target.style.color = 'var(--faint)';
      });
      item.querySelector('.block-proj-todo-pin').addEventListener('click', () => {
        if (!dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx] = {
          note: '',
          todos: [],
          projTodos: []
        };
        if (!dayD.blockNotes[blockIdx].projTodos) dayD.blockNotes[blockIdx].projTodos = [];
        dayD.blockNotes[blockIdx].projTodos.push({
          projId,
          todoId: t.id
        });
        setDay(ds2, dayD);
        save();
        renderBlockProjTodos(projId, blockIdx, ds);
        renderTodayTodos();
      });
    }
    list.appendChild(item);
  });

  // Wire up add new todo row in notes modal
  const addInput = document.getElementById('block-proj-todos-new-input');
  const addDue = document.getElementById('block-proj-todos-new-due');
  const addBtn = document.getElementById('block-proj-todos-add-btn');
  if (addInput && addBtn) {
    addInput.value = '';
    if (addDue) addDue.value = '';
    addBtn.onclick = null;
    const doModalAdd = () => {
      const text = addInput.value.trim();
      if (!text) return;
      addProjTodo(projId, text, addDue?.value || null);
      addInput.value = '';
      if (addDue) addDue.value = '';
      renderBlockProjTodos(projId, blockIdx, ds);
      renderTodayTodos();
      if (ui.tab === 'todos') renderTodosTab();
    };
    addBtn.onclick = doModalAdd;
    addInput.onkeydown = e => { if (e.key === 'Enter') doModalAdd(); };
  }
}

// ════════════════════════════════════════════════════════════
//  RENDER: TODOS TAB
// ════════════════════════════════════════════════════════════
function renderTodosTab() {
  // Project todos section
  const projList = document.getElementById('proj-todos-list');
  projList.innerHTML = '';
  // Build hierarchical project order
  const todosTopLevel = state.projects.filter(p => !p.parentId);
  const todosProjOrder = [];
  todosTopLevel.forEach(p => {
    todosProjOrder.push({ proj: p, isChild: false });
    state.projects.filter(sp => sp.parentId === p.id).forEach(sp => todosProjOrder.push({ proj: sp, isChild: true }));
  });
  state.projects.filter(p => p.parentId && !state.projects.find(tp => tp.id === p.parentId))
    .forEach(p => todosProjOrder.push({ proj: p, isChild: false }));

  todosProjOrder.forEach(({ proj, isChild }) => {
    const todos = getProjTodos(proj.id);
    const active = todos.filter(t => !t.done);
    const done = todos.filter(t => t.done);
    const group = document.createElement('div');
    group.className = 'proj-todos-group' + (isChild ? ' proj-todos-group-child' : '');
    const chevron = active.length || done.length ? '›' : '';
    const isOpen = ui.openProjTodosIds === null || ui.openProjTodosIds.has(proj.id);
    const childIndent = isChild ? '<span class="proj-todos-child-indent">└</span>' : '';
    group.innerHTML = `<div class="proj-todos-header">
      ${childIndent}<div class="proj-color-dot" style="background:${proj.color}"></div>
      <div class="proj-todos-name" style="color:${proj.color}">${proj.emoji} ${proj.name}</div>
      <div class="proj-todos-count">${active.length} active${done.length?' · '+done.length+' done':''}</div>
      <span class="proj-todos-chevron${isOpen?' open':''}">${chevron}</span>
    </div>
    <div class="proj-todos-body${isOpen?' open':''}">
      <div class="proj-todos-items"></div>
      <div class="add-proj-todo-row">
        <input class="add-proj-todo-input" type="text" placeholder="Add todo for ${escAttr(proj.name)}…" data-proj="${proj.id}">
        <input class="add-proj-todo-due" type="date" title="Due date (optional)" data-proj="${proj.id}">
        <button class="add-proj-todo-btn" data-proj="${proj.id}">+ Add</button>
      </div>
      ${done.length?`<div class="proj-todo-history">
        <button class="proj-todo-history-toggle" data-hist="${proj.id}">▸ Show ${done.length} completed</button>
        <div class="proj-todo-history-list" id="proj-hist-${proj.id}"></div>
      </div>`:''}
    </div>`;
    const header = group.querySelector('.proj-todos-header');
    header.addEventListener('click', () => {
      if (ui.openProjTodosIds === null) {
        ui.openProjTodosIds = new Set(state.projects.map(p => p.id));
      }
      if (isOpen) {
        ui.openProjTodosIds.delete(proj.id);
        // Collapse children if this is a top-level project
        if (!isChild) state.projects.filter(sp => sp.parentId === proj.id).forEach(sp => ui.openProjTodosIds.delete(sp.id));
      } else {
        ui.openProjTodosIds.add(proj.id);
        // Expand children if this is a top-level project
        if (!isChild) state.projects.filter(sp => sp.parentId === proj.id).forEach(sp => ui.openProjTodosIds.add(sp.id));
      }
      renderTodosTab();
    });
    const itemsEl = group.querySelector('.proj-todos-items');
    active.forEach(t => {
      const item = document.createElement('div');
      item.className = 'proj-todo-item';
      const dueDateVal = t.dueDate || '';
      const dueLabelClass = t.dueDate && t.dueDate < todayStr() ? ' overdue' : (t.dueDate === todayStr() ? ' due-today' : '');
      item.innerHTML = `<input type="checkbox" class="proj-todo-cb" ${t.done?'checked':''}><input type="text" class="proj-todo-text" value="${escAttr(t.text)}"><input type="date" class="proj-todo-due${dueLabelClass}" value="${escAttr(dueDateVal)}" title="Due date"><button class="proj-todo-del" title="Delete">✕</button>`;
      item.querySelector('.proj-todo-cb').addEventListener('change', e => {
        if (e.target.checked) {
          completeProjTodo(proj.id, t.id, null, todayStr());
          renderTodosTab();
          renderTodayTodos();
        } else {
          t.done = false;
          save();
          renderTodosTab();
          renderTodayTodos();
        }
      });
      item.querySelector('.proj-todo-text').addEventListener('change', e => {
        t.text = e.target.value;
        save();
      });
      item.querySelector('.proj-todo-due').addEventListener('change', e => {
        t.dueDate = e.target.value || null;
        save();
        renderTodayTodos();
        renderSidebar();
        const dueEl = e.target;
        dueEl.classList.remove('overdue', 'due-today');
        if (t.dueDate) {
          if (t.dueDate < todayStr()) dueEl.classList.add('overdue');
          else if (t.dueDate === todayStr()) dueEl.classList.add('due-today');
        }
      });
      item.querySelector('.proj-todo-del').addEventListener('click', () => {
        if (confirm('Delete this todo?')) {
          deleteProjTodo(proj.id, t.id);
          renderTodosTab();
        }
      });
      itemsEl.appendChild(item);
    });
    const addInput = group.querySelector('.add-proj-todo-input');
    const addDue = group.querySelector('.add-proj-todo-due');
    const addBtn = group.querySelector('.add-proj-todo-btn');
    const doAdd = () => {
      addProjTodo(proj.id, addInput.value, addDue.value || null);
      addInput.value = '';
      addDue.value = '';
      if (ui.openProjTodosIds !== null) ui.openProjTodosIds.add(proj.id);
      renderTodosTab();
      renderTodayTodos();
      renderSidebar();
    };
    addBtn.addEventListener('click', doAdd);
    addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doAdd();
    });
    const histToggle = group.querySelector('[data-hist]');
    if (histToggle) {
      histToggle.addEventListener('click', e => {
        e.stopPropagation();
        const histList = document.getElementById(`proj-hist-${proj.id}`);
        const isHistOpen = histList.classList.contains('open');
        histList.classList.toggle('open', !isHistOpen);
        histToggle.textContent = isHistOpen ? `▸ Show ${done.length} completed` : `▾ Hide completed`;
        if (!isHistOpen) {
          histList.innerHTML = '';
          done.forEach(t => {
            const div = document.createElement('div');
            div.className = 'proj-todo-hist-item';
            const lastDone = t.history?.filter(h => h.type === 'done').slice(-1)[0];
            const progCount = t.history?.filter(h => h.type === 'progress').length || 0;
            div.innerHTML = `<input type="checkbox" class="proj-todo-cb" checked style="flex-shrink:0;accent-color:var(--green)"><span class="proj-todo-hist-type hist-type-done">✓</span><span style="flex:1">${escAttr(t.text)}</span>
              ${lastDone?`<span class="proj-todo-hist-date">${lastDone.date}</span>`:''}
              ${progCount?`<span style="color:var(--faint);font-size:8px">(${progCount} logs)</span>`:''}
              <button class="proj-todo-del" title="Delete" style="opacity:1;color:var(--faint)">✕</button>`;
            div.querySelector('.proj-todo-cb').addEventListener('change', e => {
              if (!e.target.checked) {
                t.done = false;
                save();
                renderTodosTab();
                renderTodayTodos();
              }
            });
            div.querySelector('.proj-todo-del').addEventListener('click', () => {
              if (confirm('Delete this todo?')) {
                deleteProjTodo(proj.id, t.id);
                renderTodosTab();
              }
            });
            histList.appendChild(div);
          });
        }
      });
    }
    projList.appendChild(group);
  });
  // Daily todos section
  const ds = todayStr();
  const dailyList = document.getElementById('todos-tab-daily-list');
  dailyList.innerHTML = '';
  const day = getDay(ds),
    sched = day.schedule || {};
  const allDailyTodos = [];
  Object.entries(day.blockNotes || {}).forEach(([idx, n]) => {
    const proj = getProject(sched[+idx]);
    (n.todos || []).forEach(t => {
      allDailyTodos.push({
        type: 'daily',
        t,
        blockIdx: +idx,
        proj
      });
    });
    (n.projTodos || []).forEach(ref => {
      const todo = (getProjTodos(ref.projId) || []).find(x => x.id === ref.todoId);
      if (!todo) return;
      const projT = getProject(ref.projId);
      allDailyTodos.push({
        type: 'proj',
        t: todo,
        blockIdx: +idx,
        proj: projT,
        projId: ref.projId
      });
    });
  });
  if (!allDailyTodos.length) {
    dailyList.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--faint);padding:8px 0">No todos yet. Add them via the 📝 notes on a block.</div>`;
  } else {
    allDailyTodos.forEach(({
      type,
      t,
      blockIdx,
      proj,
      projId
    }) => {
      const item = document.createElement('div');
      item.className = 'today-todo-entry';
      const isDone = t.done || (type === 'proj' && ((getProjTodos(projId) || []).find(x => x.id === t.id)?.done || hasProjTodoProgressToday(projId, t.id, ds)));
      item.innerHTML = `<input type="checkbox" class="today-todo-cb daily-cb" ${isDone?'checked':''}><span class="today-todo-label${isDone?' done':''}">${escAttr(t.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:auto">${proj.emoji}</span>`:''}`;
      item.querySelector('.today-todo-cb').addEventListener('change', e => {
        if (type === 'daily') {
          const dayD = getDay(ds);
          const bn = dayD.blockNotes[blockIdx];
          if (bn) {
            const todo = bn.todos.find(x => x.id === t.id);
            if (todo) {
              todo.done = e.target.checked;
              setDay(ds, dayD);
              save();
              renderTodosTab();
              renderTodayTodos();
            }
          }
        } else {
          if (e.target.checked) {
            completeProjTodo(projId, t.id, blockIdx, ds);
            renderTodosTab();
            renderTodayTodos();
          } else e.target.checked = false;
        }
      });
      dailyList.appendChild(item);
    });
  }
}

// ════════════════════════════════════════════════════════════
//  RENDER: TODAY TODOS PANEL (in Today tab)
// ════════════════════════════════════════════════════════════
function renderTodayTodos() {
  const list = document.getElementById('today-todos-list');
  if (!list) return;
  list.innerHTML = '';
  const ds = todayStr();
  const day = getDay(ds);
  const sched = day.schedule || {};

  // ── Active section ──────────────────────────────────────
  // 1. Daily block todos (not done)
  // 2. Project todos explicitly pinned to a block via blockNotes.projTodos (not done, not progressed-only)
  const activeItems = []; // {type:'daily'|'proj', ...data}
  const completedItems = []; // {type:'daily'|'proj', ...data}

  // Collect daily todos from block notes
  Object.entries(day.blockNotes || {}).forEach(([rawIdx, n]) => {
    const idx = +rawIdx;
    const proj = getProject(sched[idx]);
    (n.todos || []).forEach(t => {
      const entry = {
        type: 'daily',
        t,
        idx,
        proj
      };
      if (t.done) completedItems.push(entry);
      else activeItems.push(entry);
    });
    // Project todos pinned to this block
    (n.projTodos || []).forEach(ref => {
      const projT = getProject(ref.projId);
      const todoList = getProjTodos(ref.projId);
      const todo = todoList.find(x => x.id === ref.todoId);
      if (!todo) return;
      const progressed = hasProjTodoProgressToday(ref.projId, ref.todoId, ds);
      const entry = {
        type: 'proj',
        todo,
        proj: projT,
        projId: ref.projId,
        blockIdx: idx
      };
      if (todo.done) completedItems.push(entry);
      else if (progressed) completedItems.push({
        ...entry,
        progressOnly: true
      });
      else activeItems.push(entry);
    });
  });

  // Collect all pinned todo IDs to exclude from "due today unassigned"
  const assignedTodoIds = new Set(activeItems.filter(e => e.type === 'proj').map(e => `${e.projId}:${e.todo.id}`));
  completedItems.filter(e => e.type === 'proj').forEach(e => assignedTodoIds.add(`${e.projId}:${e.todo.id}`));

  // ── Due Today (unassigned) ──────────────────────────────
  const dueTodayItems = [];
  state.projects.forEach(p => {
    getProjTodos(p.id).filter(t => !t.done && t.dueDate === ds && !assignedTodoIds.has(`${p.id}:${t.id}`))
      .forEach(t => dueTodayItems.push({ type: 'proj', todo: t, proj: p, projId: p.id, blockIdx: null }));
  });

  const hasAnything = activeItems.length || completedItems.length || dueTodayItems.length;
  if (!hasAnything) {
    list.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--faint);padding:4px 0">No todos yet. Add them via 📝 notes on a block.</div>`;
    return;
  }

  // ── Render assigned ──────────────────────────────────────
  if (activeItems.length) {
    const assignedHeader = document.createElement('div');
    assignedHeader.style.cssText = 'font-family:"DM Mono",monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px';
    assignedHeader.textContent = 'Assigned';
    list.appendChild(assignedHeader);
    const activeWrap = document.createElement('div');
    activeWrap.style.marginBottom = '10px';
    activeItems.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'today-todo-entry';
      if (entry.type === 'daily') {
        const {
          t,
          idx,
          proj
        } = entry;
        const [h, half] = blockToTime(idx);
        item.innerHTML = `<input type="checkbox" class="today-todo-cb daily-cb" title="Mark done"><span class="today-todo-label">${escAttr(t.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:auto">${proj.emoji} ${formatTime(h,half)}</span>`:''}`;
        item.querySelector('.today-todo-cb').addEventListener('change', e => {
          const dayD = getDay(ds);
          const bn = dayD.blockNotes[idx];
          if (bn) {
            const todo = bn.todos.find(x => x.id === t.id);
            if (todo) {
              todo.done = e.target.checked;
              setDay(ds, dayD);
              save();
              renderTodayTodos();
              if (ui.tab === 'todos') renderTodosTab();
            }
          }
        });
      } else {
        // proj todo
        const {
          todo,
          proj,
          projId,
          blockIdx
        } = entry;
        item.innerHTML = `<input type="checkbox" class="today-todo-cb proj-cb-done" title="Mark fully done"><span class="today-todo-label">${escAttr(todo.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:4px">${proj.emoji}</span>`:''}
          <button class="today-todo-progress-btn" title="Log progress today (stays active)">+ progress</button>`;
        item.querySelector('.today-todo-cb').addEventListener('change', e => {
          if (e.target.checked) {
            completeProjTodo(projId, todo.id, blockIdx, ds);
            renderTodayTodos();
            if (ui.tab === 'todos') renderTodosTab();
          } else e.target.checked = false;
        });
        item.querySelector('.today-todo-progress-btn').addEventListener('click', () => {
          progressProjTodo(projId, todo.id, blockIdx, ds);
          renderTodayTodos();
          if (ui.tab === 'todos') renderTodosTab();
        });
      }
      activeWrap.appendChild(item);
    });
    list.appendChild(activeWrap);
  }

  // ── Render due today (unassigned) ─────────────────────
  if (dueTodayItems.length) {
    const dueHeader = document.createElement('div');
    dueHeader.style.cssText = 'font-family:"DM Mono",monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:10px 0 6px;border-top:1px solid var(--border);padding-top:10px';
    dueHeader.textContent = `Due Today — Not Assigned (${dueTodayItems.length})`;
    list.appendChild(dueHeader);
    const dueWrap = document.createElement('div');
    dueWrap.style.marginBottom = '10px';
    dueTodayItems.forEach(entry => {
      const { todo, proj, projId } = entry;
      const item = document.createElement('div');
      item.className = 'today-todo-entry';
      item.innerHTML = `<input type="checkbox" class="today-todo-cb proj-cb-done" title="Mark fully done"><span class="today-todo-label">${escAttr(todo.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:4px">${proj.emoji}</span>`:''}
        <button class="today-todo-progress-btn" title="Log progress today (stays active)">+ progress</button>`;
      item.querySelector('.today-todo-cb').addEventListener('change', e => {
        if (e.target.checked) {
          completeProjTodo(projId, todo.id, null, ds);
          renderTodayTodos();
          if (ui.tab === 'todos') renderTodosTab();
        } else e.target.checked = false;
      });
      item.querySelector('.today-todo-progress-btn').addEventListener('click', () => {
        progressProjTodo(projId, todo.id, null, ds);
        renderTodayTodos();
        if (ui.tab === 'todos') renderTodosTab();
      });
      dueWrap.appendChild(item);
    });
    list.appendChild(dueWrap);
  }

  // ── Render completed/progressed today ─────────────────
  if (completedItems.length) {
    const doneSection = document.createElement('div');
    doneSection.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin:10px 0 6px;border-top:1px solid var(--border);padding-top:10px">Done Today (${completedItems.length})</div>`;
    completedItems.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'today-todo-entry';
      item.style.opacity = '.6';
      if (entry.type === 'daily') {
        const {
          t,
          proj
        } = entry;
        item.innerHTML = `<input type="checkbox" class="today-todo-cb daily-cb" checked><span class="today-todo-label done">${escAttr(t.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:auto">${proj.emoji}</span>`:''}`;
        item.querySelector('.today-todo-cb').addEventListener('change', e => {
          const dayD = getDay(ds);
          const bn = dayD.blockNotes[entry.idx];
          if (bn) {
            const todo = bn.todos.find(x => x.id === t.id);
            if (todo) {
              todo.done = e.target.checked;
              setDay(ds, dayD);
              save();
              renderTodayTodos();
              if (ui.tab === 'todos') renderTodosTab();
            }
          }
        });
      } else {
        const {
          todo,
          proj,
          projId,
          progressOnly
        } = entry;
        const badge = progressOnly ?
          `<span style="font-family:'DM Mono',monospace;font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(232,201,122,.12);color:var(--gold)">progress</span>` :
          `<span style="font-family:'DM Mono',monospace;font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(124,184,124,.12);color:var(--green)">✓ done</span>`;
        item.innerHTML = `${badge}<span class="today-todo-label done" style="margin-left:5px">${escAttr(todo.text)}</span>${proj?`<span style="font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-left:auto">${proj.emoji}</span>`:''}`;
        if (progressOnly) {
          // allow un-progressing
          item.style.cursor = 'pointer';
          item.title = 'Click to remove progress log';
          item.addEventListener('click', () => {
            progressProjTodo(projId, todo.id, entry.blockIdx, ds);
            renderTodayTodos();
            if (ui.tab === 'todos') renderTodosTab();
          });
        }
      }
      doneSection.appendChild(item);
    });
    list.appendChild(doneSection);
  }
}

// ════════════════════════════════════════════════════════════
//  RENDER: HEADER STATS
// ════════════════════════════════════════════════════════════
function renderHeaderStats() {
  // stat elements removed from header — no-op
}

function renderDateNav() {
  document.getElementById('date-display').textContent = formatDateLabel(ui.currentDate);
  const days = [todayStr(), ...sortedDays()].filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
  const idx = days.indexOf(ui.currentDate);
  document.getElementById('nav-prev').disabled = false;
  document.getElementById('nav-next').disabled = idx <= 0;
  document.getElementById('readonly-badge').style.display = 'none';
  // time-off toggle
  const day = currentDayData();
  const btn = document.getElementById('timeoff-btn');
  btn.classList.toggle('on', !!day.timeOff);
}

// ════════════════════════════════════════════════════════════
//  SETTINGS PANEL
// ════════════════════════════════════════════════════════════
function openSettings() {
  renderSettingsPanel();
  document.getElementById('settings-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function renderSettingsPanel() {
  const body = document.getElementById('settings-body');
  body.innerHTML = '';

  // ── Projects ──
  const projSection = document.createElement('div');
  projSection.className = 'settings-section';
  projSection.innerHTML = '<div class="settings-section-title">Projects</div>';

  const projList = document.createElement('div');
  projList.id = 'settings-proj-list';

  let spDragId = null, spDragZone = null;
  function renderProjList() {
    projList.innerHTML = '';
    // Build display order: top-level projects with children indented beneath them
    const topLevel = state.projects.filter(p => !p.parentId);
    const displayOrder = [];
    topLevel.forEach(p => {
      displayOrder.push({ proj: p, indent: false });
      state.projects.filter(sp => sp.parentId === p.id).forEach(sp => displayOrder.push({ proj: sp, indent: true }));
    });
    // Orphaned sub-projects (parent deleted)
    state.projects.filter(p => p.parentId && !state.projects.find(tp => tp.id === p.parentId))
      .forEach(p => displayOrder.push({ proj: p, indent: false }));

    displayOrder.forEach(({ proj: p, indent }) => {
      const row = document.createElement('div');
      row.className = 'settings-proj-row' + (indent ? ' settings-proj-row-child' : '');
      if (ui.editingProjId === p.id) {
        row.innerHTML = `<div style="display:flex;gap:6px;align-items:center;width:100%">
          <input class="mini-input emoji-input" style="width:34px;font-size:13px" value="${escAttr(p.emoji)}" id="sp-ee-${p.id}">
          <input class="color-input" type="color" value="${p.color}" id="sp-ec-${p.id}">
          <input class="proj-edit-input" style="flex:1" id="sp-en-${p.id}" value="${escAttr(p.name)}">
          <button class="icon-btn" id="sp-es-${p.id}">✓</button>
          <button class="icon-btn" id="sp-ex-${p.id}">✕</button>
        </div>`;
        projList.appendChild(row);
        const nameInp = row.querySelector(`#sp-en-${p.id}`);
        const emojiInp = row.querySelector(`#sp-ee-${p.id}`);
        const colorInp = row.querySelector(`#sp-ec-${p.id}`);
        const saveBtn  = row.querySelector(`#sp-es-${p.id}`);
        const cancelBtn = row.querySelector(`#sp-ex-${p.id}`);
        const saveEdit = () => {
          const name = nameInp.value.trim();
          if (!name) return;
          p.name = name;
          p.emoji = emojiInp.value || p.emoji;
          p.color = colorInp.value || p.color;
          ui.editingProjId = null;
          save();
          renderAll();
          renderProjList();
        };
        nameInp.addEventListener('keydown', e => {
          if (e.key === 'Enter') saveEdit();
          if (e.key === 'Escape') { ui.editingProjId = null; renderProjList(); }
        });
        saveBtn.onclick = saveEdit;
        cancelBtn.onclick = () => { ui.editingProjId = null; renderProjList(); };
      } else {
        row.draggable = true;
        row.dataset.projId = p.id;
        const hasChildren = state.projects.some(sp => sp.parentId === p.id);
        const ungroupBtn = indent ? `<button class="icon-btn" data-ungroup="${p.id}" title="Make top-level">↑</button>` : '';
        row.innerHTML = `${indent ? '<span class="sp-child-indent">└</span>' : '<span class="sp-drag-handle">⠿</span>'}
          <div class="proj-color-dot" style="background:${p.color}"></div>
          <div class="proj-name-display" style="color:${p.color};flex:1">${p.emoji} ${p.name}${hasChildren ? ' <span style="font-size:9px;color:var(--faint)">(parent)</span>' : ''}</div>
          <div class="proj-actions" style="opacity:1;display:flex;gap:4px">
            ${ungroupBtn}
            <button class="icon-btn" data-edit="${p.id}">✎</button>
            <button class="icon-btn danger" data-del="${p.id}">✕</button>
          </div>`;
        projList.appendChild(row);
        row.addEventListener('dragstart', e => {
          spDragId = p.id;
          e.dataTransfer.effectAllowed = 'move';
          row.classList.add('sp-dragging');
        });
        row.addEventListener('dragend', () => {
          spDragId = null;
          spDragZone = null;
          document.querySelectorAll('.settings-proj-row').forEach(r => r.classList.remove('sp-drag-over', 'sp-dragging', 'sp-drop-inside'));
        });
        row.addEventListener('dragover', e => {
          if (!spDragId || spDragId === p.id) return;
          e.preventDefault();
          document.querySelectorAll('.settings-proj-row').forEach(r => r.classList.remove('sp-drag-over', 'sp-drop-inside'));
          // Middle 40% of a top-level project = nest; edges = reorder
          const rect = row.getBoundingClientRect();
          const ratio = (e.clientY - rect.top) / rect.height;
          const canNest = !p.parentId && !indent && ratio > 0.3 && ratio < 0.7
            && !state.projects.some(sp => sp.parentId === spDragId); // can't nest a parent
          if (canNest) {
            row.classList.add('sp-drop-inside');
            spDragZone = 'inside';
          } else {
            row.classList.add('sp-drag-over');
            spDragZone = ratio < 0.5 ? 'before' : 'after';
          }
        });
        row.addEventListener('drop', e => {
          e.preventDefault();
          if (!spDragId || spDragId === p.id) return;
          const draggedProj = state.projects.find(x => x.id === spDragId);
          if (!draggedProj) return;
          if (spDragZone === 'inside' && !p.parentId) {
            draggedProj.parentId = p.id;
          } else {
            const fromIdx = state.projects.findIndex(x => x.id === spDragId);
            const toIdx   = state.projects.findIndex(x => x.id === p.id);
            if (fromIdx < 0 || toIdx < 0) return;
            const [moved] = state.projects.splice(fromIdx, 1);
            const newTo   = state.projects.findIndex(x => x.id === p.id);
            state.projects.splice(spDragZone === 'after' ? newTo + 1 : newTo, 0, moved);
          }
          save();
          renderAll();
          renderProjList();
        });
        row.querySelector('[data-ungroup]')?.addEventListener('click', () => {
          delete p.parentId;
          save(); renderAll(); renderProjList();
        });
        row.querySelector('[data-edit]').onclick = () => { ui.editingProjId = p.id; renderProjList(); };
        row.querySelector('[data-del]').onclick = () => {
          if (confirm(`Delete "${p.name}"?`)) {
            // Un-nest children before deleting parent
            state.projects.filter(sp => sp.parentId === p.id).forEach(sp => delete sp.parentId);
            state.projects = state.projects.filter(x => x.id !== p.id);
            Object.values(state.days).forEach(day => {
              const sched = day.schedule || {};
              Object.keys(sched).forEach(k => { if (sched[k] === p.id) sched[k] = '__archived__'; });
            });
            save();
            renderAll();
            renderProjList();
          }
        };
      }
    });

    // Add project form
    const addRow = document.createElement('div');
    addRow.className = 'settings-add-proj';
    addRow.innerHTML = `<div class="form-row" style="margin-bottom:6px">
      <input class="mini-input emoji-input" id="sp-new-emoji" type="text" value="⚡" maxlength="2">
      <input class="color-input" id="sp-new-color" type="color" value="#9B8FCF">
      <input class="mini-input" id="sp-new-name" type="text" placeholder="New project name…" style="flex:1">
      <button class="btn-primary" id="sp-confirm-add">Add</button>
    </div>`;
    projList.appendChild(addRow);
    const newNameInp  = addRow.querySelector('#sp-new-name');
    const newEmojiInp = addRow.querySelector('#sp-new-emoji');
    const newColorInp = addRow.querySelector('#sp-new-color');
    const confirmBtn  = addRow.querySelector('#sp-confirm-add');
    const doAdd = () => {
      const name = newNameInp.value.trim();
      if (!name) return;
      state.projects.push({
        id: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
        name,
        emoji: newEmojiInp.value || '⚡',
        color: newColorInp.value || '#9B8FCF'
      });
      save();
      renderAll();
      newNameInp.value = '';
      renderProjList();
    };
    confirmBtn.onclick = doAdd;
    newNameInp.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  }

  renderProjList();
  projSection.appendChild(projList);
  body.appendChild(projSection);

  // ── Tags ──
  const tagSection = document.createElement('div');
  tagSection.className = 'settings-section';
  tagSection.innerHTML = '<div class="settings-section-title">Tags</div>';
  const tagGrid = document.createElement('div');
  tagGrid.className = 'settings-tag-grid';
  (state.settings.tags || []).forEach(tag => {
    const item = document.createElement('div');
    item.className = 'settings-tag-item';
    item.innerHTML = `<div class="settings-tag-swatch" style="background:${tag.color}"></div>
      <input class="tag-rename-input" style="border-color:${tag.color}80;color:${tag.color}" value="${escAttr(tag.name)}" placeholder="Label…">`;
    const inp = item.querySelector('input');
    inp.oninput = () => { tag.name = inp.value; save(); };
    tagGrid.appendChild(item);
  });
  tagSection.appendChild(tagGrid);
  body.appendChild(tagSection);

  // ── Preferences ──
  const prefSection = document.createElement('div');
  prefSection.className = 'settings-section';
  prefSection.innerHTML = '<div class="settings-section-title">Preferences</div>';

  // Daily Goal
  const goalPref = document.createElement('div');
  goalPref.className = 'settings-pref-row';
  goalPref.innerHTML = `<div class="settings-pref-label">
    <div class="settings-pref-name">Daily goal (blocks)</div>
    <div class="settings-pref-desc">How many blocks count as hitting your goal for the day</div>
  </div>
  <input type="number" id="sp-goal-input" class="mini-input" min="1" max="36" value="${dailyGoal()}" style="width:52px;text-align:center">`;
  const spGoalInp = goalPref.querySelector('#sp-goal-input');
  spGoalInp.onchange = () => {
    const v = Math.max(1, Math.min(36, +spGoalInp.value || 8));
    spGoalInp.value = v;
    const oldGoal = dailyGoal();
    Object.keys(state.days).forEach(ds => { if (!state.days[ds].dailyGoal) state.days[ds].dailyGoal = oldGoal; });
    const day = currentDayData();
    day.dailyGoal = v;
    setDay(ui.currentDate, day);
    state.settings.dailyGoal = v;
    // sync the hidden input legacy JS uses
    const legacyInp = document.getElementById('goal-input');
    if (legacyInp) legacyInp.value = v;
    save();
    renderAll();
  };
  prefSection.appendChild(goalPref);

  // Light/Dark mode
  const themePref = document.createElement('div');
  themePref.className = 'settings-pref-row';
  const isLight = state.settings.theme === 'light';
  themePref.innerHTML = `<div class="settings-pref-label">
    <div class="settings-pref-name">Light mode</div>
    <div class="settings-pref-desc">Switch between dark and light appearance</div>
  </div>
  <button class="toggle-btn${isLight ? ' on' : ''}" id="sp-theme-btn">${isLight ? 'ON' : 'OFF'}</button>`;
  themePref.querySelector('#sp-theme-btn').onclick = function() {
    state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = state.settings.theme === 'light' ? 'light' : '';
    save();
    this.textContent = state.settings.theme === 'light' ? 'ON' : 'OFF';
    this.classList.toggle('on', state.settings.theme === 'light');
  };
  prefSection.appendChild(themePref);

  // Todos open by default
  const todoPref = document.createElement('div');
  todoPref.className = 'settings-pref-row';
  const todosOpen = state.settings.todosDefaultOpen !== false;
  todoPref.innerHTML = `<div class="settings-pref-label">
    <div class="settings-pref-name">Project todos open by default</div>
    <div class="settings-pref-desc">When you visit the Todos tab, all project sections start expanded</div>
  </div>
  <button class="toggle-btn${todosOpen ? ' on' : ''}" id="sp-todos-open-btn">${todosOpen ? 'ON' : 'OFF'}</button>`;
  todoPref.querySelector('#sp-todos-open-btn').onclick = function() {
    state.settings.todosDefaultOpen = !state.settings.todosDefaultOpen;
    save();
    this.textContent = state.settings.todosDefaultOpen ? 'ON' : 'OFF';
    this.classList.toggle('on', state.settings.todosDefaultOpen);
  };
  prefSection.appendChild(todoPref);
  body.appendChild(prefSection);

  // ── Data ──
  const dataSection = document.createElement('div');
  dataSection.className = 'settings-section';
  dataSection.innerHTML = '<div class="settings-section-title">Data</div>';

  const autoSaveNote = document.createElement('div');
  autoSaveNote.style.cssText = 'font-family:"DM Mono",monospace;font-size:9px;color:var(--faint);margin-bottom:12px';
  autoSaveNote.id = 'sp-io-bar-label';
  autoSaveNote.textContent = 'Auto-saved · Export YAML for backup';
  dataSection.appendChild(autoSaveNote);

  const dataButtons = document.createElement('div');
  dataButtons.style.cssText = 'display:flex;flex-direction:column;gap:7px';

  const exportYamlBtn = document.createElement('button');
  exportYamlBtn.className = 'settings-data-btn';
  exportYamlBtn.textContent = '⬇ Export YAML';
  exportYamlBtn.onclick = exportYaml;
  dataButtons.appendChild(exportYamlBtn);

  const importYamlBtn = document.createElement('button');
  importYamlBtn.className = 'settings-data-btn';
  importYamlBtn.textContent = '⬆ Import YAML';
  importYamlBtn.onclick = () => document.getElementById('import-input').click();
  dataButtons.appendChild(importYamlBtn);

  const exportNotesBtn = document.createElement('button');
  exportNotesBtn.className = 'settings-data-btn';
  exportNotesBtn.style.cssText += ';border-color:var(--purple);color:var(--purple)';
  exportNotesBtn.textContent = '⬇ Export Notes (.md)';
  exportNotesBtn.onclick = () => { if (ui.notesTabProjId) exportNotesMarkdown(ui.notesTabProjId); else alert('Select a project in the Notes tab first.'); };
  dataButtons.appendChild(exportNotesBtn);

  const manualBackupBtn = document.createElement('button');
  manualBackupBtn.className = 'settings-data-btn';
  manualBackupBtn.id = 'sp-manual-backup-btn';
  manualBackupBtn.style.cssText += ';border-color:var(--gold);color:var(--gold)';
  manualBackupBtn.textContent = '☁ Manual Backup';
  manualBackupBtn.onclick = manualBackup;
  dataButtons.appendChild(manualBackupBtn);

  dataSection.appendChild(dataButtons);
  body.appendChild(dataSection);

  // ── Developer Options ──
  const devSection = document.createElement('div');
  devSection.className = 'settings-section';
  devSection.innerHTML = '<div class="settings-section-title">Developer Options</div>';
  const devModePref = document.createElement('div');
  devModePref.className = 'settings-pref-row';
  const devMode = state.settings.devMode || false;
  devModePref.innerHTML = `<div class="settings-pref-label">
    <div class="settings-pref-name">Developer mode</div>
    <div class="settings-pref-desc">Enables debug tools like the ⚡ 5s timer skip button</div>
  </div>
  <button class="toggle-btn${devMode ? ' on' : ''}" id="sp-devmode-btn">${devMode ? 'ON' : 'OFF'}</button>`;
  devModePref.querySelector('#sp-devmode-btn').onclick = function() {
    state.settings.devMode = !state.settings.devMode;
    save();
    this.textContent = state.settings.devMode ? 'ON' : 'OFF';
    this.classList.toggle('on', state.settings.devMode);
  };
  devSection.appendChild(devModePref);
  body.appendChild(devSection);
}

// ════════════════════════════════════════════════════════════
//  RENDER: SIDEBAR
// ════════════════════════════════════════════════════════════
function renderSidebar() {
  const list = document.getElementById('proj-list');
  list.innerHTML = '';
  const addSidebarRow = (p, isChild) => {
    const row = document.createElement('div');
    row.className = 'proj-row' + (isChild ? ' proj-row-child' : '');
    row.style.background = p.color + '18';
    row.innerHTML = `${isChild ? '<span class="proj-child-indent">└</span>' : ''}<div class="proj-color-dot" style="background:${p.color}"></div>
      <div class="proj-name-display" style="color:${p.color}">${p.emoji} ${p.name}</div>
      <div class="proj-drag-handles">
        <span class="proj-drag-handle" draggable="true" data-dur="30" title="Drag to add 30 min block">30m</span>
        <span class="proj-drag-handle" draggable="true" data-dur="60" title="Drag to add 1 hr block">1h</span>
      </div>`;
    list.appendChild(row);
    row.querySelectorAll('.proj-drag-handle').forEach(handle => {
      handle.addEventListener('dragstart', e => {
        e.stopPropagation();
        ui.dragProjId = p.id;
        ui.dragSrcIdx = null;
        row.classList.add('proj-dragging');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('proj', p.id);
        e.dataTransfer.setData('dur', handle.dataset.dur);
        document.getElementById('schedule-grid')?.classList.add('drag-active');
      });
      handle.addEventListener('dragend', () => {
        row.classList.remove('proj-dragging');
        ui.dragProjId = null;
        document.getElementById('schedule-grid')?.classList.remove('drag-active');
      });
    });
  };
  const topLevel = state.projects.filter(p => !p.parentId);
  topLevel.forEach(p => {
    addSidebarRow(p, false);
    state.projects.filter(sp => sp.parentId === p.id).forEach(sp => addSidebarRow(sp, true));
  });
  // Orphaned sub-projects
  state.projects.filter(p => p.parentId && !state.projects.find(tp => tp.id === p.parentId))
    .forEach(p => addSidebarRow(p, false));
  // By project stats for current plan date
  const statList = document.getElementById('proj-stat-list');
  if (statList) {
    statList.innerHTML = '';
    const planDay = getDay(ui.currentDate);
    const planSched = planDay.schedule || {}, planDoneSet = new Set(planDay.completed || []);
    const projStatsFlat = [...state.projects, ARCHIVED_PROJ]
      .map(p => ({
        p,
        planned: Object.values(planSched).filter(id => id === p.id).length,
        completed: Object.entries(planSched).filter(([i, id]) => id === p.id && planDoneSet.has(+i)).length
      }))
      .filter(x => x.planned > 0);

    if (projStatsFlat.length) {
      // Top-level aggregated bar
      const sidebarTopLevel = state.projects.filter(p => !p.parentId);
      const topGroups = sidebarTopLevel.map(p => {
        const own = projStatsFlat.find(x => x.p.id === p.id) || { planned: 0, completed: 0 };
        const kids = state.projects.filter(sp => sp.parentId === p.id)
          .map(sp => projStatsFlat.find(x => x.p.id === sp.id)).filter(Boolean);
        return { p, planned: own.planned + kids.reduce((s, c) => s + c.planned, 0), completed: own.completed + kids.reduce((s, c) => s + c.completed, 0) };
      }).filter(g => g.planned > 0);
      const archivedStat = projStatsFlat.find(x => x.p.id === '__archived__');
      if (archivedStat) topGroups.push({ p: ARCHIVED_PROJ, planned: archivedStat.planned, completed: archivedStat.completed });

      if (topGroups.length > 0) {
        const topLabel = document.createElement('div');
        topLabel.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;color:var(--faint);letter-spacing:.08em;margin-bottom:4px;text-transform:uppercase';
        topLabel.textContent = 'By Area';
        statList.appendChild(topLabel);
        const totalTop = topGroups.reduce((s, g) => s + g.planned, 0);
        const topBar = document.createElement('div');
        topBar.className = 'stacked-bar';
        topBar.style.marginBottom = '4px';
        topGroups.forEach(({ p, planned, completed }) => {
          const pct = totalTop > 0 ? (planned / totalTop * 100) : 0;
          const compPct = planned > 0 ? (completed / planned * 100) : 0;
          const seg = document.createElement('div');
          seg.className = 'stacked-bar-seg';
          seg.style.cssText = `width:${pct}%;background:${p.color}30;position:relative;overflow:hidden`;
          seg.title = `${p.emoji} ${p.name}: ${completed}/${planned}`;
          const fill = document.createElement('div');
          fill.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${compPct}%;background:${p.color}`;
          seg.appendChild(fill);
          topBar.appendChild(seg);
        });
        statList.appendChild(topBar);
      }

      // Detailed per-project bar with hierarchy
      const totalPlanned = projStatsFlat.reduce((s, x) => s + x.planned, 0);
      const detailLabel = document.createElement('div');
      detailLabel.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;color:var(--faint);letter-spacing:.08em;margin-bottom:4px;margin-top:6px;text-transform:uppercase';
      detailLabel.textContent = 'By Project';
      statList.appendChild(detailLabel);
      const bar = document.createElement('div');
      bar.className = 'stacked-bar';
      projStatsFlat.forEach(({ p, planned, completed }) => {
        const pct = totalPlanned > 0 ? (planned / totalPlanned * 100) : 0;
        const compPct = planned > 0 ? (completed / planned * 100) : 0;
        const seg = document.createElement('div');
        seg.className = 'stacked-bar-seg';
        seg.style.cssText = `width:${pct}%;background:${p.color}30;position:relative;overflow:hidden`;
        seg.title = `${p.emoji} ${p.name}: ${completed}/${planned}`;
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${compPct}%;background:${p.color}`;
        seg.appendChild(fill);
        bar.appendChild(seg);
      });
      statList.appendChild(bar);
      const legend = document.createElement('div');
      legend.className = 'stacked-bar-legend';
      legend.style.marginTop = '6px';
      // Show in hierarchy order — use topGroups so areas appear even when only sub-projects are scheduled
      topGroups.forEach(({ p, planned: gPlanned, completed: gCompleted }) => {
        const item = document.createElement('div');
        item.className = 'stacked-bar-legend-item';
        item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${p.color}"></span><span style="color:${p.color}">${p.emoji} ${p.name}</span><span class="stacked-bar-legend-pct">${gCompleted}/${gPlanned}</span>`;
        legend.appendChild(item);
        state.projects.filter(sp => sp.parentId === p.id).forEach(sp => {
          const spStat = projStatsFlat.find(x => x.p.id === sp.id);
          if (!spStat) return;
          const childItem = document.createElement('div');
          childItem.className = 'stacked-bar-legend-item stacked-bar-legend-child';
          childItem.innerHTML = `<span style="color:var(--faint);margin-right:3px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${sp.color}"></span><span style="color:${sp.color}">${sp.emoji} ${sp.name}</span><span class="stacked-bar-legend-pct">${spStat.completed}/${spStat.planned}</span>`;
          legend.appendChild(childItem);
        });
      });
      if (archivedStat) {
        const item = document.createElement('div');
        item.className = 'stacked-bar-legend-item';
        item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${ARCHIVED_PROJ.color}"></span><span style="color:${ARCHIVED_PROJ.color}">${ARCHIVED_PROJ.emoji} ${ARCHIVED_PROJ.name}</span><span class="stacked-bar-legend-pct">${archivedStat.completed}/${archivedStat.planned}</span>`;
        legend.appendChild(item);
      }
      statList.appendChild(legend);
    }
  }
  // Due todos for the current date
  const dueTodosEl = document.getElementById('sidebar-due-todos');
  if (dueTodosEl) {
    dueTodosEl.innerHTML = '';
    const dueDateStr = ui.currentDate;
    const dueTodosByProj = [];
    state.projects.forEach(p => {
      const dueTodos = getProjTodos(p.id).filter(t => !t.done && t.dueDate === dueDateStr);
      if (dueTodos.length) dueTodosByProj.push({ proj: p, todos: dueTodos });
    });
    if (dueTodosByProj.length) {
      const label = document.createElement('div');
      label.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;color:var(--faint);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px';
      label.textContent = 'Todos Due';
      dueTodosEl.appendChild(label);
      dueTodosByProj.forEach(({ proj, todos }) => {
        const projLabel = document.createElement('div');
        projLabel.style.cssText = `font-family:'DM Mono',monospace;font-size:9px;color:${proj.color};margin-bottom:3px;margin-top:5px`;
        projLabel.textContent = `${proj.emoji} ${proj.name}`;
        dueTodosEl.appendChild(projLabel);
        todos.forEach(t => {
          const row = document.createElement('div');
          row.className = 'sidebar-due-todo-item';
          row.innerHTML = `<span class="sidebar-due-todo-dot" style="background:${proj.color}"></span><span class="sidebar-due-todo-text">${escAttr(t.text)}</span>`;
          dueTodosEl.appendChild(row);
        });
      });
    }
  }

  // Goal input
  document.getElementById('goal-input').value = dailyGoalForDay(ui.currentDate);
  // Default block duration toggle
  const dur = state.settings.defaultBlockDuration || 30;
  document.getElementById('dur-btn-30').classList.toggle('active', dur === 30);
  document.getElementById('dur-btn-60').classList.toggle('active', dur === 60);
}

function saveEditProject(id) {
  const name = document.getElementById(`en-${id}`)?.value?.trim();
  if (!name) return;
  const p = state.projects.find(x => x.id === id);
  if (p) {
    p.name = name;
    p.emoji = document.getElementById(`ee-${id}`)?.value || p.emoji;
    p.color = document.getElementById(`ec-${id}`)?.value || p.color;
  }
  ui.editingProjId = null;
  save();
  renderAll();
}

// ════════════════════════════════════════════════════════════
//  RENDER: PLAN GRID
// ════════════════════════════════════════════════════════════
function closeDropdown() {
  if (ui.openDropdown !== null) {
    const el = document.getElementById(`dd-${ui.openDropdown}`);
    if (el) el.remove();
    ui.openDropdown = null;
  }
}

function openDropdown(blockIdx) {
  closeDropdown();
  ui.openDropdown = blockIdx;
  const anchor = document.getElementById(`actions-${blockIdx}`);
  if (!anchor) return;
  const dd = document.createElement('div');
  dd.className = 'dropdown';
  dd.id = `dd-${blockIdx}`;
  state.projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'dropdown-item';
    item.style.color = p.color;
    // Project name (left, fills space)
    const nameSpan = document.createElement('span');
    nameSpan.style.flex = '1';
    nameSpan.textContent = `${p.emoji} ${p.name}`;
    item.appendChild(nameSpan);
    // 30m button
    const btn30 = document.createElement('button');
    btn30.className = 'dd-dur-btn';
    btn30.textContent = '30m';
    btn30.onclick = e => {
      e.stopPropagation();
      assignBlock(blockIdx, p.id);
    };
    item.appendChild(btn30);
    // 1h button (only if next slot exists)
    if (blockIdx + 1 <= 35) {
      const btn1h = document.createElement('button');
      btn1h.className = 'dd-dur-btn gold';
      btn1h.textContent = '1h';
      btn1h.onclick = e => {
        e.stopPropagation();
        assignBlock1hr(blockIdx, p.id);
      };
      item.appendChild(btn1h);
    }
    dd.appendChild(item);
  });
  anchor.appendChild(dd);
}

function updateTimeneedle() {}

function renderPlanBanner() {
  const planBanner = document.getElementById('plan-active-banner');
  const planBannerName = document.getElementById('plan-active-banner-name');
  const planBannerBtn = document.getElementById('plan-active-banner-btn');
  if (!planBanner) return;
  if (ui.activeBlock !== null && isToday()) {
    const proj = getProject((currentDayData().schedule || {})[ui.activeBlock]);
    const [bh, bhalf] = blockToTime(ui.activeBlock);
    if (planBannerName) planBannerName.textContent = `● Active: ${proj?`${proj.emoji} ${proj.name}`:'block'} · ${formatTime(bh,bhalf)} · ${formatSecs(getTimerRemaining())} remaining`;
    planBanner.style.display = 'block';
    if (planBannerBtn) planBannerBtn.onclick = () => {
      switchTab('today');
      showBlockFocus(ui.activeBlock);
    };
  } else {
    planBanner.style.display = 'none';
  }
}

function renderScheduleGrid() {
  renderPlanBanner();
  const grid = document.getElementById('schedule-grid');
  grid.innerHTML = '';
  const day = currentDayData(),
    sched = day.schedule || {},
    done = new Set(day.completed || []);
  const blockSpan = day.blockSpan || {};
  const blockNotes = day.blockNotes || {};
  // Build set of slots that are spanned (should not be rendered as their own row)
  const spannedSlots = new Set();
  Object.entries(blockSpan).forEach(([startIdx, span]) => {
    for (let i = 1; i < span; i++) spannedSlots.add(+startIdx + i);
  });
  const readOnly = false;
  const scheduledIdxs = Object.keys(sched).map(Number).filter(i => sched[i]);
  const lastPlannedIdx = scheduledIdxs.length > 0 ? Math.max(...scheduledIdxs) : -1;
  const maxH = Math.min(23, Math.max(6, 6 + Math.floor(lastPlannedIdx / 2)));
  for (let h = 6; h <= maxH; h++) {
    for (let half = 0; half < 2; half++) {
      const idx = (h - 6) * 2 + half;
      // No trailing empty slot — insert zones handle appending
      if (idx > lastPlannedIdx) continue;
      const lblRow = (h - 6) * 2 + half + 1;
      const lbl = document.createElement('div');
      if (half === 0) {
        lbl.className = 'hour-label';
        lbl.textContent = String(h - 5);
      } else {
        lbl.className = 'hour-label hour-half-label';
        lbl.textContent = ':30';
      }
      lbl.style.gridRow = String(lblRow);
      grid.appendChild(lbl);
      // Skip slots that are part of a span (visually merged into the start slot)
      if (spannedSlots.has(idx)) continue;
      const projId = sched[idx],
        proj = projId ? getProject(projId) : null;
      const isBreak = projId === '__break__';
      const isArchived = projId === '__archived__';
      const span = blockSpan[idx] || 1;
      const isCompleted = done.has(idx),
        isActive = ui.activeBlock === idx && ui.currentDate === todayStr(),
        hasNotes = blockHasContent(idx),
        hasMeeting = (blockNotes[idx] || {}).meeting === true;
      const row = document.createElement('div');
      const baseClass = 'block-row ' + (half === 0 ? 'block-divider-solid' : 'block-divider-dashed');
      row.className = baseClass + (span >= 2 ? ' block-row-1h' : '') + (isCompleted ? ' block-row-completed' : '');
      row.id = `block-row-${idx}`;
      row.dataset.idx = idx;
      if (!readOnly && proj && !isArchived) {
        const dh = document.createElement('span');
        dh.className = 'drag-handle';
        dh.textContent = '⠿';
        dh.title = 'Drag to move';
        row.appendChild(dh);
      }
      const bar = document.createElement('div');
      bar.className = 'color-bar' + (isBreak ? ' break-bar' : '') + (isArchived ? ' archived-bar' : '');
      if (!isBreak && !isArchived) bar.style.background = proj ? proj.color : 'var(--bg3)';
      if (isArchived) bar.style.background = 'repeating-linear-gradient(45deg,var(--bg3),var(--bg3) 3px,var(--faint) 3px,var(--faint) 6px)';
      bar.style.opacity = isCompleted ? '.35' : '1';
      if (proj && !isBreak && !isArchived) {
        row.style.background = proj.color + (isCompleted ? '0e' : '1a');
      }
      row.appendChild(bar);
      const label = document.createElement('div');
      label.className = 'block-label';
      label.style.flexDirection = 'column';
      label.style.alignItems = 'flex-start';
      label.style.gap = '3px';
      if (proj) {
        label.style.color = isCompleted ? 'var(--faint)' : proj.color;
        // Build label content
        const nameLine = document.createElement('div');
        nameLine.style.display = 'flex';
        nameLine.style.alignItems = 'center';
        nameLine.style.gap = '5px';
        nameLine.innerHTML = `${proj.emoji} <span class="block-proj-name">${proj.name}</span>`;
        if (isCompleted) nameLine.innerHTML += ` <span class="badge-done">✓</span>`;
        if (isActive) nameLine.innerHTML += ` <span class="badge-active pulse">● active</span>`;
        if (hasNotes) nameLine.innerHTML += ` <span class="badge-notes" title="Notes">📝</span>`;
        if (hasMeeting) nameLine.innerHTML += ` <span class="badge-meeting">📅 meeting</span>`;
        label.appendChild(nameLine);
      } else {
        row.classList.add('block-row-empty');
        label.style.color = 'var(--faint)';
        label.textContent = '—';
      }
      row.appendChild(label);
      if (!readOnly) {
        const actions = document.createElement('div');
        actions.className = 'block-actions';
        actions.id = `actions-${idx}`;
        actions.style.opacity = '0';
        if (proj && !isBreak && !isArchived && !isCompleted && !isActive && isToday()) {
          const sb = document.createElement('button');
          sb.className = 'start-btn-small';
          sb.textContent = '▶ start';
          sb.onclick = e => {
            e.stopPropagation();
            startTimer(idx);
          };
          actions.appendChild(sb);
        }
        if (proj && !isCompleted) {
          const db = document.createElement('button');
          db.className = 'done-btn-small';
          db.textContent = '✓ done';
          db.onclick = e => {
            e.stopPropagation();
            completeBlock(idx);
            renderScheduleGrid();
            renderSidebar();
            renderTodayTab();
            renderHeaderStats();
          };
          actions.appendChild(db);
        }
        if (proj && isCompleted) {
          const ub = document.createElement('button');
          ub.className = 'undone-btn-small';
          ub.textContent = '✗ undo';
          ub.onclick = e => {
            e.stopPropagation();
            const dayD = currentDayData();
            const sp = blockSpan[idx] || 1;
            for (let i = 0; i < sp; i++) dayD.completed = dayD.completed.filter(x => x !== idx + i);
            setDay(ui.currentDate, dayD);
            save();
            renderScheduleGrid();
            renderSidebar();
            renderTodayTab();
            renderHeaderStats();
          };
          actions.appendChild(ub);
        }
        if (proj) {
          const nb = document.createElement('button');
          nb.className = 'notes-btn' + (hasNotes ? ' has-content' : '');
          nb.textContent = '📝';
          nb.title = 'Notes';
          nb.onclick = e => {
            e.stopPropagation();
            openNotesModal(idx);
          };
          actions.appendChild(nb);
        }
        if (proj) {
          const cb = document.createElement('button');
          cb.className = 'clear-btn';
          cb.textContent = '✕';
          cb.title = 'Archive block';
          cb.onclick = e => {
            e.stopPropagation();
            clearBlock(idx);
          };
          actions.appendChild(cb);
        }
        row.appendChild(actions);
      }
      // For 1h blocks, add a mid-line marking the 30-min boundary inside the block
      if (span >= 2) {
        const midLine = document.createElement('div');
        midLine.className = 'block-1h-midline' + (half === 1 ? ' block-1h-midline-solid' : ' block-1h-midline-dashed');
        row.appendChild(midLine);
      }
      // Click row body to open notes (guard against drag firing a click)
      if (proj && !isBreak) {
        row.style.cursor = 'pointer';
        let rowDragged = false;
        row.addEventListener('mousedown', () => { rowDragged = false; });
        row.addEventListener('dragstart', () => { rowDragged = true; });
        row.addEventListener('click', () => { if (!rowDragged) openNotesModal(idx); });
      }
      // Block-to-block drag
      if (!readOnly && proj) {
        row.draggable = true;
        row.addEventListener('dragstart', e => {
          if (ui.dragProjId) return;
          ui.dragSrcIdx = idx;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('blockIdx', String(idx));
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          ui.dragSrcIdx = null;
          document.querySelectorAll('.block-row.drag-over,.block-row.proj-drop-target').forEach(r => r.classList.remove('drag-over', 'proj-drop-target'));
        });
      }
      if (!readOnly) {
        row.addEventListener('dragover', e => {
          e.preventDefault();
          document.querySelectorAll('.block-row.drag-over,.block-row.proj-drop-target').forEach(r => r.classList.remove('drag-over', 'proj-drop-target'));
          if (ui.dragSrcIdx !== null && ui.dragSrcIdx !== idx) {
            // For 1-hour block source, don't allow drop at the last slot
            const srcSpan = ((currentDayData().blockSpan) || {})[ui.dragSrcIdx] || 1;
            if (srcSpan >= 2 && idx + 1 > 35) return;
            e.dataTransfer.dropEffect = 'move';
            row.classList.add('drag-over');
          } else if (ui.dragProjId) {
            e.dataTransfer.dropEffect = 'copy';
            row.classList.add('proj-drop-target');
          }
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over', 'proj-drop-target'));
        row.addEventListener('drop', e => {
          e.preventDefault();
          row.classList.remove('drag-over', 'proj-drop-target');
          const projData = e.dataTransfer.getData('proj');
          const blockData = e.dataTransfer.getData('blockIdx');
          if (projData) {
            const day = currentDayData();
            const existingProjId = (day.schedule || {})[idx];
            if (existingProjId && existingProjId !== projData) {
              const bn = (day.blockNotes || {})[idx];
              const warnings = [];
              if ((bn?.note || '').trim()) warnings.push('notes written for this block');
              const todos = bn?.todos || [];
              if (todos.length) warnings.push(todos.length + ' to-do item' + (todos.length !== 1 ? 's' : ''));
              if (warnings.length) {
                if (!confirm('Replacing this block will delete ' + warnings.join(' and ') + '.\n\nContinue?')) return;
              }
            }
            // Warn if dropping onto the currently active (timer-running) block
            const isActiveSlot = ui.activeBlock === idx && ui.timerRunning && ui.currentDate === todayStr();
            if (isActiveSlot) {
              if (!confirm('This will replace the active block and stop the timer. Continue?')) return;
              clearInterval(ui.timerInterval);
              ui.timerInterval = null;
              ui.activeBlock = null;
              ui.timerRunning = false;
              ui.timerElapsedMs = 0;
              ui.timerStartedAt = null;
              state.timerState = { activeBlock: null, startedAt: null, elapsedMs: 0, date: null };
            }
            const dur = e.dataTransfer.getData('dur');
            if (dur === '60') {
              assignBlock1hr(idx, projData);
            } else {
              assignBlock(idx, projData);
            }
          } else if (blockData) {
            const srcIdx = parseInt(blockData);
            if (!isNaN(srcIdx) && srcIdx !== idx) moveBlock(srcIdx, idx);
          }
        });
      }
      const slotRow = (h - 6) * 2 + half + 1;
      row.style.gridRow = `${slotRow} / ${slotRow + span}`;
      grid.appendChild(row);
    }
  }
  // ── Insert zones: thin drop targets at block boundaries ──
  const makeInsertZone = (topPx, insertAt, shift) => {
    const zone = document.createElement('div');
    zone.className = 'insert-zone';
    zone.style.top = topPx + 'px';
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over-insert'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over-insert'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over-insert');
      const projData = e.dataTransfer.getData('proj');
      if (!projData) return;
      const dur = e.dataTransfer.getData('dur');
      if (shift) {
        const d = currentDayData();
        shiftBlocksForward(d, insertAt);
        setDay(ui.currentDate, d);
      }
      if (dur === '60') assignBlock1hr(insertAt, projData);
      else assignBlock(insertAt, projData);
    });
    grid.appendChild(zone);
  };

  if (lastPlannedIdx >= 0) {
    // Between adjacent occupied blocks
    Object.entries(sched).forEach(([idxStr]) => {
      const si = +idxStr;
      if (spannedSlots.has(si)) return;
      const sp = blockSpan[si] || 1;
      const insertAt = si + sp;
      if (insertAt <= 35 && sched[insertAt]) {
        makeInsertZone((si + sp) * 48 - 5, insertAt, true);
      }
    });

    // Before first occupied block (shift everything forward)
    const firstOccupied = Math.min(...Object.keys(sched).map(Number));
    makeInsertZone(Math.max(0, firstOccupied * 48 - 5), firstOccupied, true);

    // Large append zone below last block — always visible as a hint
    const afterLast = lastPlannedIdx + 1;
    if (afterLast <= 35) {
      const appendZone = document.createElement('div');
      appendZone.className = 'append-zone';
      appendZone.style.top = (afterLast * 48 + 4) + 'px';
      appendZone.innerHTML = '<span class="append-zone-hint">drop block here to add</span>';
      appendZone.addEventListener('dragover', e => { e.preventDefault(); appendZone.classList.add('drag-over-insert'); });
      appendZone.addEventListener('dragleave', () => appendZone.classList.remove('drag-over-insert'));
      appendZone.addEventListener('drop', e => {
        e.preventDefault();
        appendZone.classList.remove('drag-over-insert');
        const projData = e.dataTransfer.getData('proj');
        if (!projData) return;
        const dur = e.dataTransfer.getData('dur');
        if (dur === '60') assignBlock1hr(afterLast, projData);
        else assignBlock(afterLast, projData);
      });
      grid.appendChild(appendZone);
      grid.style.paddingBottom = '80px';
    } else {
      grid.style.paddingBottom = '';
    }
  } else {
    // Empty day — show faint time labels and a full drop zone
    for (let h = 6; h <= 12; h++) {
      for (let half = 0; half < 2; half++) {
        const lbl = document.createElement('div');
        lbl.className = half === 0 ? 'hour-label' : 'hour-label hour-half-label';
        lbl.textContent = half === 0 ? String(h - 5) : ':30';
        lbl.style.gridRow = String((h - 6) * 2 + half + 1);
        lbl.style.opacity = '0.3';
        grid.appendChild(lbl);
      }
    }
    const emptyZone = document.createElement('div');
    emptyZone.className = 'empty-day-zone';
    emptyZone.innerHTML = '<span class="empty-day-hint">drag a project here to start planning</span>';
    emptyZone.addEventListener('dragover', e => { e.preventDefault(); emptyZone.classList.add('drag-over-insert'); });
    emptyZone.addEventListener('dragleave', () => emptyZone.classList.remove('drag-over-insert'));
    emptyZone.addEventListener('drop', e => {
      e.preventDefault();
      emptyZone.classList.remove('drag-over-insert');
      const projData = e.dataTransfer.getData('proj');
      if (!projData) return;
      const dur = e.dataTransfer.getData('dur');
      if (dur === '60') assignBlock1hr(0, projData);
      else assignBlock(0, projData);
    });
    grid.appendChild(emptyZone);
    grid.style.minHeight = '220px';
    grid.style.paddingBottom = '';
  }

  setTimeout(updateTimeneedle, 0);
}

// ════════════════════════════════════════════════════════════
//  RENDER: TIMER CARD
// ════════════════════════════════════════════════════════════
function renderTimerCard() {
  const remaining = getTimerRemaining(),
    dur = getBlockDuration(ui.activeBlock),
    pct = (dur - remaining) / dur;
  document.getElementById('timer-ring').style.strokeDashoffset = CIRC * (1 - pct);
  document.getElementById('timer-display').textContent = formatSecs(remaining);
  const day = currentDayData(),
    done = countDoneBlocks(day);
  const planned = Object.keys(day.schedule || {}).length;
  document.getElementById('t-planned').textContent = planned;
  document.getElementById('t-blocks').textContent = done;
  document.getElementById('t-hours').textContent = (done * .5).toFixed(1) + 'h';
  document.getElementById('t-meetings').textContent = Object.values(day.blockNotes || {}).filter(bn => bn.meeting).length;
  if (ui.activeBlock !== null) {
    const proj = getProject((day.schedule || {})[ui.activeBlock]);
    document.getElementById('timer-project-name').textContent = proj ? `${proj.emoji} ${proj.name}` : 'Active block';
    document.getElementById('timer-ring').style.stroke = proj ? proj.color : 'var(--gold)';
    const activeSpan = (currentDayData().blockSpan || {})[ui.activeBlock] || 1;
    const canExtendNow = activeSpan === 1 && ui.activeBlock + 1 <= 35;
    const canShrinkNow = activeSpan >= 2;
    const extendRow = (canExtendNow || canShrinkNow) ? `<div class="timer-extend-row">${canShrinkNow ? '<button class="timer-btn extend" id="ts-btn">−30m</button>' : ''}${canExtendNow ? '<button class="timer-btn extend" id="te-btn">+30m</button>' : ''}</div>` : '';
    const pivotRow = ui.pivot ? `<div class="timer-pivot-row"><button class="timer-btn pivot-sw" id="tsw-btn">⇄ Switch Block</button></div>` : '';
    document.getElementById('timer-controls').innerHTML = `<div class="timer-main-row"><button class="timer-btn" id="tp-btn">${ui.timerRunning?'⏸ Pause':'▶ Resume'}</button><button class="timer-btn ghost" id="td-btn">✓ Done</button></div>${extendRow}${pivotRow}`;
    document.getElementById('tp-btn').onclick = pauseResumeTimer;
    document.getElementById('td-btn').onclick = promptAndDoneTimer;
    const teBtn = document.getElementById('te-btn');
    if (teBtn) teBtn.onclick = () => extendBlock(ui.activeBlock);
    const tsBtn = document.getElementById('ts-btn');
    if (tsBtn) tsBtn.onclick = () => shrinkBlock(ui.activeBlock);
    const tswBtn = document.getElementById('tsw-btn');
    if (tswBtn) tswBtn.onclick = switchPivot;
  } else {
    document.getElementById('timer-project-name').textContent = 'No active block';
    document.getElementById('timer-ring').style.stroke = 'var(--gold)';
    document.getElementById('timer-controls').innerHTML = `<span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--faint)">Start a block →</span>`;
  }
}

// ════════════════════════════════════════════════════════════
//  RENDER: GAMIFICATION PANEL
// ════════════════════════════════════════════════════════════
function renderGamePanel() {
  const day = currentDayData(),
    done = countDoneBlocks(day),
    goal = dailyGoalForDay(ui.currentDate);
  const s = computeStats();
  // Hide goal bar on time-off days
  const goalStatEl = document.getElementById('goal-stat');
  if (goalStatEl) goalStatEl.style.display = day.timeOff ? 'none' : '';
  // Goal bar
  const goalPct = Math.min(100, goal > 0 ? done / goal * 100 : 0);
  document.getElementById('gv-goal').textContent = `${done}/${goal}`;
  const gb = document.getElementById('gb-goal');
  gb.style.width = goalPct + '%';
  // Badge
  const badgeEl = document.getElementById('gv-goal-badge');
  if (done === 0) {
    badgeEl.innerHTML = '';
  } else if (done >= goal * 2) {
    badgeEl.innerHTML = `<span class="game-badge" style="background:rgba(232,201,122,.2);color:var(--gold)">🏆 DOUBLE GOAL!</span>`;
  } else if (done >= goal) {
    badgeEl.innerHTML = `<span class="game-badge" style="background:rgba(124,184,124,.15);color:var(--green)">✓ GOAL MET</span>`;
  } else {
    const left = goal - done;
    badgeEl.innerHTML = `<span class="game-badge" style="background:var(--bg3);color:var(--muted)">${left} block${left!==1?'s':''} to go</span>`;
  }
  document.getElementById('gv-streak').textContent = s.streak + 'd';
  document.getElementById('gv-rate').textContent = s.rate + '%';
  // Momentum/decay
  const m = s.momentum;
  document.getElementById('gv-decay').textContent = m;
  const df = document.getElementById('decay-bar-fill');
  df.style.width = m + '%';
  const color = m >= 70 ? 'var(--green)' : m >= 40 ? 'var(--gold)' : m >= 20 ? 'var(--orange)' : 'var(--red)';
  df.style.background = color;
  document.getElementById('gv-decay').style.color = color;
  const hint = m >= 70 ? 'Strong momentum — keep it up!' :
    m >= 40 ? 'Momentum steady — don\'t break the chain' :
    m >= 20 ? 'Momentum fading — get back on track' :
    'Momentum critical — time to rebuild';
  // Update hint text in tooltip (kept for dynamic message)
  const hintEl = document.getElementById('decay-hint');
  if (hintEl) hintEl.textContent = hint;

  // Project todos today — count projTodos pinned to today's blocks
  const blockNotes = day.blockNotes || {};
  const ds = ui.currentDate;
  let projTodoTotal = 0, projTodoDone = 0;
  Object.values(blockNotes).forEach(bn => {
    (bn.projTodos || []).forEach(ref => {
      const pt = (getProjTodos(ref.projId) || []).find(x => x.id === ref.todoId);
      if (!pt) return;
      projTodoTotal++;
      if (pt.done || hasProjTodoProgressToday(ref.projId, ref.todoId, ds)) projTodoDone++;
    });
  });
  document.getElementById('gv-proj-todos').textContent = `${projTodoDone}/${projTodoTotal}`;
  document.getElementById('gb-proj-todos').style.width = projTodoTotal > 0 ? Math.min(100, projTodoDone / projTodoTotal * 100) + '%' : '0%';

  // Best day + Avg (numbers only)
  document.getElementById('gv-best').textContent = s.best;
  document.getElementById('gv-avg').textContent = s.avg;

  // Per-project today: planned vs completed — stacked bar
  const todaySched = day.schedule || {}, todayDoneSet = new Set(day.completed || []);
  const allTodayProjs = [...state.projects, ARCHIVED_PROJ];
  const projTodayFlat = allTodayProjs
    .map(p => ({
      p,
      planned: Object.values(todaySched).filter(id => id === p.id).length,
      completed: Object.entries(todaySched).filter(([i, id]) => id === p.id && todayDoneSet.has(+i)).length
    }))
    .filter(x => x.planned > 0);

  // Build top-level groups for today
  const todayTopLevel = state.projects.filter(p => !p.parentId);
  const projTodayGroups = todayTopLevel.map(p => {
    const own = projTodayFlat.find(x => x.p.id === p.id) || { p, planned: 0, completed: 0 };
    const children = state.projects
      .filter(sp => sp.parentId === p.id)
      .map(sp => projTodayFlat.find(x => x.p.id === sp.id))
      .filter(Boolean);
    const totalPlanned = own.planned + children.reduce((s, c) => s + c.planned, 0);
    const totalCompleted = own.completed + children.reduce((s, c) => s + c.completed, 0);
    return { p, own, children, totalPlanned, totalCompleted };
  }).filter(g => g.totalPlanned > 0);
  // Add archived if scheduled
  const archivedToday = projTodayFlat.find(x => x.p.id === '__archived__');
  if (archivedToday) projTodayGroups.push({ p: ARCHIVED_PROJ, own: archivedToday, children: [], totalPlanned: archivedToday.planned, totalCompleted: archivedToday.completed });

  const projSection = document.getElementById('proj-stats-section');
  projSection.innerHTML = '';
  const todayProjHeader = document.getElementById('today-by-proj-header');
  if (todayProjHeader) todayProjHeader.style.display = projTodayGroups.length ? '' : 'none';

  if (projTodayGroups.length) {
    const grandTotal = projTodayGroups.reduce((s, g) => s + g.totalPlanned, 0);
    const makeBar = (items, getP, getPlanned, getCompleted, total) => {
      const b = document.createElement('div');
      b.className = 'stacked-bar';
      b.style.marginBottom = '4px';
      items.forEach(item => {
        const pct = total > 0 ? (getPlanned(item) / total * 100) : 0;
        const compPct = getPlanned(item) > 0 ? (getCompleted(item) / getPlanned(item) * 100) : 0;
        const p = getP(item);
        const seg = document.createElement('div');
        seg.className = 'stacked-bar-seg';
        seg.style.cssText = `width:${pct}%;background:${p.color}30;position:relative;overflow:hidden`;
        seg.title = `${p.emoji} ${p.name}: ${getCompleted(item)}/${getPlanned(item)}`;
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${compPct}%;background:${p.color}`;
        seg.appendChild(fill);
        b.appendChild(seg);
      });
      return b;
    };

    // Bar 1 — by area (top-level)
    const areaLabel = document.createElement('div');
    areaLabel.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;color:var(--faint);letter-spacing:.08em;margin-bottom:3px;text-transform:uppercase';
    areaLabel.textContent = 'By Area';
    projSection.appendChild(areaLabel);
    projSection.appendChild(makeBar(projTodayGroups, g => g.p, g => g.totalPlanned, g => g.totalCompleted, grandTotal));

    // Bar 2 — by individual project
    const projLabel = document.createElement('div');
    projLabel.style.cssText = 'font-family:"DM Mono",monospace;font-size:8px;color:var(--faint);letter-spacing:.08em;margin-bottom:3px;margin-top:6px;text-transform:uppercase';
    projLabel.textContent = 'By Project';
    projSection.appendChild(projLabel);
    const flatTotal = projTodayFlat.reduce((s, x) => s + x.planned, 0);
    projSection.appendChild(makeBar(projTodayFlat, x => x.p, x => x.planned, x => x.completed, flatTotal));

    // Hierarchical legend
    const legend = document.createElement('div');
    legend.className = 'stacked-bar-legend';
    legend.style.marginTop = '6px';
    projTodayGroups.forEach(({ p, children, totalPlanned, totalCompleted }) => {
      const item = document.createElement('div');
      item.className = 'stacked-bar-legend-item';
      item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${p.color}"></span><span style="color:${p.color}">${p.emoji} ${p.name}</span><span class="stacked-bar-legend-pct">${totalCompleted}/${totalPlanned}</span>`;
      legend.appendChild(item);
      children.forEach(({ p: sp, planned, completed }) => {
        const childItem = document.createElement('div');
        childItem.className = 'stacked-bar-legend-item stacked-bar-legend-child';
        childItem.innerHTML = `<span style="color:var(--faint);margin-right:3px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${sp.color}"></span><span style="color:${sp.color}">${sp.emoji} ${sp.name}</span><span class="stacked-bar-legend-pct">${completed}/${planned}</span>`;
        legend.appendChild(childItem);
      });
    });
    projSection.appendChild(legend);
  }

  // Comparison arrows vs best / avg
  const avgNum = parseFloat(s.avg) || 0;
  const bestDiff = done - s.best;
  const fmtDiff = (n) => (n > 0 ? '↑ +' : n < 0 ? '↓ ' : '→ ') + (n > 0 ? n : n < 0 ? n : '0');
  const diffColor = (n) => n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--muted)';
  const bestEl = document.getElementById('comp-best');
  bestEl.textContent = s.best > 0 ? fmtDiff(bestDiff) : '—';
  bestEl.style.color = s.best > 0 ? diffColor(bestDiff) : 'var(--muted)';
  const avgDiff = Math.round((done - avgNum) * 10) / 10;
  const avgEl = document.getElementById('comp-avg');
  avgEl.textContent = avgNum > 0 ? fmtDiff(avgDiff) : '—';
  avgEl.style.color = avgNum > 0 ? diffColor(avgDiff) : 'var(--muted)';

  // Momentum change indicator for today
  const changeEl = document.getElementById('gv-decay-change');
  if (changeEl) {
    const isWeekendToday = isWeekend(ui.currentDate);
    const isTimeOff = (currentDayData().timeOff || false);
    if (isWeekendToday || isTimeOff) {
      changeEl.textContent = '';
    } else if (done >= goal) {
      changeEl.textContent = '+5';
      changeEl.style.color = 'var(--green)';
    } else {
      changeEl.textContent = '−10';
      changeEl.style.color = 'var(--red)';
    }
  }
}

// ════════════════════════════════════════════════════════════
//  RENDER: TODAY TAB
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  BLOCK FOCUS VIEW
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
//  MARKDOWN RENDERER
// ════════════════════════════════════════════════════════════
function applyInlineMd(text) {
  // Extract code spans first so their contents aren't processed as markdown
  const codespans = [];
  text = text.replace(/`([^`]+)`/g, (_, inner) => {
    const escaped = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    codespans.push(`<code>${escaped}</code>`);
    return `\x00${codespans.length - 1}\x00`;
  });
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+?)_/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<span style="text-decoration:line-through;color:var(--faint)">$1</span>')
    .replace(/!\[([^\]]*)\]\((data:[^)]+|[^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;display:block;margin:4px 0">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return text.replace(/\x00(\d+)\x00/g, (_, i) => codespans[+i]);
}

function renderMarkdown(text) {
  if (!text || !text.trim()) return '<span style="color:var(--faint);font-style:italic;font-size:11px">No notes yet. Click Edit to write.</span>';
  const lines = text.split('\n');
  const out = [];
  let inUl = false,
    inOl = false,
    inCode = false,
    codeLines = [];
  const closeList = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };
  lines.forEach(raw => {
    // Fenced code blocks
    if (/^```/.test(raw)) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
        inCode = false;
        codeLines = [];
      }
      return;
    }
    if (inCode) {
      codeLines.push(raw);
      return;
    }
    const l = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/^### /.test(l)) {
      closeList();
      out.push(`<h3>${applyInlineMd(l.slice(4))}</h3>`);
      return;
    }
    if (/^## /.test(l)) {
      closeList();
      out.push(`<h2>${applyInlineMd(l.slice(3))}</h2>`);
      return;
    }
    if (/^# /.test(l)) {
      closeList();
      out.push(`<h1>${applyInlineMd(l.slice(2))}</h1>`);
      return;
    }
    if (/^---+$|^\*\*\*+$/.test(l.trim())) {
      closeList();
      out.push('<hr>');
      return;
    }
    if (/^> /.test(l)) {
      closeList();
      out.push(`<blockquote>${applyInlineMd(l.slice(2))}</blockquote>`);
      return;
    }
    // Checkboxes
    if (/^- \[ \] |^\* \[ \] /.test(l)) {
      if (!inUl) {
        out.push('<ul style="list-style:none;padding-left:4px">');
        inUl = true;
      }
      out.push(`<li>☐ ${applyInlineMd(l.slice(6))}</li>`);
      return;
    }
    if (/^- \[x\] |^- \[X\] /.test(l)) {
      if (!inUl) {
        out.push('<ul style="list-style:none;padding-left:4px">');
        inUl = true;
      }
      out.push(`<li style="color:var(--faint);text-decoration:line-through"><span style="color:var(--green);text-decoration:none">☑</span> ${applyInlineMd(l.slice(6))}</li>`);
      return;
    }
    // Lists
    if (/^[-*] /.test(l)) {
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${applyInlineMd(l.slice(2))}</li>`);
      return;
    }
    const nm = l.match(/^(\d+)\. (.+)/);
    if (nm) {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${applyInlineMd(nm[2])}</li>`);
      return;
    }
    closeList();
    if (!l.trim()) {
      out.push('<p style="margin:3px 0"></p>');
      return;
    }
    out.push(`<p>${applyInlineMd(l)}</p>`);
  });
  closeList();
  if (inCode) out.push(`<pre><code>${codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
  return out.join('');
}

function saveInlineNote(el) {
  el.style.background = '';
  el.style.border = '';
  el.style.margin = '';
  const ds = el.dataset.date;
  const idx = +el.dataset.idx;
  const text = el.innerText.trim();
  const day = getDay(ds);
  if (!day.blockNotes[idx]) day.blockNotes[idx] = {
    note: '',
    todos: []
  };
  day.blockNotes[idx].note = text;
  setDay(ds, day);
  save();
}

function showBlockFocus(blockIdx) {
  ui.focusBlock = blockIdx;
  document.getElementById('today-timeline').classList.add('hidden');
  const fv = document.getElementById('block-focus-view');
  fv.classList.add('active');
  renderBlockFocus();
}

function hideBlockFocus() {
  ui.focusBlock = null;
  document.getElementById('today-timeline').classList.remove('hidden');
  document.getElementById('block-focus-view').classList.remove('active');
  // Show return banner if there's still an active block running
  const returnBanner = document.getElementById('return-to-focus-banner');
  const returnBtn = document.getElementById('return-to-focus-btn');
  if (returnBanner) {
    returnBanner.style.display = ui.activeBlock !== null ? 'block' : 'none';
    if (returnBtn) returnBtn.onclick = () => showBlockFocus(ui.activeBlock);
  }
}

function renderBlockFocus() {
  const blockIdx = ui.focusBlock;
  if (blockIdx === null || blockIdx === undefined) return;
  const ds = todayStr();
  const day = getDay(ds);
  const proj = getProject((day.schedule || {})[blockIdx]);
  const bn = (day.blockNotes || {})[blockIdx] || {
    note: '',
    todos: []
  };
  const [h, half] = blockToTime(blockIdx);
  const span = (day.blockSpan || {})[blockIdx] || 1;
  const timeLabel = span >= 2 ? `${formatTime(h,half)} → ${formatTime(...blockToTime(blockIdx+span))}` : `${formatTime(h,half)}`;

  // Header
  document.getElementById('block-focus-title').textContent = proj ? `${proj.emoji} ${proj.name}` : 'Block';
  document.getElementById('block-focus-title').style.color = proj ? proj.color : 'var(--text)';
  // Show countdown if timer is running for this block, otherwise fall back to time range
  const focusTimeEl = document.getElementById('block-focus-time');
  if (ui.activeBlock === blockIdx && ui.timerRunning) {
    focusTimeEl.textContent = formatSecs(getTimerRemaining());
    focusTimeEl.dataset.countdown = '1';
  } else {
    focusTimeEl.textContent = timeLabel;
    focusTimeEl.dataset.countdown = '';
  }

  // Debug: skip to 5s button — only visible while timer is running
  const debug5sBtn = document.getElementById('focus-debug-5s-btn');
  if (debug5sBtn) {
    debug5sBtn.style.display = (ui.activeBlock === blockIdx && ui.timerRunning && state.settings.devMode) ? '' : 'none';
    debug5sBtn.onclick = () => skipToFiveSeconds();
  }

  // Pivot button — visible when timer is running for this block and no pivot yet
  const pivotBtn = document.getElementById('focus-pivot-btn');
  if (pivotBtn) {
    const isTimerBlock = ui.activeBlock === blockIdx && ui.timerRunning;
    pivotBtn.style.display = (isTimerBlock && !ui.pivot) ? '' : 'none';
    pivotBtn.onclick = openPivotPicker;
  }

  // Pivot status section
  const pivotSection = document.getElementById('pivot-status-section');
  if (pivotSection) {
    const inPivot = ui.pivot && (blockIdx === ui.pivot.blockA || blockIdx === ui.pivot.blockB);
    if (inPivot) {
      const { blockA, blockB, activeSlot } = ui.pivot;
      const ds2 = todayStr();
      const day2 = getDay(ds2);
      const projA = getProject((day2.schedule || {})[blockA]);
      const projB = getProject((day2.schedule || {})[blockB]);
      const isAActive = activeSlot === 'A';
      pivotSection.style.display = '';
      pivotSection.innerHTML = `
        <div class="pivot-status-label">⇄ PIVOT</div>
        <div class="pivot-status-blocks">
          <div class="pivot-block-chip ${isAActive ? 'pivot-chip-active' : 'pivot-chip-paused'}" style="${isAActive ? 'background:' + (projA?.color || 'var(--gold)') + '18;border-color:' + (projA?.color || 'var(--gold)') + '40' : ''}">
            <span class="pivot-chip-name" style="color:${projA?.color || 'var(--muted)'}">${projA ? escHtml(projA.emoji + ' ' + projA.name) : 'Block ' + blockA}</span>
            <span class="pivot-chip-status">${isAActive ? '● running' : '⏸ paused'}</span>
          </div>
          <button class="pivot-switch-btn" id="pivot-focus-switch-btn">⇄</button>
          <div class="pivot-block-chip ${!isAActive ? 'pivot-chip-active' : 'pivot-chip-paused'}" style="${!isAActive ? 'background:' + (projB?.color || 'var(--gold)') + '18;border-color:' + (projB?.color || 'var(--gold)') + '40' : ''}">
            <span class="pivot-chip-name" style="color:${projB?.color || 'var(--muted)'}">${projB ? escHtml(projB.emoji + ' ' + projB.name) : 'Block ' + blockB}</span>
            <span class="pivot-chip-status">${!isAActive ? '● running' : '⏸ paused'}</span>
          </div>
        </div>
        <button class="pivot-end-btn" id="pivot-focus-end-btn">End Pivot</button>
      `;
      document.getElementById('pivot-focus-switch-btn').onclick = switchPivot;
      document.getElementById('pivot-focus-end-btn').onclick = endPivot;
    } else {
      pivotSection.style.display = 'none';
    }
  }

  // Meeting toggle + badge
  const meetingBadgeEl = document.getElementById('block-focus-meeting-badge');
  const focusMeetingBtn = document.getElementById('focus-meeting-btn');
  const applyMeetingState = (val) => {
    if (meetingBadgeEl) meetingBadgeEl.style.display = val ? '' : 'none';
    if (focusMeetingBtn) focusMeetingBtn.classList.toggle('active', !!val);
  };
  applyMeetingState(bn.meeting);
  if (focusMeetingBtn) {
    focusMeetingBtn.onclick = () => {
      const dayD = getDay(ds);
      if (!dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx] = { note: '', todos: [] };
      const newVal = !(dayD.blockNotes[blockIdx].meeting === true);
      dayD.blockNotes[blockIdx].meeting = newVal || undefined;
      setDay(ds, dayD);
      save();
      applyMeetingState(newVal);
      renderScheduleGrid();
      renderTimerCard();
    };
  }

  // ── Importance stars ──
  const focusImpVal = bn.importance || 0;

  function updateFocusStars(val) {
    document.querySelectorAll('#focus-star-picker .star-btn').forEach(b => b.classList.toggle('active', +b.dataset.val <= val));
  }
  updateFocusStars(focusImpVal);
  document.querySelectorAll('#focus-star-picker .star-btn').forEach(btn => {
    btn.onclick = () => {
      const cur = [...document.querySelectorAll('#focus-star-picker .star-btn')].filter(b => b.classList.contains('active')).length;
      const newVal = (cur === +btn.dataset.val) ? 0 : +btn.dataset.val;
      updateFocusStars(newVal);
      // Auto-save importance immediately
      const dayD = getDay(ds);
      if (!dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx] = {
        note: '',
        todos: []
      };
      dayD.blockNotes[blockIdx].importance = newVal || null;
      setDay(ds, dayD);
      save();
    };
  });
  document.getElementById('focus-clear-imp-btn').onclick = () => {
    updateFocusStars(0);
    const dayD = getDay(ds);
    if (dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx].importance = null;
    setDay(ds, dayD);
    save();
  };

  // ── Tags ──
  const focusTagPicker = document.getElementById('focus-tag-picker');
  focusTagPicker.innerHTML = '';
  const currentFocusTags = bn.tags || [];
  (state.settings.tags || []).forEach(tag => {
    const active = currentFocusTags.includes(tag.id);
    const btn = document.createElement('button');
    btn.dataset.tagId = tag.id;
    btn.className = 'tag-pill-btn' + (active ? ' active' : '');
    btn.style.cssText = `border-color:${tag.color}50;--tag-color:${tag.color}`;
    btn.innerHTML = `<span style="background:${tag.color}"></span>${tag.name ? escAttr(tag.name) : ''}`;
    btn.onclick = () => {
      btn.classList.toggle('active');
      const dayD = getDay(ds);
      if (!dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx] = { note: '', todos: [] };
      const activeTags = [...focusTagPicker.querySelectorAll('.tag-pill-btn.active')].map(b => b.dataset.tagId);
      dayD.blockNotes[blockIdx].tags = activeTags.length ? activeTags : undefined;
      setDay(ds, dayD);
      save();
    };
    focusTagPicker.appendChild(btn);
  });

  // ── Note with dirty-state tracking + markdown ──
  const noteArea = document.getElementById('block-focus-note-area');
  const mdPreview = document.getElementById('block-focus-md-preview');
  const saveBtn = document.getElementById('block-focus-save-note');
  const saveStatus = document.getElementById('focus-save-status');
  const editBtn = document.getElementById('focus-mode-edit');
  const previewBtn = document.getElementById('focus-mode-preview');

  noteArea.value = bn.note || '';
  noteArea._savedValue = noteArea.value;

  function updateSaveBtn() {
    const dirty = noteArea.value !== noteArea._savedValue;
    saveBtn.style.background = dirty ? 'var(--purple)' : 'var(--green)';
    saveBtn.textContent = dirty ? 'Save Note' : 'Saved ✓';
    saveBtn.style.opacity = dirty ? '1' : '0.7';
    saveBtn.style.cursor = dirty ? 'pointer' : 'default';
  }
  updateSaveBtn();
  noteArea.oninput = updateSaveBtn;

  function showEdit() {
    noteArea.style.display = '';
    mdPreview.style.display = 'none';
    editBtn.classList.add('active');
    previewBtn.classList.remove('active');
  }

  function showPreview() {
    mdPreview.innerHTML = renderMarkdown(noteArea.value);
    noteArea.style.display = 'none';
    mdPreview.style.display = 'block';
    previewBtn.classList.add('active');
    editBtn.classList.remove('active');
  }
  // Start in edit mode
  showEdit();
  editBtn.onclick = showEdit;
  previewBtn.onclick = showPreview;
  // Click preview to go back to edit
  mdPreview.onclick = showEdit;
  // Auto-save on blur but stay in edit mode
  noteArea.onblur = () => saveBlockFocusNote();
  saveBtn.onclick = () => saveBlockFocusNote(true);

  // Project todos
  renderFocusProjTodos();

  // Left Off — most recent resume note for this project
  const leftOffSection = document.getElementById('block-focus-leftoff-section');
  const leftOffText = document.getElementById('block-focus-leftoff-text');
  const leftOffDate = document.getElementById('block-focus-leftoff-date');
  if (leftOffSection && leftOffText && proj) {
    // Find most recent block for this project (other than current) that has a resumeNote
    let latestResume = null;
    Object.entries(state.days).forEach(([entryDs, dayData]) => {
      Object.entries(dayData.blockNotes || {}).forEach(([idxStr, entryBn]) => {
        const entryIdx = +idxStr;
        if ((dayData.schedule || {})[entryIdx] !== proj.id) return;
        if (entryDs === ds && entryIdx === blockIdx) return;
        const rn = (entryBn.resumeNote || '').trim();
        if (!rn) return;
        if (!latestResume || entryDs > latestResume.ds || (entryDs === latestResume.ds && entryIdx > latestResume.idx)) {
          latestResume = { ds: entryDs, idx: entryIdx, resumeNote: rn };
        }
      });
    });

    if (latestResume) {
      leftOffSection.style.display = '';
      leftOffDate.textContent = formatDateLabel(latestResume.ds);
      leftOffText.textContent = latestResume.resumeNote;
    } else {
      leftOffSection.style.display = 'none';
    }
  } else if (leftOffSection) {
    leftOffSection.style.display = 'none';
  }

  // Recent notes — up to 3 most recent notes for this project (excluding current block)
  const recentSection = document.getElementById('block-focus-recent-notes-section');
  const recentList = document.getElementById('block-focus-recent-notes-list');
  if (recentSection && recentList && proj) {
    const noteEntries = [];
    Object.entries(state.days).forEach(([entryDs, dayData]) => {
      Object.entries(dayData.blockNotes || {}).forEach(([idxStr, entryBn]) => {
        const entryIdx = +idxStr;
        if ((dayData.schedule || {})[entryIdx] !== proj.id) return;
        if (entryDs === ds && entryIdx === blockIdx) return;
        const note = (entryBn.note || '').trim();
        if (note) noteEntries.push({ ds: entryDs, note });
      });
    });
    noteEntries.sort((a, b) => b.ds.localeCompare(a.ds));
    const recent = noteEntries.slice(0, 3);
    if (recent.length) {
      recentSection.style.display = '';
      recentList.innerHTML = '';
      recent.forEach(e => {
        const card = document.createElement('div');
        card.className = 'focus-recent-note';
        card.innerHTML = `<div class="focus-recent-note-meta">${formatDateLabel(e.ds)}</div>
          <div class="focus-recent-note-text md-preview md-preview--auto">${renderMarkdown(e.note)}</div>`;
        recentList.appendChild(card);
      });
    } else {
      recentSection.style.display = 'none';
    }
  } else if (recentSection) {
    recentSection.style.display = 'none';
  }
}

function saveBlockFocusNote(flash) {
  const blockIdx = ui.focusBlock;
  if (blockIdx === null || blockIdx === undefined) return;
  const ds = todayStr();
  const day = getDay(ds);
  if (!day.blockNotes[blockIdx]) day.blockNotes[blockIdx] = {
    note: '',
    todos: []
  };
  const noteArea = document.getElementById('block-focus-note-area');
  day.blockNotes[blockIdx].note = noteArea.value;
  setDay(ds, day);
  save();
  // Mark as saved
  if (noteArea) noteArea._savedValue = noteArea.value;
  const saveBtn = document.getElementById('block-focus-save-note');
  const saveStatus = document.getElementById('focus-save-status');
  if (saveBtn) {
    saveBtn.style.background = 'var(--green)';
    saveBtn.textContent = 'Saved ✓';
    saveBtn.style.opacity = '0.7';
    saveBtn.style.cursor = 'default';
  }
  if (flash && saveStatus) {
    saveStatus.textContent = '✓ saved';
    saveStatus.style.opacity = '1';
    setTimeout(() => {
      saveStatus.style.opacity = '0';
    }, 1800);
  }
}


function renderFocusProjTodos() {
  const blockIdx = ui.focusBlock;
  if (blockIdx === null || blockIdx === undefined) return;
  const ds = todayStr();
  const day = getDay(ds);
  const projId = (day.schedule || {})[blockIdx];
  const section = document.getElementById('block-focus-proj-todos-section');
  if (!projId) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const proj = getProject(projId);
  document.getElementById('block-focus-proj-todos-name').textContent = proj ? `${proj.emoji} ${proj.name}` : '';
  const allTodos = getProjTodos(projId);
  const list = document.getElementById('block-focus-proj-todos-list');
  list.innerHTML = '';
  if (!day.blockNotes[blockIdx]) day.blockNotes[blockIdx] = { note: '', todos: [], projTodos: [] };
  const bn = day.blockNotes[blockIdx];
  if (!bn.projTodos) bn.projTodos = [];

  // Split into: pinned-to-this-block (done or not), and unpinned active (not done)
  const pinnedTodos = allTodos.filter(t => bn.projTodos.some(r => r.todoId === t.id && r.projId === projId));
  const unpinnedActive = allTodos.filter(t => !t.done && !bn.projTodos.some(r => r.todoId === t.id && r.projId === projId));

  if (!pinnedTodos.length && !unpinnedActive.length) {
    list.innerHTML = '<div class="block-focus-todo-empty">No project todos.</div>';
  } else {
    // Render pinned todos first (done ones crossed out, undone ones with controls)
    pinnedTodos.forEach(t => {
      const progressed = hasProjTodoProgressToday(projId, t.id, ds);
      const item = document.createElement('div');
      item.className = 'block-proj-todo-item';
      if (t.done) {
        // Completed — show crossed out, no interaction
        item.innerHTML = `
          <input type="checkbox" checked disabled style="opacity:.4">
          <span class="block-proj-todo-text" style="text-decoration:line-through;color:var(--faint)">${escAttr(t.text)}</span>
          <span class="block-proj-todo-hint" style="color:var(--green);margin-left:auto">done ✓</span>`;
      } else {
        item.innerHTML = `
          <input type="checkbox" class="block-proj-todo-cb-done" title="Mark as fully done">
          <span class="block-proj-todo-text">${escAttr(t.text)}</span>
          <input type="checkbox" class="block-proj-todo-cb-progress" title="Log progress today" ${progressed ? 'checked' : ''}>
          <span class="block-proj-todo-hint" style="color:var(--gold)">progress</span>
          <button class="block-proj-todo-unpin" title="Remove from block" style="background:none;border:none;color:var(--faint);cursor:pointer;font-size:10px;padding:0 2px">✕</button>`;
        item.querySelector('.block-proj-todo-cb-done').addEventListener('change', e => {
          if (e.target.checked) {
            completeProjTodo(projId, t.id, blockIdx, ds);
            renderFocusProjTodos();
            renderTodayTodos();
            renderGamePanel();
            if (ui.tab === 'todos') renderTodosTab();
          }
        });
        item.querySelector('.block-proj-todo-cb-progress').addEventListener('change', () => {
          progressProjTodo(projId, t.id, blockIdx, ds);
          renderFocusProjTodos();
          renderTodayTodos();
          if (ui.tab === 'todos') renderTodosTab();
        });
        item.querySelector('.block-proj-todo-unpin').addEventListener('click', () => {
          const dayD = getDay(ds);
          const b = dayD.blockNotes[blockIdx];
          if (b) b.projTodos = b.projTodos.filter(r => !(r.todoId === t.id && r.projId === projId));
          setDay(ds, dayD);
          save();
          renderFocusProjTodos();
          renderTodayTodos();
        });
      }
      list.appendChild(item);
    });
    // Render unpinned active todos below
    unpinnedActive.forEach(t => {
      const item = document.createElement('div');
      item.className = 'block-proj-todo-item';
      item.innerHTML = `
        <span class="block-proj-todo-text" style="color:var(--muted)">${escAttr(t.text)}</span>
        <button class="block-proj-todo-pin" title="Add to this block" style="background:none;border:1px solid var(--border2);color:var(--faint);cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;padding:2px 6px;border-radius:4px;white-space:nowrap;transition:all .15s">+ add to block</button>`;
      item.querySelector('.block-proj-todo-pin').addEventListener('mouseenter', e => {
        e.target.style.borderColor = 'var(--green)';
        e.target.style.color = 'var(--green)';
      });
      item.querySelector('.block-proj-todo-pin').addEventListener('mouseleave', e => {
        e.target.style.borderColor = 'var(--border2)';
        e.target.style.color = 'var(--faint)';
      });
      item.querySelector('.block-proj-todo-pin').addEventListener('click', () => {
        const dayD = getDay(ds);
        if (!dayD.blockNotes[blockIdx]) dayD.blockNotes[blockIdx] = { note: '', todos: [], projTodos: [] };
        if (!dayD.blockNotes[blockIdx].projTodos) dayD.blockNotes[blockIdx].projTodos = [];
        dayD.blockNotes[blockIdx].projTodos.push({ projId, todoId: t.id });
        setDay(ds, dayD);
        save();
        renderFocusProjTodos();
        renderTodayTodos();
      });
      list.appendChild(item);
    });
  }
  const inp = document.getElementById('block-focus-new-proj-todo');
  inp.value = '';
  document.getElementById('block-focus-add-proj-todo-btn').onclick = () => addFocusProjTodo();
  inp.onkeydown = e => { if (e.key === 'Enter') addFocusProjTodo(); };
}

function addFocusProjTodo() {
  const blockIdx = ui.focusBlock;
  if (blockIdx === null || blockIdx === undefined) return;
  const ds = todayStr();
  const day = getDay(ds);
  const projId = (day.schedule || {})[blockIdx];
  if (!projId) return;
  const inp = document.getElementById('block-focus-new-proj-todo');
  const dueInp = document.getElementById('block-focus-new-proj-todo-due');
  const text = inp.value.trim();
  if (!text) return;
  addProjTodo(projId, text, dueInp?.value || null);
  inp.value = '';
  if (dueInp) dueInp.value = '';
  renderFocusProjTodos();
  renderTodayTodos();
  if (ui.tab === 'todos') renderTodosTab();
}

function renderTodayTab() {
  renderTimerCard();
  renderGamePanel();
  renderTimeline();
  renderTodayTodos();
  renderTodayNotes();
}

function renderTodayNotes() {
  const sec = document.getElementById('today-notes-section');
  const list = document.getElementById('today-notes-list');
  if (!list) return;
  list.innerHTML = '';
  const ds = todayStr();
  const day = getDay(ds);
  const sched = day.schedule || {};
  const blockNotes = day.blockNotes || {};

  // Collect blocks that have a note (not just todos)
  const entries = [];
  Object.entries(blockNotes).forEach(([idxStr, bn]) => {
    const note = (bn.note || '').trim();
    if (!note) return;
    const idx = +idxStr;
    const projId = sched[idx];
    if (!projId) return;
    const proj = getProject(projId);
    if (!proj) return;
    const [h, half] = blockToTime(idx);
    entries.push({
      idx,
      proj,
      note,
      timeLabel: formatTime(h, half)
    });
  });

  entries.sort((a, b) => a.idx - b.idx);

  if (!entries.length) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';

  entries.forEach(e => {
    const card = document.createElement('div');
    card.className = 'today-note-card';
    card.innerHTML = `<div class="today-note-header">
      <div class="today-note-dot" style="background:${e.proj.color}"></div>
      <div class="today-note-proj" style="color:${e.proj.color}">${e.proj.emoji} ${e.proj.name}</div>
      <div class="today-note-time">${e.timeLabel}</div>
    </div>
    <div class="today-note-body">${e.note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
    card.onclick = () => openNotesModal(e.idx);
    list.appendChild(card);
  });
}

function renderDayflowMini() {
  const mini = document.getElementById('dayflow-mini');
  mini.innerHTML = '';
  const day = currentDayData(),
    sched = day.schedule || {},
    done = new Set(day.completed || []);
  const blockSpan = day.blockSpan || {};
  const spannedSlots = new Set();
  Object.entries(blockSpan).forEach(([startIdx, span]) => {
    for (let i = 1; i < span; i++) spannedSlots.add(+startIdx + i);
  });
  const entries = Object.entries(sched).map(([i, pid]) => ({
    idx: +i,
    proj: getProject(pid)
  })).filter(e => e.proj && !spannedSlots.has(e.idx)).sort((a, b) => a.idx - b.idx);
  entries.forEach(({
    idx,
    proj
  }) => {
    const isCompleted = done.has(idx),
      isActive = ui.activeBlock === idx;
    const [h, half] = blockToTime(idx);
    const item = document.createElement('div');
    item.className = 'dayflow-mini-item' + (isActive ? ' active-item' : '');
    item.innerHTML = `<div class="dayflow-mini-dot" style="background:${isCompleted?'var(--faint)':proj.color};opacity:${isCompleted?.4:1}"></div>
      <div class="dayflow-mini-time">${formatTime(h,half)}</div>
      <div class="dayflow-mini-name" style="color:${isCompleted?'var(--faint)':proj.color}">${proj.emoji} ${proj.name}</div>
      <div class="dayflow-mini-status">${isCompleted?'✓':isActive?'<span class="pulse" style="color:var(--gold)">●</span>':''}</div>`;
    item.onclick = () => {
      const tl = document.getElementById(`tl-block-${idx}`);
      if (tl) tl.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    };
    mini.appendChild(item);
  });
}

function renderTimeline() {
  // Return-to-focus banner: show when active block exists but focus view is hidden
  const returnBanner = document.getElementById('return-to-focus-banner');
  const returnBtn = document.getElementById('return-to-focus-btn');
  if (returnBanner) {
    const focusActive = document.getElementById('block-focus-view')?.classList.contains('active');
    returnBanner.style.display = (ui.activeBlock !== null && !focusActive) ? 'block' : 'none';
    if (returnBtn) returnBtn.onclick = () => showBlockFocus(ui.activeBlock);
  }
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  const day = currentDayData(),
    sched = day.schedule || {},
    done = new Set(day.completed || []);
  const blockSpan = day.blockSpan || {};
  // Build set of slots that are part of a span (not the start)
  const spannedSlots = new Set();
  Object.entries(blockSpan).forEach(([startIdx, span]) => {
    for (let i = 1; i < span; i++) spannedSlots.add(+startIdx + i);
  });
  // Only include blocks that are not part of a span (i.e., either single or span start)
  const entries = Object.entries(sched).map(([i, pid]) => ({
    idx: +i,
    proj: getProject(pid)
  })).filter(e => e.proj && !spannedSlots.has(e.idx)).sort((a, b) => a.idx - b.idx);
  // Calculate total blocks and hours (1-hour blocks count as 2 blocks)
  let totalBlocks = 0,
    totalHours = 0;
  entries.forEach(({
    idx
  }) => {
    const span = blockSpan[idx] || 1;
    totalBlocks += span;
    totalHours += span * 0.5;
  });
  document.getElementById('today-timeline-label').textContent = `TODAY'S FLOW — ${totalBlocks} BLOCK${totalBlocks!==1?'S':''} · ${totalHours.toFixed(1)}H PLANNED`;
  if (!entries.length) {
    list.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--faint);margin-top:60px;text-align:center;line-height:2">No blocks planned yet.<br>Go to Plan tab or drag a project to start.</div>`;
    return;
  }
  entries.forEach(({
    idx,
    proj
  }) => {
    const isCompleted = done.has(idx),
      isActive = ui.activeBlock === idx;
    const hasNotes = blockHasContent(idx),
      notes = (day.blockNotes || {})[idx],
      isMeeting = notes?.meeting === true;
    const block = document.createElement('div');
    const span = blockSpan[idx] || 1;
    block.className = 'tl-block' + (isActive ? ' tl-active' : '') + (isCompleted ? ' tl-done' : '') + (span >= 2 ? ' tl-block-1h' : '');
    block.id = `tl-block-${idx}`;
    let notePreview = '',
      todoPreview = '';
    if (notes) {
      if ((notes.note || '').trim()) notePreview = notes.note.trim().replace(/\n/g, ' ').slice(0, 80);
      if ((notes.todos || []).length) {
        const tot = notes.todos.length,
          dt = notes.todos.filter(t => t.done).length;
        todoPreview = `${dt}/${tot} todos done`;
      }
    }
    block.innerHTML = `<div class="tl-accent" style="background:${proj.color};opacity:${isCompleted?.3:1}"></div>
      <div class="tl-inner">
        <div class="tl-info">
          <div class="tl-proj-row">
            <div class="tl-proj-name" style="color:${isCompleted?'var(--faint)':proj.color}">${proj.emoji} ${proj.name}${isMeeting?' <span class="badge-meeting">📅 meeting</span>':''}</div>
          </div>
          ${notePreview?`<div class="tl-note-preview">${notePreview}</div>`:''}
          ${todoPreview?`<div class="tl-todo-preview">📋 ${todoPreview}</div>`:''}
        </div>
        <div class="tl-actions">
          <button class="tl-notes-btn${hasNotes?' has':''}" data-nb="${idx}">📝 ${hasNotes?'notes':'add'}</button>
          ${isCompleted
            ? `<button class="tl-undo-btn" data-undo="${idx}">✗ undo</button>`
            : isActive
              ? `<span class="tl-status pulse" style="color:var(--gold)">● active</span>`
              : `${isToday()&&ui.currentDate===todayStr()?`<button class="tl-start-btn" data-start="${idx}">▶ start</button>`:''}<button class="tl-done-btn" data-done="${idx}">✓ done</button>`
          }
        </div>
      </div>`;
    list.appendChild(block);
    block.style.cursor = 'pointer';
    block.onclick = () => { if (isActive) { showBlockFocus(idx); } else { openNotesModal(idx); } };
    block.querySelector('[data-nb]')?.addEventListener('click', e => {
      e.stopPropagation();
      openNotesModal(idx);
    });
    block.querySelector('[data-start]')?.addEventListener('click', e => {
      e.stopPropagation();
      startTimer(idx);
    });
    block.querySelector('[data-done]')?.addEventListener('click', e => {
      e.stopPropagation();
      completeBlock(idx);
      renderTodayTab();
      renderScheduleGrid();
      renderHeaderStats();
      renderSidebar();
    });
    block.querySelector('[data-undo]')?.addEventListener('click', e => {
      e.stopPropagation();
      const day = currentDayData();
      const span = (day.blockSpan || {})[idx] || 1;
      for (let i = 0; i < span; i++) {
        day.completed = day.completed.filter(j => j !== idx + i);
      }
      setDay(ui.currentDate, day);
      save();
      renderTodayTab();
      renderScheduleGrid();
      renderHeaderStats();
      renderSidebar();
    });
  });
}


// ════════════════════════════════════════════════════════════
//  RENDER: STATS TAB
// ════════════════════════════════════════════════════════════
function getOrCreateChartTooltip() {
  let tip = document.getElementById('chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chart-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;display:none;' +
      'background:var(--bg2);border:1px solid var(--border2);border-radius:7px;' +
      'padding:6px 10px;font-family:"DM Mono",monospace;font-size:10px;color:var(--text);' +
      'box-shadow:0 4px 16px rgba(0,0,0,.5);white-space:nowrap;';
    document.body.appendChild(tip);
  }
  return tip;
}
function positionChartTooltip(tip, e, html) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 160) + 'px';
  tip.style.top = Math.max(4, e.clientY - 36) + 'px';
}

function drawBarChart(canvasId, data, color, logicalH) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth - 28;
  const H = logicalH || 90;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!data.length) return;
  const maxVal = Math.max(1, ...data.map(d => d.value));
  const padLeft = 22, padBottom = 14, padTop = 4;
  const chartW = W - padLeft;
  const chartH = H - padBottom - padTop;
  // Grid lines + y-axis labels
  const tickCount = 4;
  ctx.font = '7px monospace';
  for (let t = 0; t <= tickCount; t++) {
    const val = Math.round(maxVal * t / tickCount);
    const y = padTop + chartH * (1 - t / tickCount);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = '#3a3733';
    ctx.textAlign = 'right';
    ctx.fillText(val, padLeft - 3, y + 3);
  }
  const barW = Math.max(2, Math.floor((chartW - data.length) / data.length));
  const gap = Math.max(1, Math.floor(chartW / data.length) - barW);
  data.forEach((d, i) => {
    const x = padLeft + i * (barW + gap);
    const barH = maxVal > 0 ? Math.max(d.value > 0 ? 2 : 0, Math.round((d.value / maxVal) * chartH)) : 0;
    const y = padTop + chartH - barH;
    const grad = ctx.createLinearGradient(0, y, 0, padTop + chartH);
    grad.addColorStop(0, color + 'cc');
    grad.addColorStop(1, color + '44');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, 2);
    else ctx.rect(x, y, barW, barH);
    ctx.fill();
    if (i % (Math.ceil(data.length / 6)) === 0) {
      ctx.fillStyle = '#3a3733';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, x + barW / 2, H - 2);
    }
  });
  // Tooltips
  const tip = getOrCreateChartTooltip();
  const hitData = data.map((d, i) => ({ x: padLeft + i * (barW + gap), w: barW + gap, d }));
  if (canvas._ttMove) canvas.removeEventListener('mousemove', canvas._ttMove);
  if (canvas._ttLeave) canvas.removeEventListener('mouseleave', canvas._ttLeave);
  canvas._ttMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const hit = hitData.find(b => mx >= b.x && mx < b.x + b.w);
    if (hit) positionChartTooltip(tip, e, `<span style="color:var(--muted)">${hit.d.label}</span>&nbsp;&nbsp;<strong>${hit.d.value}</strong>`);
    else tip.style.display = 'none';
  };
  canvas._ttLeave = () => { tip.style.display = 'none'; };
  canvas.addEventListener('mousemove', canvas._ttMove);
  canvas.addEventListener('mouseleave', canvas._ttLeave);
}

function drawLineChart(canvasId, data, color, logicalH) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const wrap = canvas.parentElement;
  const W = wrap.clientWidth || (logicalH ? logicalH * 1.5 : 200);
  const H = Math.max(logicalH || 70, wrap.clientHeight || logicalH || 70);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;
  const maxVal = 100;
  const padLeft = 26, padBottom = 14, padTop = 4;
  const chartW = W - padLeft;
  const chartH = H - padBottom - padTop;
  // Grid lines + y-axis labels
  const ticks = [0, 25, 50, 75, 100];
  ctx.font = '7px monospace';
  ticks.forEach(val => {
    const y = padTop + chartH * (1 - val / maxVal);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = '#3a3733';
    ctx.textAlign = 'right';
    ctx.fillText(val, padLeft - 3, y + 3);
  });
  const stepX = chartW / (data.length - 1);
  const points = data.map((d, i) => ({
    x: padLeft + i * stepX,
    y: padTop + chartH * (1 - d.value / maxVal)
  }));
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
  grad.addColorStop(0, color + '55');
  grad.addColorStop(1, color + '05');
  ctx.beginPath();
  ctx.moveTo(points[0].x, padTop + chartH);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padTop + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  data.forEach((d, i) => {
    if (i % (Math.ceil(data.length / 6)) === 0) {
      ctx.fillStyle = '#3a3733';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, points[i].x, H - 2);
    }
  });
  // Tooltips
  const tip = getOrCreateChartTooltip();
  if (canvas._ttMove) canvas.removeEventListener('mousemove', canvas._ttMove);
  if (canvas._ttLeave) canvas.removeEventListener('mouseleave', canvas._ttLeave);
  canvas._ttMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    let best = null, bestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - mx);
      if (dist < bestDist) { bestDist = dist; best = { p, d: data[i] }; }
    });
    if (best && bestDist < stepX * 0.6) {
      positionChartTooltip(tip, e, `<span style="color:var(--muted)">${best.d.label}</span>&nbsp;&nbsp;<strong>${best.d.value}%</strong>`);
    } else {
      tip.style.display = 'none';
    }
  };
  canvas._ttLeave = () => { tip.style.display = 'none'; };
  canvas.addEventListener('mousemove', canvas._ttMove);
  canvas.addEventListener('mouseleave', canvas._ttLeave);
}

function computeTodoStats() {
  let completed = 0,
    active = 0,
    progressLogs = 0,
    meetings = 0;
  Object.values(state.projectTodos || {}).forEach(todos => {
    todos.forEach(t => {
      if (t.done) completed++;
      else active++;
      progressLogs += (t.history || []).filter(h => h.type === 'progress').length;
    });
  });
  // meetings logged (from blockNotes)
  Object.values(state.days || {}).forEach(d => {
    Object.values(d.blockNotes || {}).forEach(bn => {
      if (bn.meeting) meetings++;
    });
  });
  return {
    completed,
    active,
    progressLogs,
    meetings
  };
}

function getLast30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric'
    });
    days.push({
      ds,
      label
    });
  }
  return days;
}

function computeMomentumAtDay(ds) {
  // Recompute momentum up to (and including) ds
  const firstDay = firstRecordedDay();
  const allDays = Object.keys(state.days).filter(d => !isWeekend(d) && !state.days[d]?.timeOff && d <= ds && (!firstDay || d >= firstDay)).sort();
  let m = 100;
  for (const d of allDays) {
    const done = (state.days[d].completed || []).length;
    if (done >= dailyGoalForDay(d)) m = Math.min(100, m + 5);
    else m = Math.max(0, m - 10);
  }
  return Math.round(m);
}

function renderStats() {
  const s = computeStats();
  document.getElementById('sc-total-blocks').textContent = s.total;
  document.getElementById('sc-total-hours').textContent = (s.total * .5).toFixed(1);
  document.getElementById('sc-avg').textContent = s.avg;
  document.getElementById('sc-streak').textContent = s.streak;
  document.getElementById('sc-best').textContent = s.best;
  document.getElementById('sc-days').textContent = s.days;

  // Todo stats
  const ts = computeTodoStats();
  document.getElementById('sc-todos-total').textContent = ts.completed;
  document.getElementById('sc-todos-active').textContent = ts.active;
  document.getElementById('sc-todos-progress').textContent = ts.progressLogs;
  document.getElementById('sc-meetings').textContent = ts.meetings;

  // Work breakdown stats
  const today = todayStr();
  const firstDay = firstRecordedDay();
  const allPastDays = Object.entries(state.days).filter(([ds]) => ds <= today && (!firstDay || ds >= firstDay));
  const workedDays = allPastDays.filter(([, d]) => !d.timeOff && countDoneBlocks(d) > 0).length;
  const timeOffWorked = allPastDays.filter(([, d]) => d.timeOff === true && countDoneBlocks(d) > 0).length;
  const timeOffRest = allPastDays.filter(([, d]) => d.timeOff === true && countDoneBlocks(d) === 0).length;
  const total3 = workedDays + timeOffWorked + timeOffRest || 1;
  const workPct = Math.round(workedDays / total3 * 100);
  const offWorkedPct = Math.round(timeOffWorked / total3 * 100);
  const offRestPct = 100 - workPct - offWorkedPct;
  document.getElementById('sc-days-worked').textContent = workedDays;
  document.getElementById('sc-days-off-worked').textContent = timeOffWorked;
  const mainEl = document.getElementById('sc-days-off-worked-main');
  if (mainEl) mainEl.textContent = timeOffWorked;
  document.getElementById('sc-days-off').textContent = timeOffRest;
  document.getElementById('sc-work-pct-label').textContent = workPct + '% worked';
  document.getElementById('sc-off-worked-pct-label').textContent = offWorkedPct + '% day off worked';
  document.getElementById('sc-off-rest-pct-label').textContent = offRestPct + '% day off rested';
  const bar = document.getElementById('sc-work-breakdown-bar');
  if (bar) {
    bar.innerHTML = '';
    const segments = [
      { pct: workPct, color: 'var(--green)', label: 'Worked', count: workedDays },
      { pct: offWorkedPct, color: 'var(--gold)', label: 'Day off worked', count: timeOffWorked },
      { pct: offRestPct, color: 'var(--teal)', label: 'Day off rested', count: timeOffRest },
    ];
    segments.forEach(({ pct, color, label, count }) => {
      if (pct <= 0) return;
      const seg = document.createElement('div');
      seg.style.cssText = `width:${pct}%;background:${color};height:100%;transition:width .4s;cursor:default`;
      seg.title = `${label}: ${count} days (${pct}%)`;
      bar.appendChild(seg);
    });
  }

  // Charts — last 30 days
  const last30 = getLast30Days();
  const blocksData = last30.map(({
    ds,
    label
  }) => ({
    label,
    value: (state.days[ds]?.completed || []).length
  }));

  // Todos completed per day
  const todosByDay = {};
  Object.values(state.projectTodos || {}).forEach(todos => {
    todos.forEach(t => {
      (t.history || []).filter(h => h.type === 'done').forEach(h => {
        todosByDay[h.date] = (todosByDay[h.date] || 0) + 1;
      });
    });
  });
  Object.entries(state.days || {}).forEach(([ds, d]) => {
    Object.values(d.blockNotes || {}).forEach(bn => {
      const doneTodos = (bn.todos || []).filter(t => t.done).length;
      if (doneTodos) todosByDay[ds] = (todosByDay[ds] || 0) + doneTodos;
    });
  });
  const todosData = last30.map(({
    ds,
    label
  }) => ({
    label,
    value: todosByDay[ds] || 0
  }));

  // Momentum data: find first day with any data, set all prior days to 0
  const firstDataDay = last30.find(({
      ds
    }) =>
    (state.days[ds]?.schedule && Object.keys(state.days[ds].schedule).length > 0) ||
    state.days[ds]?.timeOff === true ||
    Object.keys(state.days[ds]?.blockNotes || {}).length > 0
  );
  const momentumData = last30.map(({
    ds,
    label
  }) => {
    if (firstDataDay && ds < firstDataDay.ds) {
      return {
        label,
        value: 0
      }; // Before any data, momentum is 0
    }
    return {
      label,
      value: computeMomentumAtDay(ds)
    };
  });

  // Project distribution — all-time blocks, grouped by parent → children
  const projDistEl = document.getElementById('proj-dist-section');
  if (projDistEl) {
    projDistEl.innerHTML = '';
    // Count blocks per project id
    const blocksByProjId = {};
    [...state.projects, ARCHIVED_PROJ].forEach(p => { blocksByProjId[p.id] = 0; });
    Object.entries(state.days).forEach(([ds, d]) => {
      if (firstDay && ds < firstDay) return;
      Object.values(d.schedule || {}).forEach(pid => {
        if (pid in blocksByProjId) blocksByProjId[pid]++;
      });
    });
    // Build top-level groups: each top-level project + its children
    const allProjs = [...state.projects, ARCHIVED_PROJ];
    const topLevel = allProjs.filter(p => !p.parentId);
    const groups = topLevel.map(p => {
      const children = state.projects.filter(sp => sp.parentId === p.id);
      const childTotal = children.reduce((s, sp) => s + (blocksByProjId[sp.id] || 0), 0);
      const ownCount = blocksByProjId[p.id] || 0;
      return { p, ownCount, children, total: ownCount + childTotal };
    }).filter(g => g.total > 0).sort((a, b) => b.total - a.total);
    const grandTotal = groups.reduce((s, g) => s + g.total, 0);

    if (!grandTotal) {
      projDistEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--faint)">No data yet.</div>';
    } else {
      // Top-level stacked bar
      const bar = document.createElement('div');
      bar.className = 'stacked-bar';
      groups.forEach(({ p, total }) => {
        const pct = grandTotal > 0 ? (total / grandTotal * 100) : 0;
        const seg = document.createElement('div');
        seg.className = 'stacked-bar-seg';
        seg.style.cssText = `width:${pct}%;background:${p.color}`;
        seg.title = `${p.emoji} ${p.name}: ${total} blocks (${Math.round(pct)}%)`;
        bar.appendChild(seg);
      });
      projDistEl.appendChild(bar);
      // Hierarchical legend
      const legend = document.createElement('div');
      legend.className = 'stacked-bar-legend';
      groups.forEach(({ p, ownCount, children, total }) => {
        const pct = grandTotal > 0 ? Math.round(total / grandTotal * 100) : 0;
        const parentItem = document.createElement('div');
        parentItem.className = 'stacked-bar-legend-item';
        parentItem.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${p.color}"></span><span style="color:${p.color}">${p.emoji} ${p.name}</span><span class="stacked-bar-legend-pct">${total} blocks · ${pct}%</span>`;
        legend.appendChild(parentItem);
        // Sub-project rows
        children.filter(sp => (blocksByProjId[sp.id] || 0) > 0).forEach(sp => {
          const spCount = blocksByProjId[sp.id] || 0;
          const spPct = total > 0 ? Math.round(spCount / total * 100) : 0;
          const childItem = document.createElement('div');
          childItem.className = 'stacked-bar-legend-item stacked-bar-legend-child';
          childItem.innerHTML = `<span style="color:var(--faint);margin-right:4px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${sp.color}"></span><span style="color:${sp.color}">${sp.emoji} ${sp.name}</span><span class="stacked-bar-legend-pct">${spCount} · ${spPct}%</span>`;
          legend.appendChild(childItem);
        });
        // Own blocks row if project has both own + children
        if (children.length > 0 && ownCount > 0) {
          const ownPct = total > 0 ? Math.round(ownCount / total * 100) : 0;
          const ownItem = document.createElement('div');
          ownItem.className = 'stacked-bar-legend-item stacked-bar-legend-child';
          ownItem.innerHTML = `<span style="color:var(--faint);margin-right:4px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${p.color};opacity:.4"></span><span style="color:var(--muted)">(direct)</span><span class="stacked-bar-legend-pct">${ownCount} · ${ownPct}%</span>`;
          legend.appendChild(ownItem);
        }
      });
      projDistEl.appendChild(legend);
    }
  }

  // Meetings distribution — meeting blocks vs non-meeting blocks all time
  const meetingsDistEl = document.getElementById('meetings-dist-section');
  if (meetingsDistEl) {
    meetingsDistEl.innerHTML = '';
    let meetingCount = 0, nonMeetingCount = 0;
    Object.entries(state.days).forEach(([ds, d]) => {
      if (ds > today) return;
      if (firstDay && ds < firstDay) return;
      (d.completed || []).forEach(idx => {
        if ((d.blockNotes || {})[idx]?.meeting) meetingCount++;
        else nonMeetingCount++;
      });
    });
    const totalMDist = meetingCount + nonMeetingCount;
    if (totalMDist === 0) {
      meetingsDistEl.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--faint)">No data yet.</div>';
    } else {
      const bar = document.createElement('div');
      bar.className = 'stacked-bar';
      const segments = [
        { label: '📅 Meetings', count: meetingCount, color: 'var(--purple)' },
        { label: '💼 Work', count: nonMeetingCount, color: 'var(--muted)' }
      ];
      segments.forEach(({ label, count, color }) => {
        const pct = totalMDist > 0 ? (count / totalMDist * 100) : 0;
        const seg = document.createElement('div');
        seg.className = 'stacked-bar-seg';
        seg.style.cssText = `width:${pct}%;background:${color}`;
        seg.title = `${label}: ${count} blocks (${Math.round(pct)}%)`;
        bar.appendChild(seg);
      });
      meetingsDistEl.appendChild(bar);
      const legend = document.createElement('div');
      legend.className = 'stacked-bar-legend';
      segments.forEach(({ label, count, color }) => {
        const pct = totalMDist > 0 ? Math.round(count / totalMDist * 100) : 0;
        const item = document.createElement('div');
        item.className = 'stacked-bar-legend-item';
        item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${color}"></span><span style="color:${color}">${label}</span><span class="stacked-bar-legend-pct">${count} blocks · ${pct}%</span>`;
        legend.appendChild(item);
      });
      meetingsDistEl.appendChild(legend);
    }
  }

  // Draw with explicit logical heights to prevent growing bug
  requestAnimationFrame(() => {
    drawBarChart('chart-blocks', blocksData, '#E8C97A', 90);
    drawBarChart('chart-todos', todosData, '#7CB87C', 90);
    drawLineChart('chart-momentum', momentumData, '#9B8FCF', 100);
  });
}

// ════════════════════════════════════════════════════════════
//  REVIEW SHARED SECTION BUILDERS
// ════════════════════════════════════════════════════════════
function buildProjDistSection(el, daysList) {
  el.innerHTML = '';
  const today = todayStr();
  const blocksByProjId = {};
  [...state.projects, ARCHIVED_PROJ].forEach(p => { blocksByProjId[p.id] = 0; });
  daysList.forEach(ds => {
    if (ds > today) return;
    const d = state.days[ds];
    if (!d) return;
    const doneSet = new Set(d.completed || []);
    Object.entries(d.schedule || {}).forEach(([idx, pid]) => {
      if (doneSet.has(+idx) && pid in blocksByProjId) blocksByProjId[pid]++;
    });
  });
  const topLevel = [...state.projects, ARCHIVED_PROJ].filter(p => !p.parentId);
  const groups = topLevel.map(p => {
    const children = state.projects.filter(sp => sp.parentId === p.id);
    const childTotal = children.reduce((s, sp) => s + (blocksByProjId[sp.id] || 0), 0);
    const ownCount = blocksByProjId[p.id] || 0;
    return { p, ownCount, children, total: ownCount + childTotal };
  }).filter(g => g.total > 0).sort((a, b) => b.total - a.total);
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  if (!grandTotal) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--faint)">No data yet.</div>';
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'stacked-bar';
  groups.forEach(({ p, total }) => {
    const pct = total / grandTotal * 100;
    const seg = document.createElement('div');
    seg.className = 'stacked-bar-seg';
    seg.style.cssText = `width:${pct}%;background:${p.color}`;
    seg.title = `${p.emoji} ${p.name}: ${total} blocks (${Math.round(pct)}%)`;
    bar.appendChild(seg);
  });
  el.appendChild(bar);
  const legend = document.createElement('div');
  legend.className = 'stacked-bar-legend';
  groups.forEach(({ p, ownCount, children, total }) => {
    const pct = Math.round(total / grandTotal * 100);
    const item = document.createElement('div');
    item.className = 'stacked-bar-legend-item';
    item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${p.color}"></span><span style="color:${p.color}">${p.emoji} ${escHtml(p.name)}</span><span class="stacked-bar-legend-pct">${total} blocks · ${pct}%</span>`;
    legend.appendChild(item);
    children.filter(sp => (blocksByProjId[sp.id] || 0) > 0).forEach(sp => {
      const spCount = blocksByProjId[sp.id] || 0;
      const spPct = total > 0 ? Math.round(spCount / total * 100) : 0;
      const child = document.createElement('div');
      child.className = 'stacked-bar-legend-item stacked-bar-legend-child';
      child.innerHTML = `<span style="color:var(--faint);margin-right:4px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${sp.color}"></span><span style="color:${sp.color}">${sp.emoji} ${escHtml(sp.name)}</span><span class="stacked-bar-legend-pct">${spCount} · ${spPct}%</span>`;
      legend.appendChild(child);
    });
    if (children.length > 0 && ownCount > 0) {
      const ownPct = total > 0 ? Math.round(ownCount / total * 100) : 0;
      const own = document.createElement('div');
      own.className = 'stacked-bar-legend-item stacked-bar-legend-child';
      own.innerHTML = `<span style="color:var(--faint);margin-right:4px;font-size:9px">└</span><span class="stacked-bar-legend-dot" style="background:${p.color};opacity:.4"></span><span style="color:var(--muted)">(direct)</span><span class="stacked-bar-legend-pct">${ownCount} · ${ownPct}%</span>`;
      legend.appendChild(own);
    }
  });
  el.appendChild(legend);
}

function buildMeetingsDistSection(el, daysList) {
  el.innerHTML = '';
  const today = todayStr();
  let meetingCount = 0, nonMeetingCount = 0;
  daysList.forEach(ds => {
    if (ds > today) return;
    const d = state.days[ds];
    if (!d) return;
    (d.completed || []).forEach(idx => {
      if ((d.blockNotes || {})[idx]?.meeting) meetingCount++;
      else nonMeetingCount++;
    });
  });
  const totalMDist = meetingCount + nonMeetingCount;
  if (!totalMDist) {
    el.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--faint)">No data yet.</div>';
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'stacked-bar';
  const segs = [
    { label: '📅 Meetings', count: meetingCount, color: 'var(--purple)' },
    { label: '💼 Work', count: nonMeetingCount, color: 'var(--muted)' }
  ];
  segs.forEach(({ label, count, color }) => {
    const pct = count / totalMDist * 100;
    const seg = document.createElement('div');
    seg.className = 'stacked-bar-seg';
    seg.style.cssText = `width:${pct}%;background:${color}`;
    seg.title = `${label}: ${count} blocks (${Math.round(pct)}%)`;
    bar.appendChild(seg);
  });
  el.appendChild(bar);
  const legend = document.createElement('div');
  legend.className = 'stacked-bar-legend';
  segs.forEach(({ label, count, color }) => {
    const pct = Math.round(count / totalMDist * 100);
    const item = document.createElement('div');
    item.className = 'stacked-bar-legend-item';
    item.innerHTML = `<span class="stacked-bar-legend-dot" style="background:${color}"></span><span style="color:${color}">${label}</span><span class="stacked-bar-legend-pct">${count} blocks · ${pct}%</span>`;
    legend.appendChild(item);
  });
  el.appendChild(legend);
}

function buildWorkBreakdownSection(el, daysList) {
  el.innerHTML = '';
  const today = todayStr();
  const entries = daysList.filter(ds => ds <= today).map(ds => state.days[ds]).filter(Boolean);
  const workedDays = entries.filter(d => !d.timeOff && countDoneBlocks(d) > 0).length;
  const timeOffWorked = entries.filter(d => d.timeOff === true && countDoneBlocks(d) > 0).length;
  const timeOffRest = entries.filter(d => d.timeOff === true && countDoneBlocks(d) === 0).length;
  const total3 = workedDays + timeOffWorked + timeOffRest || 1;
  const workPct = Math.round(workedDays / total3 * 100);
  const offWorkedPct = Math.round(timeOffWorked / total3 * 100);
  const offRestPct = 100 - workPct - offWorkedPct;

  const nums = document.createElement('div');
  nums.style.cssText = 'display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap';
  nums.innerHTML = `
    <div><div class="stat-card-val" style="color:var(--green)">${workedDays}</div><div class="stat-card-label">DAYS WORKED</div></div>
    <div><div class="stat-card-val" style="color:var(--gold)">${timeOffWorked}</div><div class="stat-card-label">DAYS OFF WORKED</div></div>
    <div><div class="stat-card-val" style="color:var(--teal)">${timeOffRest}</div><div class="stat-card-label">DAYS OFF RESTED</div></div>
  `;
  el.appendChild(nums);

  const bar = document.createElement('div');
  bar.style.cssText = 'height:18px;border-radius:6px;overflow:hidden;display:flex;background:var(--bg3)';
  [
    { pct: workPct, color: 'var(--green)', label: 'Worked', count: workedDays },
    { pct: offWorkedPct, color: 'var(--gold)', label: 'Day off worked', count: timeOffWorked },
    { pct: offRestPct, color: 'var(--teal)', label: 'Day off rested', count: timeOffRest },
  ].forEach(({ pct, color, label, count }) => {
    if (pct <= 0) return;
    const seg = document.createElement('div');
    seg.style.cssText = `width:${pct}%;background:${color};height:100%;transition:width .4s;cursor:default`;
    seg.title = `${label}: ${count} days (${pct}%)`;
    bar.appendChild(seg);
  });
  el.appendChild(bar);

  const leg = document.createElement('div');
  leg.style.cssText = 'display:flex;gap:14px;margin-top:8px;flex-wrap:wrap';
  [
    { color: 'var(--green)', label: workPct + '% worked' },
    { color: 'var(--gold)', label: offWorkedPct + '% day off worked' },
    { color: 'var(--teal)', label: offRestPct + '% day off rested' },
  ].forEach(({ color, label }) => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:5px';
    item.innerHTML = `<span style="width:9px;height:9px;border-radius:2px;background:${color};display:inline-block;flex-shrink:0"></span><span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${label}</span>`;
    leg.appendChild(item);
  });
  el.appendChild(leg);
}

function appendReviewAnalytics(container, daysList) {
  // Row: Work Breakdown | Meetings vs Work
  const row1 = document.createElement('div');
  row1.style.cssText = 'display:grid;grid-template-columns:1fr 1.6fr;gap:12px;margin-top:14px;margin-bottom:12px';

  const wbCard = document.createElement('div');
  wbCard.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:14px';
  wbCard.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;margin-bottom:12px">WORK BREAKDOWN</div>';
  const wbContent = document.createElement('div');
  buildWorkBreakdownSection(wbContent, daysList);
  wbCard.appendChild(wbContent);
  row1.appendChild(wbCard);

  const mtCard = document.createElement('div');
  mtCard.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:14px';
  mtCard.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;margin-bottom:10px">MEETINGS VS WORK</div>';
  const mtContent = document.createElement('div');
  buildMeetingsDistSection(mtContent, daysList);
  mtCard.appendChild(mtContent);
  row1.appendChild(mtCard);

  container.appendChild(row1);

  // Full-width: Time by Project
  const projCard = document.createElement('div');
  projCard.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:16px';
  projCard.innerHTML = '<div style="font-family:\'DM Mono\',monospace;font-size:9px;color:var(--muted);letter-spacing:.1em;margin-bottom:10px">TIME BY PROJECT</div>';
  const projContent = document.createElement('div');
  buildProjDistSection(projContent, daysList);
  projCard.appendChild(projContent);
  container.appendChild(projCard);
}

// ════════════════════════════════════════════════════════════
//  RENDER: REVIEW TAB
// ════════════════════════════════════════════════════════════
function getWeekDays(offset) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay() + offset * 7);
  sunday.setHours(12, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  return days;
}

function getMonthInfo(offset) {
  const today = new Date();
  const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(`${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`);
  }
  return { year, month, days };
}

function countPlannedBlocks(day) {
  const spans = day.blockSpan || {};
  const spanned = new Set();
  Object.entries(spans).forEach(([si, span]) => {
    for (let i = 1; i < span; i++) spanned.add(+si + i);
  });
  let count = 0;
  for (const idx of Object.keys(day.schedule || {})) {
    if (!spanned.has(+idx)) count += spans[+idx] || 1;
  }
  return count;
}

function renderReview() {
  const dynamic = document.getElementById('review-dynamic');
  const alltime = document.getElementById('review-alltime');
  if (!dynamic) return;

  if (ui.reviewMode === undefined) ui.reviewMode = 'week';
  if (ui.reviewWeekOffset === undefined) ui.reviewWeekOffset = 0;
  if (ui.reviewMonthOffset === undefined) ui.reviewMonthOffset = 0;

  const mode = ui.reviewMode;

  // Mode toggle (always built fresh)
  const modeToggle = document.createElement('div');
  modeToggle.className = 'review-mode-toggle';
  [['week','Week'], ['month','Month'], ['alltime','All Time']].forEach(([m, label]) => {
    const btn = document.createElement('button');
    btn.className = 'review-mode-btn' + (mode === m ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => { ui.reviewMode = m; renderReview(); };
    modeToggle.appendChild(btn);
  });

  if (mode === 'alltime') {
    dynamic.innerHTML = '';
    // Show just the mode toggle in the dynamic section
    const navRow = document.createElement('div');
    navRow.className = 'review-nav-row';
    const title = document.createElement('div');
    title.className = 'review-nav-title';
    title.textContent = 'All Time';
    navRow.appendChild(title);
    navRow.appendChild(modeToggle);
    dynamic.appendChild(navRow);
    if (alltime) alltime.style.display = '';
    renderStats();
  } else {
    if (alltime) alltime.style.display = 'none';
    dynamic.innerHTML = '';
    if (mode === 'week') renderWeekReview(dynamic, modeToggle);
    else renderMonthReview(dynamic, modeToggle);
  }
}

function renderWeekReview(panel, modeToggle) {
  const offset = ui.reviewWeekOffset;
  const days = getWeekDays(offset);
  const today = todayStr();
  const goal = dailyGoal();
  const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // Nav row
  const navRow = document.createElement('div');
  navRow.className = 'review-nav-row';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'nav-arr';
  prevBtn.innerHTML = '&#8592;';
  prevBtn.onclick = () => { ui.reviewWeekOffset--; renderReview(); };
  const nextBtn = document.createElement('button');
  nextBtn.className = 'nav-arr';
  nextBtn.innerHTML = '&#8594;';
  nextBtn.disabled = offset >= 0;
  nextBtn.onclick = () => { ui.reviewWeekOffset++; renderReview(); };
  const startD = dateFromStr(days[0]);
  const endD = dateFromStr(days[6]);
  const titleEl = document.createElement('div');
  titleEl.className = 'review-nav-title';
  titleEl.textContent = startD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' – ' + endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  navRow.appendChild(prevBtn);
  navRow.appendChild(titleEl);
  navRow.appendChild(nextBtn);
  if (offset !== 0) {
    const thisWeekBtn = document.createElement('button');
    thisWeekBtn.className = 'nav-today-btn';
    thisWeekBtn.textContent = 'This Week';
    thisWeekBtn.onclick = () => { ui.reviewWeekOffset = 0; renderReview(); };
    navRow.appendChild(thisWeekBtn);
  }
  navRow.appendChild(modeToggle);
  panel.appendChild(navRow);

  // Summary
  let totalBlocks = 0, totalMeetings = 0, goalMetDays = 0, workDays = 0;
  days.forEach(ds => {
    if (ds > today) return;
    const day = state.days[ds];
    if (!day || day.timeOff) return;
    workDays++;
    const done = countDoneBlocks(day);
    totalBlocks += done;
    if (done >= goal) goalMetDays++;
    Object.values(day.blockNotes || {}).forEach(bn => { if (bn.meeting) totalMeetings++; });
  });
  const summary = document.createElement('div');
  summary.className = 'review-summary';
  summary.innerHTML = `
    <div class="review-stat"><div class="review-stat-val" style="color:var(--gold)">${totalBlocks}</div><div class="review-stat-lbl">BLOCKS DONE</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--green)">${(totalBlocks*.5).toFixed(1)}h</div><div class="review-stat-lbl">HOURS</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--purple)">${totalMeetings}</div><div class="review-stat-lbl">MEETINGS</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--teal)">${goalMetDays}/${workDays}</div><div class="review-stat-lbl">GOAL MET</div></div>
  `;
  panel.appendChild(summary);
  appendReviewAnalytics(panel, days);

  // Day cards
  days.forEach((ds, i) => {
    const day = state.days[ds];
    const d = dateFromStr(ds);
    const isT = ds === today;
    const isFuture = ds > today;

    const card = document.createElement('div');
    card.className = 'review-day-card' + (isT ? ' review-day-today' : '') + (isFuture ? ' review-day-future' : '');

    const header = document.createElement('div');
    header.className = 'review-day-header';
    const lbl = document.createElement('div');
    lbl.className = 'review-day-label';
    lbl.innerHTML = `<span class="review-day-name">${DAY_NAMES[i]}</span><span class="review-day-date">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
    if (isT) {
      const badge = document.createElement('span');
      badge.className = 'review-today-badge';
      badge.textContent = 'TODAY';
      lbl.appendChild(badge);
    }
    header.appendChild(lbl);
    card.appendChild(header);

    if (!day || (!Object.keys(day.schedule || {}).length && !day.timeOff)) {
      const empty = document.createElement('div');
      empty.className = 'review-day-empty';
      empty.textContent = isFuture ? '—' : 'No blocks planned';
      card.appendChild(empty);
      panel.appendChild(card);
      return;
    }

    if (day.timeOff) {
      const toEl = document.createElement('div');
      toEl.className = 'review-day-timeoff';
      const worked = countDoneBlocks(day);
      toEl.textContent = '🌴 Time Off' + (worked > 0 ? ` · ${worked} blocks worked` : '');
      card.appendChild(toEl);
      panel.appendChild(card);
      return;
    }

    // Completion bar (stacked by project)
    const done = countDoneBlocks(day);
    const planned = countPlannedBlocks(day);
    const goalMet = done >= goal;
    const barRow = document.createElement('div');
    barRow.className = 'review-completion-row';

    const doneSet = new Set(day.completed || []);
    const projCounts = {};
    Object.entries(day.schedule || {}).forEach(([idx, pid]) => {
      if (doneSet.has(+idx)) projCounts[pid] = (projCounts[pid] || 0) + 1;
    });
    const projEntries = Object.entries(projCounts).sort((a, b) => b[1] - a[1]);
    const barTotal = planned || 1;

    const track = document.createElement('div');
    track.className = 'review-comp-bar-track';
    if (projEntries.length) {
      projEntries.forEach(([pid, count]) => {
        const p = getProject(pid);
        if (!p) return;
        const seg = document.createElement('div');
        seg.style.cssText = `width:${count/barTotal*100}%;background:${p.color};height:100%;flex-shrink:0`;
        seg.title = `${p.emoji} ${p.name}: ${count} blocks`;
        track.appendChild(seg);
      });
    }

    const label = document.createElement('span');
    label.className = 'review-comp-label';
    label.style.color = goalMet ? 'var(--green)' : 'var(--muted)';
    label.textContent = `${done}/${planned}`;

    barRow.appendChild(track);
    barRow.appendChild(label);
    card.appendChild(barRow);

    // Project pills
    const projIds = [...new Set(Object.values(day.schedule || {}))];
    if (projIds.length) {
      const pills = document.createElement('div');
      pills.className = 'review-proj-pills';
      projIds.forEach(pid => {
        const p = getProject(pid);
        if (!p) return;
        const pill = document.createElement('span');
        pill.className = 'review-proj-pill';
        pill.style.cssText = `background:${p.color}22;color:${p.color};border-color:${p.color}55`;
        pill.textContent = `${p.emoji} ${p.name}`;
        pills.appendChild(pill);
      });
      card.appendChild(pills);
    }

    // Note snippets
    const sched = day.schedule || {};
    const noteEntries = Object.entries(day.blockNotes || {}).filter(([, bn]) => (bn.note || '').trim());
    if (noteEntries.length) {
      const notesList = document.createElement('div');
      notesList.className = 'review-notes-list';
      noteEntries.forEach(([idxStr, bn]) => {
        const p = getProject(sched[+idxStr]);
        const snippet = bn.note.trim().slice(0, 120) + (bn.note.trim().length > 120 ? '…' : '');
        const item = document.createElement('div');
        item.className = 'review-note-item';
        item.innerHTML = `<span class="review-note-proj" style="color:${p?.color||'var(--muted)'}">${p?.emoji||''}</span><span class="review-note-text">${escHtml(snippet)}</span>`;
        notesList.appendChild(item);
      });
      card.appendChild(notesList);
    }

    panel.appendChild(card);
  });
}

function renderMonthReview(panel, modeToggle) {
  const offset = ui.reviewMonthOffset;
  const { year, month, days } = getMonthInfo(offset);
  const today = todayStr();
  const goal = dailyGoal();
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_HEADERS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  // Nav row
  const navRow = document.createElement('div');
  navRow.className = 'review-nav-row';
  const prevBtn = document.createElement('button');
  prevBtn.className = 'nav-arr';
  prevBtn.innerHTML = '&#8592;';
  prevBtn.onclick = () => { ui.reviewMonthOffset--; renderReview(); };
  const nextBtn = document.createElement('button');
  nextBtn.className = 'nav-arr';
  nextBtn.innerHTML = '&#8594;';
  nextBtn.disabled = offset >= 0;
  nextBtn.onclick = () => { ui.reviewMonthOffset++; renderReview(); };
  const titleEl = document.createElement('div');
  titleEl.className = 'review-nav-title';
  titleEl.textContent = `${MONTH_NAMES[month]} ${year}`;
  navRow.appendChild(prevBtn);
  navRow.appendChild(titleEl);
  navRow.appendChild(nextBtn);
  if (offset !== 0) {
    const thisMonthBtn = document.createElement('button');
    thisMonthBtn.className = 'nav-today-btn';
    thisMonthBtn.textContent = 'This Month';
    thisMonthBtn.onclick = () => { ui.reviewMonthOffset = 0; renderReview(); };
    navRow.appendChild(thisMonthBtn);
  }
  navRow.appendChild(modeToggle);
  panel.appendChild(navRow);

  // Summary
  let totalBlocks = 0, totalMeetings = 0, goalMetDays = 0, workDays = 0, timeOffDays = 0;
  days.forEach(ds => {
    if (ds > today) return;
    const day = state.days[ds];
    if (!day) return;
    if (day.timeOff) { timeOffDays++; return; }
    workDays++;
    const done = countDoneBlocks(day);
    totalBlocks += done;
    if (done >= goal) goalMetDays++;
    Object.values(day.blockNotes || {}).forEach(bn => { if (bn.meeting) totalMeetings++; });
  });
  const summary = document.createElement('div');
  summary.className = 'review-summary';
  summary.innerHTML = `
    <div class="review-stat"><div class="review-stat-val" style="color:var(--gold)">${totalBlocks}</div><div class="review-stat-lbl">BLOCKS DONE</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--green)">${(totalBlocks*.5).toFixed(1)}h</div><div class="review-stat-lbl">HOURS</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--purple)">${totalMeetings}</div><div class="review-stat-lbl">MEETINGS</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--teal)">${goalMetDays}/${workDays}</div><div class="review-stat-lbl">GOAL MET</div></div>
    <div class="review-stat"><div class="review-stat-val" style="color:var(--orange)">${timeOffDays}</div><div class="review-stat-lbl">DAYS OFF</div></div>
  `;
  panel.appendChild(summary);

  // Calendar grid
  const cal = document.createElement('div');
  cal.className = 'review-cal-wrap';
  DAY_HEADERS.forEach(n => {
    const h = document.createElement('div');
    h.className = 'review-cal-day-header';
    h.textContent = n;
    cal.appendChild(h);
  });
  // Leading blanks
  const firstDow = new Date(year, month, 1).getDay();
  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('div');
    blank.className = 'review-cal-cell review-cal-blank';
    cal.appendChild(blank);
  }
  days.forEach(ds => {
    const day = state.days[ds];
    const d = dateFromStr(ds);
    const isT = ds === today;
    const isFuture = ds > today;
    const done = day ? countDoneBlocks(day) : 0;
    const planned = day ? countPlannedBlocks(day) : 0;
    const goalMet = done >= goal;

    const cell = document.createElement('div');
    cell.className = 'review-cal-cell' + (isT ? ' review-cal-today' : '') + (isFuture ? ' review-cal-future' : '');

    // Date row: number + optional meeting badge
    const dateRow = document.createElement('div');
    dateRow.className = 'review-cal-date-row';
    const dateNum = document.createElement('span');
    dateNum.className = 'review-cal-date';
    dateNum.textContent = d.getDate();
    dateRow.appendChild(dateNum);
    if (!isFuture && day) {
      const meetingCount = Object.values(day.blockNotes || {}).filter(bn => bn.meeting).length;
      if (meetingCount > 0) {
        const mtBadge = document.createElement('span');
        mtBadge.className = 'review-cal-meeting-badge';
        mtBadge.textContent = '📅';
        mtBadge.title = `${meetingCount} meeting${meetingCount > 1 ? 's' : ''}`;
        dateRow.appendChild(mtBadge);
      }
    }
    cell.appendChild(dateRow);

    if (day?.timeOff) {
      const to = document.createElement('div');
      to.className = 'review-cal-timeoff';
      to.textContent = '🌴';
      cell.appendChild(to);
      if (done > 0) {
        const workedLbl = document.createElement('div');
        workedLbl.className = 'review-cal-count';
        workedLbl.textContent = `${done} worked`;
        workedLbl.style.color = 'var(--gold)';
        cell.appendChild(workedLbl);
      }
    } else if (!isFuture && planned > 0) {
      // Completion bar
      const bar = document.createElement('div');
      bar.className = 'review-cal-bar';
      bar.style.background = goalMet ? 'var(--green)' : done > 0 ? 'var(--gold)' : 'var(--border2)';
      bar.style.opacity = done > 0 ? Math.min(0.35 + done / (goal * 1.5) * 0.65, 1).toFixed(2) : '0.4';
      cell.appendChild(bar);

      // Done/planned + hours
      const statsRow = document.createElement('div');
      statsRow.className = 'review-cal-stats-row';
      statsRow.innerHTML = `<span style="color:${goalMet ? 'var(--green)' : done > 0 ? 'var(--muted)' : 'var(--faint)'}">${done}/${planned}</span><span style="color:var(--faint)">${(done*.5).toFixed(1)}h</span>`;
      cell.appendChild(statsRow);

      // Mini project stacked bar
      const doneSet = new Set(day.completed || []);
      const projCounts = {};
      Object.entries(day.schedule || {}).forEach(([idx, pid]) => {
        if (doneSet.has(+idx)) projCounts[pid] = (projCounts[pid] || 0) + 1;
      });
      const projEntries = Object.entries(projCounts).sort((a, b) => b[1] - a[1]);
      if (projEntries.length) {
        const barTotal = projEntries.reduce((s, [, n]) => s + n, 0) || 1;
        const miniBar = document.createElement('div');
        miniBar.className = 'review-cal-proj-bar';
        projEntries.forEach(([pid, count]) => {
          const p = getProject(pid);
          if (!p) return;
          const seg = document.createElement('div');
          seg.style.cssText = `width:${count/barTotal*100}%;background:${p.color};height:100%`;
          seg.title = `${p.emoji} ${p.name}: ${count} blocks`;
          miniBar.appendChild(seg);
        });
        cell.appendChild(miniBar);
      }
    }
    cal.appendChild(cell);
  });
  panel.appendChild(cal);

  appendReviewAnalytics(panel, days);
}

// ════════════════════════════════════════════════════════════
//  RENDER: NOTES TAB
// ════════════════════════════════════════════════════════════
function renderNotesTab() {
  const projList = document.getElementById('notes-tab-proj-list');
  const logEl = document.getElementById('notes-tab-log');
  if (!projList || !logEl) return;

  // Build a map: projId -> [{date, blockIdx, timeLabel, note, todos, importance, isStandalone?, noteId?}]
  const projEntries = {};
  Object.entries(state.days).forEach(([ds, dayData]) => {
    const sched = dayData.schedule || {};
    const blockNotes = dayData.blockNotes || {};
    Object.entries(blockNotes).forEach(([idxStr, bn]) => {
      const idx = +idxStr;
      const note = (bn.note || '').trim();
      const resumeNote = (bn.resumeNote || '').trim();
      const todos = (bn.todos || []);
      const meeting = bn.meeting === true;
      if (!note && !resumeNote) return;
      const projId = sched[idx];
      if (!projId) return;
      if (!projEntries[projId]) projEntries[projId] = [];
      const [h, half] = blockToTime(idx);
      projEntries[projId].push({
        date: ds,
        blockIdx: idx,
        timeLabel: formatTime(h, half),
        note,
        resumeNote,
        todos,
        importance: bn.importance || null,
        tags: bn.tags || [],
        meeting
      });
    });
  });

  // Also include standalone project notes
  Object.entries(state.projNotes || {}).forEach(([projId, notes]) => {
    (notes || []).forEach(n => {
      if (!projEntries[projId]) projEntries[projId] = [];
      projEntries[projId].push({
        date: n.date,
        blockIdx: null,
        timeLabel: null,
        note: (n.note || '').trim(),
        resumeNote: '',
        todos: [],
        importance: n.importance || null,
        tags: n.tags || [],
        meeting: n.meeting === true,
        isStandalone: true,
        noteId: n.id
      });
    });
  });

  // Helper: get all entries for a project including its children
  const getEntriesForProj = (projId) => {
    const own = (projEntries[projId] || []).map(e => ({ ...e, projId }));
    const children = state.projects.filter(sp => sp.parentId === projId);
    const childEntries = children.flatMap(sp => (projEntries[sp.id] || []).map(e => ({ ...e, projId: sp.id })));
    return [...own, ...childEntries];
  };

  // All top-level projects (show all so users can add notes to any project)
  const allTopLevel = state.projects.filter(p => !p.parentId);
  const projs = allTopLevel; // show all projects, not just ones with notes
  const allCount = Object.values(projEntries).reduce((s, arr) => s + arr.length, 0);

  // Validate selected project
  if (!ui.notesTabProjId) {
    const withNotes = allTopLevel.find(p => getEntriesForProj(p.id).length > 0);
    ui.notesTabProjId = allCount > 0 ? '__all__' : (allTopLevel.length ? allTopLevel[0].id : null);
    if (allCount > 0 && withNotes) ui.notesTabProjId = '__all__';
  }

  // Render project list in hierarchy
  projList.innerHTML = '<div class="section-label" style="margin-bottom:10px">Projects</div>';
  if (!projs.length) {
    projList.innerHTML += '<div style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--faint);padding:6px 4px">No projects yet.</div>';
  } else {
    if (allCount > 0) {
      const allBtn = document.createElement('button');
      allBtn.className = 'notes-tab-proj-btn' + (ui.notesTabProjId === '__all__' ? ' active' : '');
      allBtn.innerHTML = `<div class="notes-tab-proj-dot" style="background:var(--muted)"></div>
        <span class="notes-tab-proj-name">All projects</span>
        <span class="notes-tab-proj-count">${allCount}</span>`;
      allBtn.onclick = () => { ui.notesTabProjId = '__all__'; renderNotesTab(); };
      projList.appendChild(allBtn);
    }

    // Build hierarchical list — all projects
    allTopLevel.forEach(p => {
      const count = getEntriesForProj(p.id).length;
      const isActive = p.id === ui.notesTabProjId;
      const btn = document.createElement('button');
      btn.className = 'notes-tab-proj-btn' + (isActive ? ' active' : '') + (count === 0 ? ' notes-tab-proj-btn-empty' : '');
      btn.innerHTML = `<div class="notes-tab-proj-dot" style="background:${p.color}"></div>
        <span class="notes-tab-proj-name">${p.emoji} ${p.name}</span>
        ${count > 0 ? `<span class="notes-tab-proj-count">${count}</span>` : ''}`;
      btn.onclick = () => { ui.notesTabProjId = p.id; renderNotesTab(); };
      projList.appendChild(btn);
      // Child projects
      state.projects.filter(sp => sp.parentId === p.id).forEach(sp => {
        const spCount = getEntriesForProj(sp.id).length;
        const spActive = sp.id === ui.notesTabProjId;
        const spBtn = document.createElement('button');
        spBtn.className = 'notes-tab-proj-btn notes-tab-proj-btn-child' + (spActive ? ' active' : '') + (spCount === 0 ? ' notes-tab-proj-btn-empty' : '');
        spBtn.innerHTML = `<span class="notes-proj-child-indent">└</span><div class="notes-tab-proj-dot" style="background:${sp.color}"></div>
          <span class="notes-tab-proj-name">${sp.emoji} ${sp.name}</span>
          ${spCount > 0 ? `<span class="notes-tab-proj-count">${spCount}</span>` : ''}`;
        spBtn.onclick = () => { ui.notesTabProjId = sp.id; renderNotesTab(); };
        projList.appendChild(spBtn);
      });
    });
  }

  // Render filter bar — stars row + tags row
  const filterBar = document.getElementById('notes-tab-filter-bar');
  if (filterBar) {
    filterBar.innerHTML = '';

    // Add Note button row (only when a specific project is selected)
    if (ui.notesTabProjId && ui.notesTabProjId !== '__all__') {
      const addRow = document.createElement('div');
      addRow.className = 'notes-filter-row';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-primary';
      addBtn.style.cssText = 'font-size:10px;padding:5px 13px;';
      addBtn.textContent = '+ Add Note';
      addBtn.onclick = () => openProjNoteModal(ui.notesTabProjId);
      addRow.appendChild(addBtn);
      filterBar.appendChild(addRow);
    }

    // Stars row
    const starsRow = document.createElement('div');
    starsRow.className = 'notes-filter-row';
    const filterLabels = ['All', '★', '★★', '★★★', '★★★★', '★★★★★'];
    filterLabels.forEach((lbl, i) => {
      const btn = document.createElement('button');
      btn.className = 'imp-filter-btn' + (ui.notesTabImportanceFilter === i ? ' active' : '');
      btn.textContent = lbl;
      btn.onclick = () => { ui.notesTabImportanceFilter = i; renderNotesTab(); };
      starsRow.appendChild(btn);
    });
    filterBar.appendChild(starsRow);
    // Tags row
    const tagsRow = document.createElement('div');
    tagsRow.className = 'notes-filter-row';
    const allTagBtn = document.createElement('button');
    allTagBtn.className = 'imp-filter-btn' + (!ui.notesTabTagFilter.length ? ' active' : '');
    allTagBtn.textContent = 'All tags';
    allTagBtn.onclick = () => { ui.notesTabTagFilter = []; renderNotesTab(); };
    tagsRow.appendChild(allTagBtn);
    (state.settings.tags || []).forEach(tag => {
      const isActive = ui.notesTabTagFilter.includes(tag.id);
      const btn = document.createElement('button');
      btn.className = 'tag-pill-btn' + (isActive ? ' active' : '');
      btn.style.cssText = `border-color:${tag.color}50;--tag-color:${tag.color}`;
      btn.innerHTML = `<span style="background:${tag.color}"></span>${tag.name ? escAttr(tag.name) : ''}`;
      btn.onclick = () => {
        if (isActive) ui.notesTabTagFilter = ui.notesTabTagFilter.filter(id => id !== tag.id);
        else ui.notesTabTagFilter = [...ui.notesTabTagFilter, tag.id];
        renderNotesTab();
      };
      tagsRow.appendChild(btn);
    });
    filterBar.appendChild(tagsRow);
    // Meeting row
    const meetingRow = document.createElement('div');
    meetingRow.className = 'notes-filter-row';
    const allTypeBtn = document.createElement('button');
    allTypeBtn.className = 'imp-filter-btn' + (!ui.notesTabMeetingFilter ? ' active' : '');
    allTypeBtn.textContent = 'All types';
    allTypeBtn.onclick = () => { ui.notesTabMeetingFilter = false; renderNotesTab(); };
    meetingRow.appendChild(allTypeBtn);
    const meetingOnlyBtn = document.createElement('button');
    meetingOnlyBtn.className = 'meeting-toggle-btn' + (ui.notesTabMeetingFilter ? ' active' : '');
    meetingOnlyBtn.innerHTML = '📅 Meetings';
    meetingOnlyBtn.onclick = () => { ui.notesTabMeetingFilter = !ui.notesTabMeetingFilter; renderNotesTab(); };
    meetingRow.appendChild(meetingOnlyBtn);
    const leftOffFilterBtn = document.createElement('button');
    leftOffFilterBtn.className = 'imp-filter-btn' + (ui.notesTabLeftOffFilter ? ' active' : '');
    leftOffFilterBtn.textContent = '📌 Left off';
    leftOffFilterBtn.onclick = () => { ui.notesTabLeftOffFilter = !ui.notesTabLeftOffFilter; renderNotesTab(); };
    meetingRow.appendChild(leftOffFilterBtn);
    const imageFilterBtn = document.createElement('button');
    imageFilterBtn.className = 'imp-filter-btn' + (ui.notesTabImageFilter ? ' active' : '');
    imageFilterBtn.textContent = '🖼 Images';
    imageFilterBtn.onclick = () => { ui.notesTabImageFilter = !ui.notesTabImageFilter; renderNotesTab(); };
    meetingRow.appendChild(imageFilterBtn);
    filterBar.appendChild(meetingRow);
  }

  // Render log for selected project
  logEl.innerHTML = '';
  if (!ui.notesTabProjId) {
    logEl.innerHTML = '<div class="notes-log-empty">No projects found.</div>';
    return;
  }

  const isAll = ui.notesTabProjId === '__all__';
  const rawEntries = isAll
    ? Object.entries(projEntries).flatMap(([pid, arr]) => arr.map(e => ({ ...e, projId: pid })))
    : getEntriesForProj(ui.notesTabProjId);
  const allEntries = rawEntries.slice().sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    // standalone notes sort after block notes on the same day
    if (a.isStandalone && !b.isStandalone) return 1;
    if (!a.isStandalone && b.isStandalone) return -1;
    return (b.blockIdx || 0) - (a.blockIdx || 0);
  });
  const hasImage = e => /!\[/.test(e.note);
  const entries = allEntries
    .filter(e => ui.notesTabImportanceFilter === 0 || (e.importance || 0) === ui.notesTabImportanceFilter)
    .filter(e => !ui.notesTabTagFilter.length || ui.notesTabTagFilter.some(tid => (e.tags || []).includes(tid)))
    .filter(e => !ui.notesTabMeetingFilter || e.meeting === true)
    .filter(e => !ui.notesTabLeftOffFilter || !!e.resumeNote)
    .filter(e => !ui.notesTabImageFilter || hasImage(e));

  if (!entries.length) {
    const hasFilter = ui.notesTabImportanceFilter > 0 || ui.notesTabTagFilter.length > 0 || ui.notesTabMeetingFilter || ui.notesTabLeftOffFilter || ui.notesTabImageFilter;
    logEl.innerHTML = `<div class="notes-log-empty">${hasFilter ? 'No notes match the current filters.' : 'No notes for this project yet.'}</div>`;
    return;
  }

  // Group by date
  const byDate = {};
  entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).forEach(([ds, dayEntries]) => {
    const group = document.createElement('div');
    group.className = 'notes-log-date-group';
    const dateLabel = formatDateLabel(ds);
    group.innerHTML = `<div class="notes-log-date-header"><span>${dateLabel}</span><div class="notes-log-date-line"></div></div>`;

    dayEntries.forEach(e => {
      const card = document.createElement('div');
      card.className = 'notes-log-entry';
      const entryProj = getProject(e.projId);
      const timeDisplay = e.isStandalone
        ? `<span style="color:var(--faint);font-style:italic">note</span>`
        : e.timeLabel;
      let html = `<div class="notes-log-entry-header">
        <div class="notes-log-entry-time">${timeDisplay}</div>
        <div class="notes-log-entry-proj">
          <div class="notes-log-entry-proj-dot" style="background:${entryProj.color}"></div>
          <span style="color:${entryProj.color}">${entryProj.emoji} ${entryProj.name}</span>
        </div>
        ${e.meeting?`<span class="badge-meeting" style="margin-left:2px">📅 meeting</span>`:''}
        ${e.importance?`<div class="notes-log-imp-stars" title="Importance: ${e.importance}/5">${'★'.repeat(e.importance)}${'☆'.repeat(5-e.importance)}</div>`:''}
        ${(e.tags||[]).length ? `<div class="notes-log-tags">${(e.tags).map(tid=>{const t=(state.settings.tags||[]).find(x=>x.id===tid);return t?`<span class="notes-log-tag-dot" title="${t.name||tid}" style="background:${t.color}"></span>`:''}).join('')}</div>` : ''}
        ${e.isStandalone ? `<button class="notes-standalone-del-btn" title="Delete note" data-noteid="${e.noteId}" data-projid="${e.projId}">✕</button>` : ''}
      </div>`;
      if (e.resumeNote) {
        html += `<div class="notes-log-resume-note"><span class="notes-log-resume-label">📌 left off</span>${escHtml(e.resumeNote)}</div>`;
      }
      if (e.note) {
        html += `<div class="notes-log-note-text md-preview" style="border-radius:6px;padding:4px 6px;cursor:pointer;word-break:break-word;line-height:1.6;color:var(--muted)">${renderMarkdown(e.note)}</div>`;
      } else {
        html += `<div class="notes-log-note-text" style="border-radius:6px;padding:4px 6px;cursor:pointer;color:var(--faint);font-style:italic">Click to edit note…</div>`;
      }
      if (e.todos.length) {
        html += `<div class="notes-log-todos"><div class="notes-log-todos-label">TO-DOS</div>`;
        e.todos.forEach(t => {
          html += `<div class="notes-log-todo-item${t.done?' done':''}">
            <div class="notes-log-todo-dot${t.done?' done':''}"></div>
            <span>${(t.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
          </div>`;
        });
        html += `</div>`;
      }
      card.innerHTML = html;
      card.style.cursor = 'pointer';
      if (e.isStandalone) {
        card.onclick = (ev) => {
          if (ev.target.closest('.notes-standalone-del-btn')) return;
          openProjNoteModal(e.projId, e.noteId);
        };
        // Delete button handler
        const delBtn = card.querySelector('.notes-standalone-del-btn');
        if (delBtn) {
          delBtn.onclick = (ev) => {
            ev.stopPropagation();
            const pid = delBtn.dataset.projid;
            const nid = delBtn.dataset.noteid;
            if (state.projNotes[pid]) {
              state.projNotes[pid] = state.projNotes[pid].filter(n => n.id !== nid);
            }
            save();
            renderNotesTab();
          };
        }
      } else {
        card.onclick = () => openNotesModal(e.blockIdx, e.date, true);
      }
      group.appendChild(card);
    });
    logEl.appendChild(group);
  });
}

// ════════════════════════════════════════════════════════════
//  EXPORT: NOTES → MARKDOWN
// ════════════════════════════════════════════════════════════
function buildNotesEntries(projId) {
  // Returns [{date, blockIdx, timeLabel, note, todos}] for a given project
  const entries = [];
  Object.entries(state.days).forEach(([ds, dayData]) => {
    const sched = dayData.schedule || {};
    const blockNotes = dayData.blockNotes || {};
    Object.entries(blockNotes).forEach(([idxStr, bn]) => {
      const idx = +idxStr;
      const note = (bn.note || '').trim();
      const todos = (bn.todos || []);
      if (!note && !todos.length) return;
      if (sched[idx] !== projId) return;
      const [h, half] = blockToTime(idx);
      entries.push({
        date: ds,
        blockIdx: idx,
        timeLabel: formatTime(h, half),
        note,
        todos
      });
    });
  });
  return entries;
}

function exportNotesMarkdown(projId) {
  const proj = getProject(projId);
  if (!proj) return;
  const entries = buildNotesEntries(projId).sort((a, b) => b.date.localeCompare(a.date) || b.blockIdx - a.blockIdx);
  if (!entries.length) {
    alert('No notes found for this project.');
    return;
  }

  const lines = [];
  lines.push(`# ${proj.emoji} ${proj.name} — Notes Log`);
  lines.push(`*Exported ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}*`);
  lines.push('');

  // Group by year → month → day
  const byYear = {};
  entries.forEach(e => {
    const [y, m, d] = e.date.split('-');
    if (!byYear[y]) byYear[y] = {};
    if (!byYear[y][m]) byYear[y][m] = [];
    byYear[y][m].push({
      ...e,
      day: d
    });
  });

  Object.keys(byYear).sort((a, b) => b - a).forEach(year => {
    lines.push(`# ${year}`);
    lines.push('');
    const months = byYear[year];
    Object.keys(months).sort((a, b) => b - a).forEach(month => {
      const monthName = new Date(`${year}-${month}-15`).toLocaleDateString('en-US', {
        month: 'long'
      });
      lines.push(`## ${monthName}`);
      lines.push('');

      // Group days within month
      const byDay = {};
      months[month].forEach(e => {
        if (!byDay[e.day]) byDay[e.day] = [];
        byDay[e.day].push(e);
      });
      Object.keys(byDay).sort((a, b) => b - a).forEach(day => {
        const dateObj = new Date(`${year}-${month}-${day}T12:00:00`);
        const dayLabel = dateObj.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric'
        });
        lines.push(`### ${dayLabel}`);
        lines.push('');
        byDay[day].forEach(e => {
          lines.push(`**${e.timeLabel}**`);
          if (e.note) {
            lines.push('');
            lines.push(e.note);
          }
          if (e.todos && e.todos.length) {
            lines.push('');
            e.todos.forEach(t => {
              lines.push(`- [${t.done?'x':' '}] ${t.text||''}`);
            });
          }
          lines.push('');
        });
      });
    });
  });

  const blob = new Blob([lines.join('\n')], {
    type: 'text/markdown'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safeName = proj.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  a.download = `notes-${safeName}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function switchTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === tab + '-panel'));
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = tab === 'plan' ? '' : 'none';
  if (tab === 'review') renderReview();
  if (tab === 'today') {
    ui.currentDate = todayStr();
    renderTodayTab();
    if (ui.focusBlock !== null) renderBlockFocus();
  }
  if (tab === 'todos') {
    // Reset open state to default each time the tab is visited
    ui.openProjTodosIds = state.settings.todosDefaultOpen !== false ? null : new Set();
    renderTodosTab();
  }
  if (tab === 'notes') renderNotesTab();
  if (tab === 'plan') {
    renderScheduleGrid();
    renderSidebar();
    renderHeaderStats();
    setTimeout(updateTimeneedle, 50);
  }
}

function renderAll() {
  renderDateNav();
  renderHeaderStats();
  renderSidebar();
  renderScheduleGrid();
  const sidebarEl = document.getElementById('sidebar');
  if (sidebarEl) sidebarEl.style.display = ui.tab === 'plan' ? '' : 'none';
  if (ui.tab === 'today') renderTodayTab();
  else renderTimerCard();
  if (ui.tab === 'review') renderReview();
  if (ui.tab === 'todos') renderTodosTab();
  if (ui.tab === 'notes') renderNotesTab();
}

function startClockTick() {
  clearInterval(ui.clockInterval);
  ui.clockInterval = setInterval(() => {
    // Detect day rollover — if ui.currentDate was "today" and the date has changed, update it
    const realToday = todayStr();
    if (ui._lastKnownDate && ui._lastKnownDate !== realToday) {
      // Day changed — ensure new day exists, snap currentDate if it was the old today
      ensureForwardDays();
      save();
      if (ui.currentDate === ui._lastKnownDate) ui.currentDate = realToday;
      renderAll();
    }
    ui._lastKnownDate = realToday;
    if (ui.tab === 'plan') updateTimeneedle();
    if (ui.tab === 'today' && isToday()) renderTimeline();
  }, 30000);
  // Seed the last known date immediately
  ui._lastKnownDate = todayStr();
}

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Try loading from server file first (most up-to-date), fall back to localStorage
  (async () => {
    load(); // seed from localStorage immediately so UI isn't blank
    const fromServer = await loadFromServer();
    if (fromServer) {
      // Merge server state into localStorage too
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch (e) {}
    }
    ensureForwardDays();
    restoreTimerState(); // restore timer before rendering so activeBlock/focusBlock are set
    renderAll();
    updateNotifEnableRow();
    startClockTick();
    // If timer was restored and focus block is set, switch to Today and show focus view
    if (ui.timerRunning && ui.focusBlock !== null) {
      switchTab('today');
      showBlockFocus(ui.focusBlock);
    }
  })();

  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Arrow keys cycle tabs
  const TAB_ORDER = ['plan', 'today', 'todos', 'notes', 'review'];
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const idx = TAB_ORDER.indexOf(ui.tab);
      const next = e.key === 'ArrowRight' ? (idx + 1) % TAB_ORDER.length : (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      switchTab(TAB_ORDER[next]);
    }
  });

  // Momentum tooltip toggle
  const momentumBtn = document.getElementById('momentum-info-btn');
  const momentumTooltip = document.getElementById('momentum-tooltip');
  if (momentumBtn && momentumTooltip) {
    momentumBtn.addEventListener('click', e => {
      e.stopPropagation();
      momentumTooltip.classList.toggle('visible');
    });
    document.addEventListener('click', () => momentumTooltip.classList.remove('visible'));
  }

  document.getElementById('nav-prev').addEventListener('click', () => {
    const days = [todayStr(), ...sortedDays()].filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
    const idx = days.indexOf(ui.currentDate);
    if (idx < days.length - 1) {
      ui.currentDate = days[idx + 1];
      renderAll();
    } else {
      // On the oldest day — generate one more day backward
      const oldest = new Date(ui.currentDate + 'T00:00:00');
      oldest.setDate(oldest.getDate() - 1);
      const ds = oldest.toISOString().slice(0, 10);
      if (!state.days[ds]) state.days[ds] = {
        schedule: {},
        completed: [],
        blockNotes: {},
        timeOff: isWeekend(ds)
      };
      save();
      ui.currentDate = ds;
      renderAll();
    }
  });
  document.getElementById('nav-next').addEventListener('click', () => {
    const days = [todayStr(), ...sortedDays()].filter((v, i, a) => a.indexOf(v) === i).sort().reverse();
    const idx = days.indexOf(ui.currentDate);
    if (idx > 0) {
      ui.currentDate = days[idx - 1];
      renderAll();
    }
  });
  document.getElementById('nav-today-btn').addEventListener('click', () => {
    ui.currentDate = todayStr();
    renderAll();
  });

  // Goal input
  document.getElementById('goal-input').addEventListener('change', e => {
    const v = Math.max(1, Math.min(36, +e.target.value || 8));
    const oldGoal = dailyGoal();
    // Freeze all existing days that don't have an explicit goal so the global
    // change doesn't retroactively alter their stats calculation
    Object.keys(state.days).forEach(ds => {
      if (!state.days[ds].dailyGoal) state.days[ds].dailyGoal = oldGoal;
    });
    // Store new goal on current day
    const day = currentDayData();
    day.dailyGoal = v;
    setDay(ui.currentDate, day);
    // Update global default so future days inherit the new value
    state.settings.dailyGoal = v;
    e.target.value = v;
    save();
    renderHeaderStats();
    if (ui.tab === 'today') renderGamePanel();
  });

  // Time-off toggle
  document.getElementById('timeoff-btn').addEventListener('click', toggleTimeOff);

  // Settings panel (btn uses onclick in HTML; close/overlay-click wired here)
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('settings-overlay')) closeSettings();
  });

  // Pivot picker
  document.getElementById('pivot-picker-close').onclick = closePivotPicker;
  document.getElementById('pivot-picker-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('pivot-picker-overlay')) closePivotPicker();
  });

  // Image paste support for note textareas
  function attachImagePaste(textareaId, getProjName) {
    const el = document.getElementById(textareaId);
    if (!el) return;
    el.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          const reader = new FileReader();
          reader.onload = async ev => {
            const dataUrl = ev.target.result;
            const userFilename = prompt('Image filename (no extension):', 'image');
            if (userFilename === null) return; // user cancelled
            const filename = userFilename.trim() || 'image';
            const projName  = (getProjName && getProjName()) || 'misc';
            const yearMonth = todayStr().slice(0, 7); // "2026-03"
            function insertText(text) {
              const pos = el.selectionStart;
              const val = el.value;
              el.value = val.slice(0, pos) + text + val.slice(el.selectionEnd);
              el.selectionStart = el.selectionEnd = pos + text.length;
              el.dispatchEvent(new Event('input'));
            }
            try {
              const resp = await fetch('/save-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: dataUrl, filename, project: projName, yearMonth })
              });
              const result = await resp.json();
              if (result.ok) {
                insertText(`![${filename}](/${result.path})`);
                return;
              }
            } catch (_) { /* server offline — fall through to base64 */ }
            // Fallback: embed as base64 data URL
            insertText(`![${filename}](${dataUrl})`);
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    });
  }
  attachImagePaste('notes-textarea', () => {
    if (ui.notesProjId) {
      const p = getProject(ui.notesProjId); return p ? p.name : 'misc';
    }
    const p = getProject((getDay(ui.notesDate || ui.currentDate).schedule || {})[ui.notesBlockIdx]);
    return p ? p.name : 'misc';
  });
  attachImagePaste('block-focus-note-area', () => {
    const p = getProject((getDay(todayStr()).schedule || {})[ui.focusBlock]);
    return p ? p.name : 'misc';
  });

  // Notes modal
  document.getElementById('notes-close').onclick = closeNotesModal;
  document.getElementById('block-focus-back').addEventListener('click', () => {
    hideBlockFocus();
    renderTodayTab();
  });
  document.getElementById('notes-cancel-btn').onclick = closeNotesModal;
  document.getElementById('notes-save-btn').onclick = saveNotesModal;
  document.getElementById('notes-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('notes-overlay')) closeNotesModal();
  });
  // Export/Import
  document.getElementById('export-btn').addEventListener('click', exportYaml);
  document.getElementById('export-notes-md-btn').addEventListener('click', () => {
    if (ui.notesTabProjId) exportNotesMarkdown(ui.notesTabProjId);
  });
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-input').click());
  document.getElementById('import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => importYaml(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  });

  // Close dropdown on outside click; also cancel project drag
  document.addEventListener('click', () => closeDropdown());
  document.addEventListener('dragend', () => {
    ui.dragProjId = null;
    ui.dragSrcIdx = null;
    document.querySelectorAll('.proj-drop-target,.drag-over').forEach(r => r.classList.remove('proj-drop-target', 'drag-over'));
  });

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Resume audio context if it was suspended while tab was hidden
      if (_soundCtx && _soundCtx.state === 'suspended') {
        _soundCtx.resume().then(() => { if (_soundInterval) _playChime(); });
      }
      // Check if the date changed while tab was hidden (e.g. left open overnight)
      const realToday = todayStr();
      if (ui._lastKnownDate && ui._lastKnownDate !== realToday) {
        ensureForwardDays();
        save();
        if (ui.currentDate === ui._lastKnownDate) ui.currentDate = realToday;
        ui._lastKnownDate = realToday;
        renderAll();
      } else {
        renderTimerCard();
        if (ui.tab === 'plan') updateTimeneedle();
      }
    }
  });
  document.getElementById('plan-panel').addEventListener('scroll', updateTimeneedle);

  // Redraw charts on resize
  window.addEventListener('resize', () => {
    if (ui.tab === 'review' && ui.reviewMode === 'alltime') renderStats();
  });

  // beforeunload — do a final save to server
  window.addEventListener('beforeunload', () => {
    try {
      const yaml = toYaml();
      navigator.sendBeacon('/save', new Blob([yaml], {
        type: 'text/yaml'
      }));
    } catch (_) {}
  });
});