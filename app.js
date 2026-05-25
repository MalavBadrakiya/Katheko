const DAY_MS = 86_400_000;
const STORAGE_KEY = "katheko-webapp-state-v1"; // kept as migration fallback key
const UI_KEY = "katheko-webapp-ui-v1";

const views = [
  ["dashboard", "Home"],
  ["habits", "Habits"],
  ["loops", "Loops"],
  ["analytics", "Analytics"],
  ["profile", "Profile"],
  ["coach", "Coach"],
];

const XP_RULES = {
  habitLog: 10,
  habitWeek: 50,
  habitPerfectWeek: 25,
  loopComplete: 20,
  loopWeek: 40,
  seasonComplete: 150,
};

// ── Supabase client ──────────────────────────────────────────
const _db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── App state ────────────────────────────────────────────────
let state       = null;   // loaded async from Supabase
let currentUser = null;   // Supabase auth user object
let ui          = loadUi();
let runtime     = {
  session: null,
  ticker: null,
  audio: null,
  serviceWorkerReady: null,
  metricTimer: null,
};

registerServiceWorker();
initApp();               // async — sets up auth then renders

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form;

  if (type === "auth-login")  handleAuthLogin(data);
  if (type === "auth-signup") handleAuthSignup(data);
  if (type === "add-habit") addHabit(data);
  if (type === "edit-habit") updateHabit(data);
  if (type === "add-loop") addLoop(data, form);
  if (type === "edit-loop") updateLoop(data, form);
  if (type === "add-season") addSeason(data);
  if (type === "add-note") addKnowledgeNote(data);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-analytics-habit]")) {
    ui.analyticsHabitId = target.value;
    persistUi();
    render();
  }
  if (target.matches("[data-note-filter]")) {
    ui.noteFilter = target.value;
    ui.notesExpanded = false;
    persistUi();
    render();
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "view") setView(button.dataset.view);
  if (action === "toggle-mobile-more") toggleMobileMore();
  if (action === "flip-metric") flipMetric(button.dataset.metricId);
  if (action === "sign-out") handleSignOut();
  if (action === "auth-toggle") toggleAuthMode();
  if (action === "toggle-habit") toggleHabitLog(button.dataset.habitId, button.dataset.date);
  if (action === "edit-habit") setEditHabit(button.dataset.habitId);
  if (action === "cancel-edit-habit") setEditHabit("");
  if (action === "archive-habit") archiveHabit(button.dataset.habitId, true);
  if (action === "restore-habit") archiveHabit(button.dataset.habitId, false);
  if (action === "delete-habit") deleteHabit(button.dataset.habitId);
  if (action === "start-loop") startSession(button.dataset.loopId);
  if (action === "pause-session") pauseSession();
  if (action === "resume-session") resumeSession();
  if (action === "next-step") finishStep();
  if (action === "abandon-session") completeSession(false);
  if (action === "discard-session") discardSession();
  if (action === "remove-loop") archiveLoop(button.dataset.loopId);
  if (action === "restore-loop") archiveLoop(button.dataset.loopId, false);
  if (action === "delete-loop") deleteLoop(button.dataset.loopId);
  if (action === "enable-notifications") enableNotifications();
  if (action === "export-csv") exportCsv();
  if (action === "export-json") exportJson();
  if (action === "reset-demo") resetDemoData();
  if (action === "edit-loop") setEditLoop(button.dataset.loopId);
  if (action === "cancel-edit-loop") setEditLoop("");
  if (action === "new-step-row") addStepEditorRow(button.dataset.stepTarget);
  if (action === "remove-step-row") button.closest("[data-step-row]")?.remove();
  if (action === "toggle-notes-expanded") toggleNotesExpanded();
  if (action === "export-knowledge") exportKnowledgeBase();
  if (action === "habit-week-prev") setHabitWeek(-1);
  if (action === "habit-week-next") setHabitWeek(1);
  if (action === "habit-week-current") setHabitWeek(0, true);
  if (action === "select-profile-season") selectProfileSeason(button.dataset.seasonId);
  if (action === "select-loop-analytics") selectAnalyticsLoop(button.dataset.loopId);
  if (action === "start-challenge") startChallenge(button.dataset.challengeId);
  if (action === "drop-challenge") dropChallenge(button.dataset.challengeAttemptId);
});

// loadState is replaced by loadStateFromSupabase (called inside initApp).
// Kept as a stub so nothing breaks if called defensively.
function loadState() { return createEmptyState("_anon"); }

function loadUi() {
  try {
    return normaliseUi(JSON.parse(localStorage.getItem(UI_KEY)) || {});
  } catch {
    return normaliseUi({});
  }
}

function normaliseUi(next) {
  return {
    view: next.view === "challenges" ? "coach" : next.view || "dashboard",
    analyticsHabitId: next.analyticsHabitId || "",
    analyticsLoopId: next.analyticsLoopId || "",
    habitWeekOffset: Number(next.habitWeekOffset) || 0,
    profileSeasonId: next.profileSeasonId || "",
    editHabitId: next.editHabitId || "",
    editLoopId: next.editLoopId || "",
    noteFilter: next.noteFilter || "all",
    notesExpanded: Boolean(next.notesExpanded),
    mobileMoreOpen: Boolean(next.mobileMoreOpen),
    flippedMetricId: next.flippedMetricId || "",
  };
}

function normaliseState(next) {
  const seed = createSeedState();
  const seasons = next.seasons?.length ? next.seasons : seed.seasons;
  const primaryUser =
    next.users?.find((candidate) => candidate.id === next.activeUserId && seasons.some((season) => season.userId === candidate.id)) ||
    next.users?.find((candidate) => seasons.some((season) => season.userId === candidate.id)) ||
    seed.users[0];
  return {
    ...seed,
    ...next,
    activeUserId: primaryUser.id,
    users: [primaryUser],
    seasons,
    habits: next.habits || [],
    loops: next.loops || [],
    sessions: next.sessions || [],
    events: next.events || [],
    knowledgeNotes: next.knowledgeNotes || [],
    xpEvents: next.xpEvents || [],
    xpAwards: next.xpAwards || {},
    challengeAttempts: next.challengeAttempts || [],
  };
}

function createSeedState() {
  const userId = uid("user");
  const seasonStart = toISO(addDays(new Date(), -25));
  const previousStart = toISO(addDays(new Date(), -126));
  const seasonId = uid("season");
  const previousSeasonId = uid("season");

  const habits = [
    {
      id: uid("habit"),
      userId,
      seasonId,
      title: "Deep work",
      type: "build",
      weeklyTarget: 5,
      archived: false,
      createdAt: nowIso(),
      logs: buildLogs(seasonStart, [0, 1, 2, 4, 5, 7, 8, 9, 11, 14, 15, 16, 18, 21, 22, 23]),
    },
    {
      id: uid("habit"),
      userId,
      seasonId,
      title: "Evening reading",
      type: "build",
      weeklyTarget: 4,
      archived: false,
      createdAt: nowIso(),
      logs: buildLogs(seasonStart, [0, 2, 3, 5, 8, 9, 13, 15, 18, 20, 22]),
    },
    {
      id: uid("habit"),
      userId,
      seasonId,
      title: "No doomscrolling",
      type: "break",
      weeklyTarget: 6,
      archived: false,
      createdAt: nowIso(),
      logs: buildLogs(seasonStart, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 14, 15, 16, 17, 18, 20, 21, 22, 23]),
    },
  ];

  const loops = [
    {
      id: uid("loop"),
      userId,
      seasonId,
      title: "Morning Prime",
      weeklyTarget: 5,
      archived: false,
      createdAt: nowIso(),
      steps: [
        { id: uid("step"), title: "Water", minutes: 2 },
        { id: uid("step"), title: "Stretch", minutes: 8 },
        { id: uid("step"), title: "Read", minutes: 15, habitId: habits[1].id },
        { id: uid("step"), title: "Journal", minutes: 10 },
      ],
    },
    {
      id: uid("loop"),
      userId,
      seasonId,
      title: "Study Sprint",
      weeklyTarget: 4,
      archived: false,
      createdAt: nowIso(),
      steps: [
        { id: uid("step"), title: "Set intention", minutes: 3 },
        { id: uid("step"), title: "Focused block", minutes: 25, habitId: habits[0].id },
        { id: uid("step"), title: "Review notes", minutes: 7 },
      ],
    },
  ];

  return {
    activeUserId: userId,
    users: [{ id: userId, name: "Malav", email: "malav@example.com", createdAt: nowIso() }],
    seasons: [
      {
        id: seasonId,
        userId,
        name: "Spring discipline",
        startDate: seasonStart,
        endDate: toISO(addDays(parseISO(seasonStart), 83)),
        archived: false,
        createdAt: nowIso(),
      },
      {
        id: previousSeasonId,
        userId,
        name: "Foundation season",
        startDate: previousStart,
        endDate: toISO(addDays(parseISO(previousStart), 83)),
        archived: true,
        createdAt: nowIso(),
      },
    ],
    habits,
    loops,
    sessions: [
      buildSession(userId, seasonId, loops[0], -7, true),
      buildSession(userId, seasonId, loops[0], -5, true),
      buildSession(userId, seasonId, loops[1], -4, false),
      buildSession(userId, seasonId, loops[1], -2, true),
    ],
    events: [
      event(userId, seasonId, "season", "Season started", seasonStart),
      event(userId, seasonId, "habit", "Created Deep work", addDays(parseISO(seasonStart), 0).toISOString()),
      event(userId, seasonId, "loop", "Completed Morning Prime", addDays(new Date(), -7).toISOString()),
    ],
    xpEvents: [],
    xpAwards: {},
    challengeAttempts: [],
    knowledgeNotes: [
      {
        id: uid("note"),
        userId,
        title: "Personal rule",
        body: "A target is useful only when it changes the next action.",
        createdAt: nowIso(),
      },
    ],
  };
}

function buildLogs(startDate, offsets) {
  return offsets.reduce((logs, offset) => {
    const date = toISO(addDays(parseISO(startDate), offset));
    if (parseISO(date) <= startOfToday()) logs[date] = true;
    return logs;
  }, {});
}

function buildSession(userId, seasonId, loop, offsetDays, completed) {
  const started = addDays(new Date(), offsetDays);
  started.setHours(7 + Math.abs(offsetDays), 10, 0, 0);
  const durationSeconds = loop.steps.reduce((sum, step) => sum + step.minutes * 60, 0);
  const ended = new Date(started.getTime() + durationSeconds * 1000);
  return {
    id: uid("session"),
    userId,
    seasonId,
    loopId: loop.id,
    loopTitle: loop.title,
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationSeconds,
    completed,
    steps: loop.steps.map((step) => ({
      title: step.title,
      intendedSeconds: step.minutes * 60,
      actualSeconds: completed ? step.minutes * 60 : Math.round(step.minutes * 38),
      completed,
    })),
  };
}

function event(userId, seasonId, type, label, at = nowIso()) {
  return { id: uid("event"), userId, seasonId, type, label, at };
}

function persist() {
  if (!currentUser || !state) return;
  recomputeXpAchievements();
  // Fire-and-forget — UI updates optimistically; save happens in background.
  _db.from("user_state")
    .upsert({ user_id: currentUser.id, data: state, updated_at: new Date().toISOString() },
            { onConflict: "user_id" })
    .then(({ error }) => { if (error) toast("Save failed — check connection"); });
}

function persistUi() {
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

function render() {
  const app = document.querySelector("#app");

  // Not logged in — show auth screen instead of app
  if (!currentUser || !state) {
    app.innerHTML = renderAuthScreen();
    return;
  }

  const user = activeUser();
  const season = activeSeason();
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <img src="./assets/katheko-logo.png" alt="Kathēkõ mark" />
          <div>
            <h1 class="brand-title">Kathēkõ</h1>
            <p class="brand-subtitle">Appropriate action, Measured well, Guided better</p>
          </div>
        </div>

        <button class="user-panel account-card" data-action="view" data-view="profile">
          <span class="eyebrow">Account</span>
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(user.email || "Local demo account")}</span>
        </button>

        <nav class="nav" aria-label="Primary">
          <div class="desktop-nav">
            ${views
            .map(
              ([key, label]) =>
                `<button class="${ui.view === key ? "active" : ""} ${key === "profile" ? "nav-profile" : ""}" data-action="view" data-view="${key}">${label}</button>`,
            )
            .join("")}
          </div>
          <div class="mobile-nav">
            <button class="${ui.view === "dashboard" ? "active" : ""}" data-action="view" data-view="dashboard" aria-label="Home">Home</button>
            <button class="${ui.view === "analytics" ? "active" : ""}" data-action="view" data-view="analytics" aria-label="Analytics">Analytics</button>
            <button class="nav-plus ${["habits", "loops"].includes(ui.view) ? "active" : ""}" data-action="toggle-mobile-more" aria-label="Open habits and loops">+</button>
            <button class="${ui.view === "coach" ? "active" : ""}" data-action="view" data-view="coach" aria-label="Coach">Coach</button>
            <button class="${ui.view === "profile" ? "active" : ""}" data-action="view" data-view="profile" aria-label="Profile">Profile</button>
          </div>
          ${
            ui.mobileMoreOpen
              ? `<div class="mobile-more-menu"><button data-action="view" data-view="habits">Habits</button><button data-action="view" data-view="loops">Loops</button></div>`
              : ""
          }
        </nav>
      </aside>
      <main class="main">
        ${season ? renderCurrentView(user, season) : renderNoSeason()}
      </main>
    </div>
  `;
}

function renderCurrentView(user, season) {
  if (ui.view === "habits") return renderHabits(user, season);
  if (ui.view === "loops") return renderLoops(user, season);
  if (ui.view === "analytics") return renderAnalytics(user, season);
  if (ui.view === "profile") return renderProfile(user, season);
  if (ui.view === "coach") return renderCoach(user, season);
  return renderDashboard(user, season);
}

function renderNoSeason() {
  return `
    ${pageHeader("Home", "Create a 12-week season to begin.")}
    <section class="panel">
      <form data-form="add-season" class="form-grid compact">
        <div class="field">
          <label for="season-name-empty">Season</label>
          <input id="season-name-empty" name="name" required placeholder="First 12 weeks" />
        </div>
        <div class="field">
          <label for="season-start-empty">Start</label>
          <input id="season-start-empty" name="startDate" type="date" value="${todayISO()}" required />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="primary-btn" type="submit">Start</button>
        </div>
      </form>
    </section>
  `;
}

function pageHeader(title, kicker, actions = "") {
  return `
    <div class="topbar">
      <div>
        <h2 class="page-title">${title}</h2>
        <p class="page-kicker">${kicker}</p>
      </div>
      <div class="toolbar">${actions}</div>
    </div>
  `;
}

function renderDashboard(user, season) {
  const habits = activeHabits(season);
  const loops = activeLoops(season);
  const metrics = seasonMetrics(season);
  const xp = xpSummary(season);
  const todayWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(new Date());
  const todayDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return `
    ${pageHeader("Home", seasonSubtitle(season, metrics))}
    <section class="panel season-progress-panel" style="margin-top: 16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Season completed</h3>
          <p class="panel-note">${seasonProgress(season)}% complete — ${metrics.daysLeft} day${metrics.daysLeft === 1 ? "" : "s"} left in this 12-week season.</p>
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.68rem;font-weight:900;text-transform:uppercase;color:var(--muted);letter-spacing:0.04em;">Today</div>
          <div style="font-family:var(--display-font);font-size:1.25rem;font-weight:900;line-height:1;">${todayWeekday}</div>
          <div style="font-size:0.84rem;font-weight:750;color:var(--muted);margin-top:2px;">${todayDate}</div>
        </div>
      </div>
      <div class="xp-meter"><span style="width:${seasonProgress(season)}%"></span></div>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Season map</h3>
          <p class="panel-note">12 weeks, anchored to the chosen start date.</p>
        </div>
        <span class="chip amber">${formatDate(season.startDate)} - ${formatDate(season.endDate)}</span>
      </div>
      <div class="season-strip">${renderSeasonWeeks(season)}</div>
    </section>
    <section class="grid two" style="margin-top: 16px;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Today's habits</h3>
            <p class="panel-note">${formatDate(todayISO())}</p>
          </div>
          <button class="ghost-btn" data-action="view" data-view="habits">Manage</button>
        </div>
        <div class="habit-list">
          ${
            habits.length
              ? habits
	                  .map((habit) => {
	                    const done = Boolean(habit.logs[todayISO()]);
	                    return `
	                      <div class="row">
	                        <div>
	                          <p class="row-title">${escapeHtml(habit.title)}</p>
	                        </div>
	                        <button class="${done ? "primary-btn" : "quiet-btn"}" data-action="toggle-habit" data-habit-id="${habit.id}" data-date="${todayISO()}">${done ? "Logged" : "Log"}</button>
	                      </div>
	                    `;
                  })
                  .join("")
              : `<div class="empty">Create your first habit.</div>`
          }
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Loops</h3>
            <p class="panel-note">Run a focused session.</p>
          </div>
          <button class="ghost-btn" data-action="view" data-view="loops">Open</button>
        </div>
        <div class="loop-list">
          ${
            loops.length
              ? loops
                  .slice(0, 3)
                  .map(
                    (loop) => `
                      <div class="row">
                        <div>
                          <p class="row-title">${escapeHtml(loop.title)}</p>
                          <p class="row-meta">${loop.steps.length} steps · ${formatDuration(loopDuration(loop))} · ${loop.weeklyTarget}x/week</p>
                        </div>
                        <button class="primary-btn" data-action="start-loop" data-loop-id="${loop.id}">Start</button>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty">Create a loop.</div>`
          }
        </div>
      </div>
    </section>
    ${runtime.session ? `<section style="margin-top:16px;">${renderSessionStage()}</section>` : ""}
  `;
}

function seasonSubtitle(season, metrics = seasonMetrics(season)) {
  return `${escapeHtml(season.name)} · ${formatDate(season.startDate)} - ${formatDate(season.endDate)} · ${metrics.daysLeft} day${metrics.daysLeft === 1 ? "" : "s"} remain.`;
}

function renderHabits(user, season) {
  const habits = userHabits().filter((habit) => habit.seasonId === season.id);
  const active = habits.filter((habit) => !habit.archived);
  const archived = habits.filter((habit) => habit.archived);
  const currentWeek = currentWeekIndex(season);
  const visibleWeek = clamp(currentWeek + ui.habitWeekOffset, 0, currentWeek);
  const weekStart = addDays(parseISO(season.startDate), visibleWeek * 7);
  const isCurrentWeek = visibleWeek === currentWeek;
  return `
    ${pageHeader(
      "Habits",
      "Build and break behaviours through weekly targets.",
      `<button class="quiet-btn" data-action="view" data-view="analytics">View analytics</button>`,
    )}
    <section class="panel">
      <form data-form="add-habit" class="form-grid">
        <div class="field">
          <label for="habit-title">Habit</label>
          <input id="habit-title" name="title" required placeholder="Reading, gym, no sugar..." />
        </div>
        <div class="field">
          <label for="habit-type">Type</label>
          <select id="habit-type" name="type">
            <option value="build">Build</option>
            <option value="break">Break</option>
          </select>
        </div>
        <div class="field">
          <label for="habit-target">Weekly target</label>
          <input id="habit-target" name="weeklyTarget" type="number" min="1" max="7" value="5" required />
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="primary-btn" type="submit">Add habit</button>
        </div>
      </form>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">${isCurrentWeek ? "Current week" : `Week ${visibleWeek + 1}`}</h3>
          <p class="panel-note">${formatDate(toISO(weekStart))} - ${formatDate(toISO(addDays(weekStart, 6)))}</p>
        </div>
        <div class="week-controls">
          <button class="icon-btn muted" data-action="habit-week-prev" title="Previous week" ${visibleWeek === 0 ? "disabled" : ""}>‹</button>
          <button class="icon-btn muted" data-action="habit-week-next" title="Next week" ${isCurrentWeek ? "disabled" : ""}>›</button>
          ${isCurrentWeek ? "" : `<button class="quiet-btn" data-action="habit-week-current">Current</button>`}
        </div>
      </div>
      <div class="habit-list">
        ${
          active.length
            ? active.map((habit) => renderHabitRow(habit, season, weekStart, visibleWeek)).join("")
            : `<div class="empty">No active habits.</div>`
        }
      </div>
    </section>
    ${renderHabitGridPanel(active, season)}
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Archived</h3>
          <p class="panel-note">Recover old habits or keep them for history.</p>
        </div>
      </div>
      <div class="habit-list">
        ${
          archived.length
            ? archived
                .map(
                  (habit) => `
                    <div class="row">
                      <div>
                        <p class="row-title">${escapeHtml(habit.title)} ${habitTypeChip(habit.type)}</p>
                        <p class="row-meta">Target ${habit.weeklyTarget}/7 · ${completionCount(habit, season)} completions</p>
                      </div>
                      <div class="split">
                        <button class="quiet-btn" data-action="restore-habit" data-habit-id="${habit.id}">Restore</button>
                        <button class="danger-btn" data-action="delete-habit" data-habit-id="${habit.id}">Delete</button>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty">No archived habits.</div>`
        }
      </div>
    </section>
  `;
}

function renderHabitGridPanel(habits, season) {
  const selectedHabit = habits.find((habit) => habit.id === ui.analyticsHabitId) || habits[0];
  if (selectedHabit && ui.analyticsHabitId !== selectedHabit.id) {
    ui.analyticsHabitId = selectedHabit.id;
    persistUi();
  }
  return `
    <section class="panel habit-grid-panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Habit grid</h3>
          <p class="panel-note">84 days, anchored to season start.</p>
        </div>
        <select data-analytics-habit aria-label="Habit grid habit">
          ${habits
            .map(
              (habit) =>
                `<option value="${habit.id}" ${selectedHabit?.id === habit.id ? "selected" : ""}>${escapeHtml(habit.title)}</option>`,
            )
            .join("")}
        </select>
      </div>
      ${
        selectedHabit
          ? `
            <div class="progress-grid">
              ${range(84)
                .map((offset) => {
                  const date = toISO(addDays(parseISO(season.startDate), offset));
                  const done = Boolean(selectedHabit.logs[date]);
                  const future = parseISO(date) > startOfToday();
                  const missed = !done && !future;
                  return `<button class="progress-cell ${done ? "done" : ""} ${future ? "future" : ""} ${missed ? "missed" : ""} ${date === todayISO() ? "today" : ""}" data-action="toggle-habit" data-habit-id="${selectedHabit.id}" data-date="${date}" title="${formatDate(date)}">${parseISO(date).getDate()}</button>`;
                })
                .join("")}
            </div>
          `
          : `<div class="empty">No active habits.</div>`
      }
    </section>
  `;
}

function renderHabitRow(habit, season, weekStart, visibleWeek = currentWeekIndex(season)) {
  if (ui.editHabitId === habit.id) return renderHabitEditRow(habit);
  return `
    <div class="row">
      <div>
        ${habitStatusLine(habit, season, visibleWeek)}
        <div class="week-toggles">
          ${range(7)
            .map((offset) => {
              const date = toISO(addDays(weekStart, offset));
              const done = Boolean(habit.logs[date]);
              return `
                <button class="day-toggle ${done ? "done" : ""} ${date === todayISO() ? "today" : ""}" data-action="toggle-habit" data-habit-id="${habit.id}" data-date="${date}">
                  <small>${weekday(date)}</small>
                  <span>${parseISO(date).getDate()}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
      <div class="split">
        <button class="quiet-btn" data-action="edit-habit" data-habit-id="${habit.id}">Edit</button>
        <button class="quiet-btn" data-action="archive-habit" data-habit-id="${habit.id}">Archive</button>
      </div>
    </div>
  `;
}

function renderHabitEditRow(habit) {
  return `
    <form class="row edit-row" data-form="edit-habit">
      <input type="hidden" name="habitId" value="${escapeAttr(habit.id)}" />
      <div class="edit-grid habit-edit-grid">
        <div class="field">
          <label for="edit-habit-title-${habit.id}">Habit</label>
          <input id="edit-habit-title-${habit.id}" name="title" value="${escapeAttr(habit.title)}" required />
        </div>
        <div class="field">
          <label for="edit-habit-type-${habit.id}">Type</label>
          <select id="edit-habit-type-${habit.id}" name="type">
            <option value="build" ${habit.type === "build" ? "selected" : ""}>Build</option>
            <option value="break" ${habit.type === "break" ? "selected" : ""}>Break</option>
          </select>
        </div>
        <div class="field">
          <label for="edit-habit-target-${habit.id}">Weekly target</label>
          <input id="edit-habit-target-${habit.id}" name="weeklyTarget" type="number" min="1" max="7" value="${habit.weeklyTarget}" required />
        </div>
      </div>
      <div class="split">
        <button class="primary-btn" type="submit">Save</button>
        <button class="quiet-btn" type="button" data-action="cancel-edit-habit">Cancel</button>
      </div>
    </form>
  `;
}

function habitStatusLine(habit, season, visibleWeek = currentWeekIndex(season)) {
  const count = weekCount(habit, season, visibleWeek);
  const targetMet = count >= habit.weeklyTarget;
  const rate = habitRate(habit, season);
  const streak = weeklyStreak(habit, season);
  return `
    <p class="row-title habit-status-line">
      <span class="habit-name">${escapeHtml(habit.title)}</span>
      ${habitTypeChip(habit.type)}
      <span class="chip target ${targetMet ? "met" : "missed"}">${count}/${habit.weeklyTarget}</span>
      <span class="chip blue">${rate}%</span>
      <span class="chip streak">${streak} week${streak === 1 ? "" : "s"}</span>
    </p>
  `;
}

function renderLoops(user, season) {
  const loops = userLoops().filter((loop) => loop.seasonId === season.id);
  const active = loops.filter((loop) => !loop.archived);
  const archived = loops.filter((loop) => loop.archived);
  const habits = activeHabits(season);
  return `
    ${pageHeader("Loops", "Ordered routines that become focused sessions.")}
    ${runtime.session ? renderSessionStage() : ""}
    <section class="grid two" style="${runtime.session ? "margin-top:16px;" : ""}">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Create loop</h3>
            <p class="panel-note">Add steps with durations in minutes.</p>
          </div>
          <button class="ghost-btn" data-action="new-step-row" data-step-target="step-editor-create" type="button">Add step</button>
        </div>
        <form data-form="add-loop">
          <div class="form-grid compact">
            <div class="field">
              <label for="loop-title">Loop</label>
              <input id="loop-title" name="title" required placeholder="Morning Routine" />
            </div>
            <div class="field">
              <label for="loop-target">Weekly target</label>
              <input id="loop-target" name="weeklyTarget" type="number" min="1" max="7" value="3" required />
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <button class="primary-btn" type="submit">Save loop</button>
            </div>
          </div>
          <div class="step-editor" id="step-editor-create">
            ${stepEditorRow("Sample step", 5)}
          </div>
          <datalist id="habit-step-options">
            ${habits.map((habit) => `<option value="${escapeAttr(habit.title)}">${escapeHtml(habit.type === "break" ? "Break habit" : "Build habit")}</option>`).join("")}
          </datalist>
        </form>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Saved loops</h3>
            <p class="panel-note">${active.length} active routine${active.length === 1 ? "" : "s"}.</p>
          </div>
        </div>
        <div class="loop-list">
          ${
            active.length
              ? active
                  .map((loop) => renderLoopRow(loop, season, habits))
                  .join("")
              : `<div class="empty">No loops yet.</div>`
          }
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Archived</h3>
          <p class="panel-note">Restore old loops or delete the ones you no longer need.</p>
        </div>
      </div>
      <div class="loop-list">
        ${
          archived.length
            ? archived
                .map(
                  (loop) => `
                    <div class="row loop-row">
                      <div>
                        <p class="row-title">${escapeHtml(loop.title)} <span class="chip blue">${loop.steps.length} steps</span></p>
                        <p class="row-meta">${formatDuration(loopDuration(loop))} · ${loop.weeklyTarget}x/week · ${loopCompletionText(loop, season)}</p>
                      </div>
                      <div class="split loop-actions">
                        <button class="quiet-btn" data-action="restore-loop" data-loop-id="${loop.id}">Restore</button>
                        <button class="danger-btn" data-action="delete-loop" data-loop-id="${loop.id}">Delete</button>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty">No archived loops.</div>`
        }
      </div>
    </section>
  `;
}

function renderLoopRow(loop, season, habits) {
  if (ui.editLoopId === loop.id) return renderLoopEditRow(loop, habits);
  return `
    <div class="row loop-row">
      <div>
        <p class="row-title">${escapeHtml(loop.title)} <span class="chip blue">${loop.steps.length} steps</span></p>
        <p class="row-meta">${formatDuration(loopDuration(loop))} · ${loop.weeklyTarget}x/week · ${loopCompletionText(loop, season)}</p>
      </div>
      <div class="split loop-actions">
        <button class="primary-btn" data-action="start-loop" data-loop-id="${loop.id}">Start</button>
        <button class="quiet-btn" data-action="edit-loop" data-loop-id="${loop.id}">Edit</button>
        <button class="quiet-btn" data-action="remove-loop" data-loop-id="${loop.id}">Archive</button>
      </div>
    </div>
  `;
}

function renderLoopEditRow(loop, habits) {
  const editorId = `step-editor-${loop.id}`;
  return `
    <form class="row edit-row loop-edit-row" data-form="edit-loop">
      <input type="hidden" name="loopId" value="${escapeAttr(loop.id)}" />
      <div class="loop-edit-body">
        <div class="edit-grid loop-edit-grid">
          <div class="field">
            <label for="edit-loop-title-${loop.id}">Loop</label>
            <input id="edit-loop-title-${loop.id}" name="title" value="${escapeAttr(loop.title)}" required />
          </div>
          <div class="field">
            <label for="edit-loop-target-${loop.id}">Weekly target</label>
            <input id="edit-loop-target-${loop.id}" name="weeklyTarget" type="number" min="1" max="7" value="${loop.weeklyTarget}" required />
          </div>
        </div>
        <div class="step-editor" id="${editorId}">
          ${loop.steps.map((step) => stepEditorRow(step.title, step.minutes)).join("")}
        </div>
        <datalist id="habit-step-options-${loop.id}">
          ${habits.map((habit) => `<option value="${escapeAttr(habit.title)}">${escapeHtml(habit.type === "break" ? "Break habit" : "Build habit")}</option>`).join("")}
        </datalist>
      </div>
      <div class="split">
        <button class="primary-btn" type="submit">Save</button>
        <button class="quiet-btn" type="button" data-action="new-step-row" data-step-target="${editorId}">Add step</button>
        <button class="quiet-btn" type="button" data-action="cancel-edit-loop">Cancel</button>
      </div>
    </form>
  `;
}

function stepEditorRow(title = "", minutes = 5) {
  return `
    <div class="step-row" data-step-row>
      <div class="field">
        <input name="stepTitle" value="${escapeAttr(title)}" placeholder="Step name or existing habit" list="habit-step-options" required />
      </div>
      <div class="field">
        <input name="stepMinutes" value="${minutes}" type="number" min="1" max="180" required />
      </div>
      <button class="quiet-btn" type="button" data-action="remove-step-row">Remove</button>
    </div>
  `;
}

function renderSessionStage() {
  const session = runtime.session;
  const step = session.loop.steps[session.stepIndex];
  const isLastStep = session.stepIndex === session.loop.steps.length - 1;
  const discardAvailable = (new Date() - session.startedAt) / 1000 <= 60;
  const total = Math.max(step.minutes * 60, 1);
  const elapsed = Math.max(0, total - session.remaining);
  const progress = Math.min(100, Math.round((elapsed / total) * 100));
  return `
    <section class="session-stage">
      <span class="chip amber">Session ${session.stepIndex + 1}/${session.loop.steps.length}</span>
      <h3 class="session-step">${escapeHtml(step.title)}</h3>
      <div class="timer">${formatClock(session.remaining)}</div>
      <div class="session-progress"><span style="width:${progress}%"></span></div>
      <p class="panel-note" style="color: rgb(255 255 255 / 0.70);">Next: ${escapeHtml(session.loop.steps[session.stepIndex + 1]?.title || "Complete")}</p>
      <div class="split">
        ${
          session.running
            ? `<button class="quiet-btn" data-action="pause-session">Pause</button>`
            : `<button class="primary-btn" data-action="resume-session">Resume</button>`
        }
        <button class="ghost-btn" data-action="next-step">${isLastStep ? "Complete" : "Next step"}</button>
        <button class="danger-btn" data-action="abandon-session">Abandon</button>
        ${discardAvailable ? `<button class="icon-btn danger-icon" data-action="discard-session" title="Discard accidental start">🗑</button>` : ""}
      </div>
    </section>
  `;
}

function renderAnalytics(user, season) {
  const habits = activeHabits(season);
  const loops = activeLoops(season);
  const xp = xpSummary(season);
  const insight = coachInsight(season);
  const selectedLoop = loops.find((loop) => loop.id === ui.analyticsLoopId) || loops[0];
  if (!ui.analyticsLoopId && selectedLoop) ui.analyticsLoopId = selectedLoop.id;
  persistUi();
  const metrics = seasonMetrics(season);
  const bestStreak = longestSeasonStreak(habits, season);
  return `
    ${pageHeader(
      "Analytics",
      "Season performance, habit detail, loop execution, and historical data.",
      `<button class="quiet-btn" data-action="export-csv">Export CSV</button><button class="quiet-btn" data-action="export-json">Export JSON</button>`,
	    )}
		    <section class="grid four">
		      ${metricCard("Habit success", `${metrics.averageHabitRate}%`, "Average weekly-target success across active habits.", "analytics-habit-success")}
		      ${metricCard("Overall performance", `${overallPerformance(season)}%`, `Blended score from season progress, habits, loops, and challenge activity. Band: ${performanceBandLabel(overallPerformance(season))}.`, "analytics-overall-performance")}
		      ${metricCard("Challenge XP gained", `${xp.challenge}`, "XP earned from completed tracked challenge rewards.", "analytics-challenge-xp")}
		      ${metricCard("Best weekly streak", `${bestStreak.weeks}`, `Longest weekly-target streak. Current leader: ${bestStreak.habitTitle}.`, "analytics-best-streak")}
		    </section>
		    <section class="grid four secondary-metrics" style="margin-top:16px;">
		      ${metricCard("Progress engine", `Level ${xp.level}`, `${xp.total} lifetime XP. ${xp.toNext} XP needed to reach level ${xp.level + 1}.`, "dashboard-progress-engine", "blue")}
		      ${metricCard("Lifetime XP", `${xp.total}`, "Total XP earned across all seasons in this account.", "dashboard-lifetime-xp")}
		      ${metricCard("Season XP", `${xp.season}`, "XP earned inside the active 12-week season.", "dashboard-season-xp")}
		      ${metricCard("Weekly target", `${metrics.weeklyScore}%`, "Share of this week's active habit and loop targets completed.", "dashboard-weekly-target")}
		    </section>
		    <section class="insights-grid" style="margin-top:16px;">
      <div class="panel overview-panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Detailed Analysis</h3>
            <p class="panel-note">Generated from current season data.</p>
          </div>
        </div>
        <div class="event-list">
          ${insight.map((line) => `<div class="row"><div><p class="row-title">${escapeHtml(line.title)}</p><p class="row-meta">${escapeHtml(line.body)}</p></div></div>`).join("")}
        </div>
      </div>
	    </section>
    <section class="grid" style="margin-top:16px;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Habit performance</h3>
            <p class="panel-note">Progress against weekly targets and expected logged days.</p>
          </div>
        </div>
        <div class="bar-list">
          ${
            habits.length
              ? habits
                  .map((habit) => {
                    const rate = habitRate(habit, season);
                    const overall = habitOverallPerformance(habit, season);
                    const streak = weeklyStreak(habit, season);
                    return `
                      <div class="habit-performance-item">
                        <div class="bar-row">
                          <span class="bar-label">${escapeHtml(habit.title)}</span>
                          <span class="bar-subheading">Weekly target</span>
                          <span class="bar-track"><span class="bar-fill" style="width:${rate}%"></span></span>
                          <span class="bar-value">${rate}% · ${streak}w</span>
                        </div>
                        <div class="bar-row secondary">
                          <span class="bar-label">Overall</span>
                          <span class="bar-track"><span class="bar-fill overall" style="width:${overall}%"></span></span>
                          <span class="bar-value">${overall}%</span>
                        </div>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty">No habit data.</div>`
          }
        </div>
      </div>
    </section>
    <section class="grid two" style="margin-top:16px;">
      <div class="panel flush">
        <table class="table">
          <thead>
            <tr>
              <th>Loop</th>
              <th>Runs</th>
              <th>Completed</th>
              <th>Broken</th>
              <th>Success</th>
            </tr>
          </thead>
          <tbody>
            ${
              loops.length
                ? loops
                    .map((loop) => {
                      const stats = loopStats(loop, season);
                      return `
                        <tr>
                          <td><button class="table-link ${selectedLoop?.id === loop.id ? "active" : ""}" data-action="select-loop-analytics" data-loop-id="${loop.id}">${escapeHtml(loop.title)}</button></td>
                          <td>${stats.runs}</td>
                          <td>${stats.completed}</td>
                          <td>${stats.broken}</td>
                          <td>${stats.successRate}%</td>
                        </tr>
                      `;
                    })
                    .join("")
                : `<tr><td colspan="5">No loops recorded.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      <div class="panel flush">
        <table class="table">
          <thead>
            <tr>
              <th>${selectedLoop ? escapeHtml(selectedLoop.title) : "Loop"} history</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${
              selectedLoop
                ? loopSessions(selectedLoop, season)
                    .map(
                      (session) => `
                        <tr>
                          <td>${formatDateTime(session.startedAt)}</td>
                          <td>${formatDuration(Math.round(session.durationSeconds / 60))}</td>
                          <td>${session.completed ? `<span class="chip">Completed</span>` : `<span class="chip coral">Broken</span>`}</td>
                        </tr>
                      `,
                    )
                    .join("") || `<tr><td colspan="3">No runs for this loop yet.</td></tr>`
                : `<tr><td colspan="3">Select a loop to inspect its run history.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderChallenges(user, season) {
  const xp = xpSummary(season);
  const suggestions = challengeSuggestions(season);
  const recovery = suggestions.filter((challenge) => challenge.category === "recovery");
  const bonus = suggestions.filter((challenge) => challenge.category === "bonus");
  const performance = overallPerformance(season);
  const attempts = userChallengeAttempts()
    .filter((attempt) => attempt.seasonId === season.id)
    .sort((a, b) => parseISO(b.updatedAt || b.startedAt) - parseISO(a.updatedAt || a.startedAt));
  const active = attempts.filter((attempt) => attempt.status === "active");
  const finished = attempts.filter((attempt) => ["completed", "dropped", "expired"].includes(attempt.status));
  return `
    ${pageHeader(
      "Challenges",
      "Recovery and bonus quests based on the current season.",
      `<button class="quiet-btn" data-action="view" data-view="coach">Open Coach</button>`,
    )}
    <section class="grid two">
      ${metricCard("Performance", `${performance}%`, performanceBandLabel(performance))}
      ${metricCard("Challenge XP gained", `${xp.challenge}`, "Completed challenge rewards")}
    </section>
    <section class="grid two" style="margin-top:16px;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Recovery</h3>
            <p class="panel-note">Unlocked when targets slip or inactive days build up.</p>
          </div>
        </div>
        <div class="challenge-list">
          ${recovery.length ? recovery.map(renderChallengeSuggestion).join("") : `<div class="empty">No recovery challenges right now.</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Bonus</h3>
            <p class="panel-note">Unlocked only when performance rises above the neutral band.</p>
          </div>
        </div>
        <div class="challenge-list">
          ${bonus.length ? bonus.map(renderChallengeSuggestion).join("") : `<div class="empty">No bonus challenges right now.</div>`}
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Active challenges</h3>
          <p class="panel-note">${active.length} tracked objective${active.length === 1 ? "" : "s"} in progress.</p>
        </div>
      </div>
      <div class="challenge-list">
        ${active.length ? active.map(renderChallengeAttempt).join("") : `<div class="empty">Start a quest when you want an extra push.</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">History</h3>
          <p class="panel-note">${finished.length} completed, dropped, or expired challenge${finished.length === 1 ? "" : "s"}.</p>
        </div>
      </div>
      <div class="challenge-list">
        ${finished.length ? finished.map(renderChallengeAttempt).join("") : `<div class="empty">Completed challenges appear here with proof.</div>`}
      </div>
    </section>
  `;
}

function renderChallengeSuggestion(challenge) {
  return `
    <div class="challenge-card">
      <div>
        <p class="row-title">
          <span class="challenge-title">${escapeHtml(challenge.title)}</span>
          <span class="chip ${challenge.category === "recovery" ? "coral" : "blue"}">${titleCase(challenge.category)}</span>
          <span class="chip amber">${escapeHtml(challenge.difficulty)}</span>
        </p>
        <p class="row-meta">${escapeHtml(challenge.description)}</p>
        <p class="row-meta">${escapeHtml(challenge.reason)} · ${challenge.xp} XP</p>
      </div>
      <button class="primary-btn" data-action="start-challenge" data-challenge-id="${escapeAttr(challenge.id)}">Start</button>
    </div>
  `;
}

function renderChallengeAttempt(attempt) {
  const progress = attempt.progress || { value: 0, target: 1 };
  const percent = challengeProgressPercent(progress);
  return `
    <div class="challenge-card">
      <div>
        <p class="row-title">
          <span class="challenge-title">${escapeHtml(attempt.title)}</span>
          <span class="chip ${attempt.category === "recovery" ? "coral" : "blue"}">${titleCase(attempt.status)}</span>
          <span class="chip amber">${attempt.xp} XP</span>
        </p>
        <p class="row-meta">${escapeHtml(attempt.description)}</p>
        <p class="row-meta">${escapeHtml(challengeProgressText(progress))}</p>
        <div class="challenge-progress"><span style="width:${percent}%"></span></div>
        ${attempt.evidence ? `<p class="row-meta">${escapeHtml(attempt.evidence)}</p>` : ""}
      </div>
      ${
        attempt.status === "active"
          ? `<button class="quiet-btn" data-action="drop-challenge" data-challenge-attempt-id="${attempt.id}">Drop</button>`
          : `<span class="chip neutral">${formatDateTime(attempt.completedAt || attempt.droppedAt || attempt.expiredAt || attempt.updatedAt)}</span>`
      }
    </div>
  `;
}

function renderProfile(user, season) {
  const seasons = userSeasons();
  const selectedSeason = ui.profileSeasonId ? seasons.find((item) => item.id === ui.profileSeasonId) : null;
  const summary = selectedSeason ? seasonSummary(selectedSeason) : null;
  const challengeHistory = userChallengeAttempts()
    .filter((attempt) => ["completed", "dropped", "expired"].includes(attempt.status))
    .sort((a, b) => parseISO(b.updatedAt || b.completedAt || b.startedAt) - parseISO(a.updatedAt || a.completedAt || a.startedAt));
  const xp = xpSummary(season);
  return `
    ${pageHeader(
      "Profile",
      "Account, seasons, and exportable data.",
      `<button class="quiet-btn" data-action="enable-notifications">Enable notifications</button><button class="quiet-btn" data-action="export-knowledge">Export knowledge base</button><button class="quiet-btn" data-action="export-csv">Export CSV</button><button class="quiet-btn" data-action="export-json">Export JSON</button>`,
    )}
    <section class="grid two">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Account</h3>
            <p class="panel-note">This web app is scoped to one signed-in account.</p>
          </div>
        </div>
        <div class="row">
          <div>
            <p class="row-title">${escapeHtml(user.name)}</p>
            <p class="row-meta">${escapeHtml(user.email || "Local demo account")}</p>
          </div>
        </div>
        <div class="summary-grid profile-xp-grid">
          ${summaryStat("Level", `${xp.level}`)}
          ${summaryStat("Lifetime XP", `${xp.total}`)}
          ${summaryStat("Season XP", `${xp.season}`)}
          ${summaryStat("Next level", `${xp.toNext} XP`)}
        </div>
        <div class="xp-meter"><span style="width:${xp.nextProgress}%"></span></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Create season</h3>
            <p class="panel-note">Each season runs for 84 days.</p>
          </div>
        </div>
        <form data-form="add-season" class="form-grid stacked">
          <div class="field">
            <label for="season-name">Season</label>
            <input id="season-name" name="name" required placeholder="Next 12 weeks" />
          </div>
          <div class="date-submit-row">
            <div class="field">
              <label for="season-start">Start date</label>
              <input id="season-start" name="startDate" type="date" value="${todayISO()}" required />
            </div>
            <button class="primary-btn" type="submit">Start</button>
          </div>
        </form>
      </div>
    </section>
    <section class="grid ${summary ? "two" : ""}" style="margin-top:16px;">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Seasons</h3>
            <p class="panel-note">${seasons.length} recorded season${seasons.length === 1 ? "" : "s"}.</p>
          </div>
        </div>
        <div class="event-list">
          ${seasons
            .map(
              (item) => `
              <div class="row">
                <div>
                  <p class="row-title">${escapeHtml(item.name)} ${item.id === season.id ? `<span class="chip">Active</span>` : `<span class="chip amber">Archived</span>`}</p>
                  <p class="row-meta">${formatDate(item.startDate)} - ${formatDate(item.endDate)}</p>
                </div>
                <button class="quiet-btn" data-action="select-profile-season" data-season-id="${item.id}">${selectedSeason?.id === item.id ? "Close" : "Open"}</button>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>
      ${
        summary
          ? `
            <div class="panel">
              <div class="panel-head">
                <div>
                  <h3 class="panel-title">${escapeHtml(summary.name)}</h3>
                  <p class="panel-note">${formatDate(summary.startDate)} - ${formatDate(summary.endDate)}</p>
                </div>
              </div>
              <div class="summary-grid">
                ${summaryStat("Achievement level", `${summary.achievementLevel}%`)}
                ${summaryStat("Goals achieved", `${summary.goalsAchieved}/${summary.habitsWorkedOn}`)}
                ${summaryStat("Habits worked on", `${summary.habitsWorkedOn}`)}
                ${summaryStat("Loop success", `${summary.loopSuccessRate}%`)}
              </div>
              <div class="event-list compact-list">
                ${summary.habits.length ? summary.habits.map((habit) => `<div class="row"><div><p class="row-title">${escapeHtml(habit.title)} ${habitTypeChip(habit.type)}</p><p class="row-meta">${habit.rate}% success · ${habit.streak} week streak · ${habit.completions} logged days</p></div></div>`).join("") : `<div class="empty">No habits were attached to this season.</div>`}
              </div>
            </div>
          `
          : ""
      }
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Challenge history</h3>
          <p class="panel-note">${challengeHistory.length} completed, dropped, or expired challenge${challengeHistory.length === 1 ? "" : "s"}.</p>
        </div>
      </div>
      <div class="challenge-list">
        ${challengeHistory.length ? challengeHistory.map(renderChallengeAttempt).join("") : `<div class="empty">Completed challenges appear here with proof.</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Data controls</h3>
          <p class="panel-note">Reset account deletes all app data for this signed-in account.</p>
        </div>
        <div class="split">
          <button class="quiet-btn" data-action="sign-out">Log out</button>
          <button class="danger-btn" data-action="reset-demo">Reset account</button>
        </div>
      </div>
    </section>
  `;
}

function renderCoach(user, season) {
  const noteOptions = knowledgeTagOptions(season);
  const filterOptions = knowledgeFilterOptions(season);
  const visibleNotes = filteredNotes(season);
  const allNotesCount = userNotes().length;
  const isAllFilter = ui.noteFilter === "all";
  const shownNotes = isAllFilter && !ui.notesExpanded ? visibleNotes.slice(0, 5) : visibleNotes;
  const suggestions = challengeSuggestions(season);
  const recovery = suggestions.filter((challenge) => challenge.category === "recovery");
  const bonus = suggestions.filter((challenge) => challenge.category === "bonus");
  const activeChallenges = userChallengeAttempts()
    .filter((attempt) => attempt.seasonId === season.id && attempt.status === "active")
    .sort((a, b) => parseISO(b.updatedAt || b.startedAt) - parseISO(a.updatedAt || a.startedAt));
  return `
    ${pageHeader("Coach", "Challenges, notes, and reflection capture.")}
    <section class="grid two">
      <div class="panel challenge-panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Recovery challenges</h3>
            <p class="panel-note">Unlocked when targets slip or inactive days build up.</p>
          </div>
        </div>
        <div class="challenge-list">
          ${recovery.length ? recovery.map(renderChallengeSuggestion).join("") : `<div class="empty">No recovery challenges right now.</div>`}
        </div>
      </div>
      <div class="panel challenge-panel">
        <div class="panel-head">
          <div>
            <h3 class="panel-title">Bonus challenges</h3>
            <p class="panel-note">Unlocked only when performance rises above the neutral band.</p>
          </div>
        </div>
        <div class="challenge-list">
          ${bonus.length ? bonus.map(renderChallengeSuggestion).join("") : `<div class="empty">No bonus challenges right now.</div>`}
        </div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Active challenges</h3>
          <p class="panel-note">${activeChallenges.length} tracked objective${activeChallenges.length === 1 ? "" : "s"} in progress.</p>
        </div>
      </div>
      <div class="challenge-list">
        ${activeChallenges.length ? activeChallenges.map(renderChallengeAttempt).join("") : `<div class="empty">Start a quest when you want an extra push.</div>`}
      </div>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Knowledge Base</h3>
          <p class="panel-note">Personal rules, frameworks, and reminders.</p>
        </div>
      </div>
      <form data-form="add-note" class="grid">
        <div class="field">
          <label for="note-title">Title</label>
          <input id="note-title" name="title" required placeholder="Weekly review rule" />
        </div>
        <div class="field">
          <label for="note-tag">Journal</label>
          <select id="note-tag" name="tagKey">
            ${noteOptions
              .map((option) => `<option value="${escapeAttr(option.key)}">${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="note-body">Note</label>
          <textarea id="note-body" name="body" required placeholder="Write a principle, reflection, or decision..."></textarea>
        </div>
        <button class="primary-btn" type="submit">Save note</button>
      </form>
    </section>
    <section class="panel" style="margin-top:16px;">
      <div class="panel-head">
        <div>
          <h3 class="panel-title">Reflections</h3>
          <p class="panel-note">${allNotesCount} knowledge item${allNotesCount === 1 ? "" : "s"}.</p>
        </div>
        <div class="note-tools">
          <select data-note-filter aria-label="Knowledge note filter">
            ${filterOptions
              .map((option) => `<option value="${escapeAttr(option.key)}" ${ui.noteFilter === option.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
              .join("")}
          </select>
          ${isAllFilter && visibleNotes.length > 5 ? `<button class="quiet-btn" data-action="toggle-notes-expanded">${ui.notesExpanded ? "Show latest 5" : "Show all"}</button>` : ""}
        </div>
      </div>
      <div class="event-list">
        ${
          shownNotes.length
            ? shownNotes
                .map(
                  (note) => `
                    <div class="row">
                      <div>
                        <p class="row-title">${escapeHtml(note.title)} <span class="chip blue">${escapeHtml(noteTagLabel(note))}</span></p>
                        <p class="row-meta">${escapeHtml(note.body)}</p>
                        <p class="row-meta">${formatDateTime(note.createdAt)}</p>
                      </div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty">No notes yet.</div>`
        }
      </div>
    </section>
  `;
}

function metricCard(label, value, detail = "", metricId = slug(label), tone = "") {
  const flipped = ui.flippedMetricId === metricId;
  return `
    <div class="panel metric ${tone ? `metric-${tone}` : ""} ${flipped ? "flipped" : ""}" data-action="flip-metric" data-metric-id="${escapeAttr(metricId)}" role="button" tabindex="0">
      <div class="metric-face metric-front">
        <span class="metric-label">${escapeHtml(label)}</span>
        <div class="metric-value">${escapeHtml(value)}</div>
      </div>
      <div class="metric-face metric-back">
        <span class="metric-label">${escapeHtml(label)}</span>
        <p class="metric-detail">${escapeHtml(detail || "Measured from current season data.")}</p>
      </div>
    </div>
  `;
}

function summaryStat(label, value) {
  return `
    <div class="summary-stat">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderSeasonWeeks(season) {
  const current = currentWeekIndex(season);
  return range(12)
    .map((week) => {
      const start = addDays(parseISO(season.startDate), week * 7);
      const status = week < current ? "done" : week === current ? "current" : "future";
      return `
        <div class="season-week ${status}">
          <strong>Week ${week + 1}</strong>
          <span>${formatDate(toISO(start))}</span>
        </div>
      `;
    })
    .join("");
}

function addSeason(data) {
  const user = activeUser();
  const name = String(data.name || "").trim();
  const startDate = data.startDate || todayISO();
  if (!name) return;
  state.seasons
    .filter((season) => season.userId === user.id)
    .forEach((season) => {
      season.archived = true;
    });
  const season = {
    id: uid("season"),
    userId: user.id,
    name,
    startDate,
    endDate: toISO(addDays(parseISO(startDate), 83)),
    archived: false,
    createdAt: nowIso(),
  };
  state.seasons.push(season);
  state.events.push(event(user.id, season.id, "season", `Started ${name}`, nowIso()));
  evaluateAllActiveChallenges();
  persist();
  toast("Season started.");
  render();
}

function addHabit(data) {
  const season = activeSeason();
  const title = String(data.title || "").trim();
  if (!title || !season) return;
  const habit = {
    id: uid("habit"),
    userId: state.activeUserId,
    seasonId: season.id,
    title,
    type: data.type === "break" ? "break" : "build",
    weeklyTarget: clamp(Number(data.weeklyTarget) || 1, 1, 7),
    archived: false,
    createdAt: nowIso(),
    logs: {},
  };
  state.habits.push(habit);
  state.events.push(event(state.activeUserId, season.id, "habit", `Created ${title}`, nowIso()));
  persist();
  toast("Habit added.");
  render();
}

function updateHabit(data) {
  const habit = state.habits.find((item) => item.id === data.habitId && item.userId === state.activeUserId);
  const title = String(data.title || "").trim();
  if (!habit || !title) return;
  const previous = { title: habit.title, type: habit.type, weeklyTarget: habit.weeklyTarget };
  habit.title = title;
  habit.type = data.type === "break" ? "break" : "build";
  habit.weeklyTarget = clamp(Number(data.weeklyTarget) || 1, 1, 7);
  if (previous.title !== habit.title || previous.type !== habit.type || previous.weeklyTarget !== habit.weeklyTarget) {
    state.events.push(event(habit.userId, habit.seasonId, "habit", `Updated ${habit.title}`, nowIso()));
  }
  ui.editHabitId = "";
  persist();
  persistUi();
  toast("Habit updated.");
  render();
}

function toggleHabitLog(habitId, date) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) return;
  habit.logs[date] ? delete habit.logs[date] : (habit.logs[date] = true);
  state.events.push(
    event(
      habit.userId,
      habit.seasonId,
      "habit",
      `${habit.logs[date] ? "Logged" : "Removed"} ${habit.title}`,
      `${date}T12:00:00.000Z`,
    ),
  );
  evaluateAllActiveChallenges();
  persist();
  render();
}

function archiveHabit(habitId, archived) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) return;
  habit.archived = archived;
  state.events.push(event(habit.userId, habit.seasonId, "habit", `${archived ? "Archived" : "Restored"} ${habit.title}`, nowIso()));
  persist();
  toast(archived ? "Habit archived." : "Habit restored.");
  render();
}

function deleteHabit(habitId) {
  const habit = state.habits.find((item) => item.id === habitId && item.userId === state.activeUserId);
  if (!habit) return;
  if (!habit.archived) {
    toast("Archive the habit before deleting it.");
    return;
  }
  if (!confirm(`Delete "${habit.title}" permanently? This removes its habit log and cannot be undone.`)) return;
  state.habits = state.habits.filter((item) => item.id !== habit.id);
  state.challengeAttempts = (state.challengeAttempts || []).filter((attempt) => attempt.objective?.habitId !== habit.id);
  state.events.push(event(habit.userId, habit.seasonId, "habit", `Deleted ${habit.title}`, nowIso()));
  evaluateAllActiveChallenges();
  persist();
  toast("Habit deleted.");
  render();
}

function addLoop(data, form) {
  const season = activeSeason();
  const title = String(data.title || "").trim();
  if (!title || !season) return;
  const steps = readLoopSteps(form, season);
  if (!steps.length) {
    toast("Add at least one step.");
    return;
  }
  const loop = {
    id: uid("loop"),
    userId: state.activeUserId,
    seasonId: season.id,
    title,
    weeklyTarget: clamp(Number(data.weeklyTarget) || 1, 1, 7),
    archived: false,
    createdAt: nowIso(),
    steps,
  };
  state.loops.push(loop);
  state.events.push(event(state.activeUserId, season.id, "loop", `Created ${title}`, nowIso()));
  persist();
  toast("Loop saved.");
  render();
}

function updateLoop(data, form) {
  const loop = state.loops.find((item) => item.id === data.loopId && item.userId === state.activeUserId);
  const season = loop ? state.seasons.find((item) => item.id === loop.seasonId) : null;
  const title = String(data.title || "").trim();
  if (!loop || !season || !title) return;
  const steps = readLoopSteps(form, season);
  if (!steps.length) {
    toast("Add at least one step.");
    return;
  }
  loop.title = title;
  loop.weeklyTarget = clamp(Number(data.weeklyTarget) || 1, 1, 7);
  loop.steps = steps;
  state.events.push(event(loop.userId, loop.seasonId, "loop", `Updated ${loop.title}`, nowIso()));
  ui.editLoopId = "";
  evaluateAllActiveChallenges();
  persist();
  persistUi();
  toast("Loop updated.");
  render();
}

function readLoopSteps(form, season) {
  const habits = activeHabits(season);
  return [...form.querySelectorAll("[data-step-row]")]
    .map((row) => {
      const stepTitle = row.querySelector('[name="stepTitle"]')?.value.trim();
      const minutes = Number(row.querySelector('[name="stepMinutes"]')?.value || 0);
      if (!stepTitle || !minutes) return null;
      const linkedHabit = habits.find((habit) => habit.title.toLowerCase() === stepTitle.toLowerCase());
      return {
        id: uid("step"),
        title: stepTitle,
        minutes: clamp(minutes, 1, 180),
        ...(linkedHabit ? { habitId: linkedHabit.id } : {}),
      };
    })
    .filter(Boolean);
}

function archiveLoop(loopId, archived = true) {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop) return;
  loop.archived = archived;
  state.events.push(event(loop.userId, loop.seasonId, "loop", `${archived ? "Archived" : "Restored"} ${loop.title}`, nowIso()));
  persist();
  toast(archived ? "Loop archived." : "Loop restored.");
  render();
}

function deleteLoop(loopId) {
  const loop = state.loops.find((item) => item.id === loopId && item.userId === state.activeUserId);
  if (!loop) return;
  if (!loop.archived) {
    toast("Archive the loop before deleting it.");
    return;
  }
  if (!confirm(`Delete "${loop.title}" permanently? This removes its loop sessions and cannot be undone.`)) return;
  state.loops = state.loops.filter((item) => item.id !== loop.id);
  state.sessions = state.sessions.filter((session) => session.loopId !== loop.id);
  state.challengeAttempts = (state.challengeAttempts || []).filter((attempt) => attempt.objective?.loopId !== loop.id);
  state.events.push(event(loop.userId, loop.seasonId, "loop", `Deleted ${loop.title}`, nowIso()));
  evaluateAllActiveChallenges();
  persist();
  toast("Loop deleted.");
  render();
}

function addStepEditorRow(targetId = "step-editor-create") {
  const safeId = targetId || "step-editor-create";
  document.getElementById(safeId)?.insertAdjacentHTML("beforeend", stepEditorRow("New step", 5));
}

function startSession(loopId) {
  const loop = state.loops.find((item) => item.id === loopId);
  if (!loop || !loop.steps.length) return;
  if (runtime.ticker) clearInterval(runtime.ticker);
  runtime.session = {
    id: uid("live"),
    loop,
    stepIndex: 0,
    remaining: loop.steps[0].minutes * 60,
    running: true,
    startedAt: new Date(),
    stepStartedAt: new Date(),
    runSteps: [],
    beeped: new Set(),
  };
  sendNotification("Kathēkõ session started", `${loop.title}: ${loop.steps[0].title}`);
  notifyCountdown(true);
  runtime.ticker = setInterval(tickSession, 1000);
  toast("Session started.");
  render();
}

function tickSession() {
  const session = runtime.session;
  if (!session || !session.running) return;
  session.remaining -= 1;

  if (session.remaining > 0 && session.remaining <= 10 && !session.beeped.has(session.remaining)) {
    session.beeped.add(session.remaining);
    playBeep();
    notifyCountdown(true);
  } else if (session.remaining > 0 && session.remaining % 10 === 0) {
    notifyCountdown(false);
  }

  if (session.remaining <= 0) {
    finishStep();
    return;
  }

  render();
}

function pauseSession() {
  if (!runtime.session) return;
  runtime.session.running = false;
  toast("Session paused.");
  render();
}

function resumeSession() {
  if (!runtime.session) return;
  runtime.session.running = true;
  toast("Session resumed.");
  render();
}

function finishStep() {
  const session = runtime.session;
  if (!session) return;
  const step = session.loop.steps[session.stepIndex];
  const intended = step.minutes * 60;
  session.runSteps.push({
    title: step.title,
    intendedSeconds: intended,
    actualSeconds: clamp(intended - session.remaining, 0, intended),
    completed: true,
  });
  playBuzzer();
  session.stepIndex += 1;
  const next = session.loop.steps[session.stepIndex];
  if (!next) {
    completeSession(true);
    return;
  }
  session.remaining = next.minutes * 60;
  session.stepStartedAt = new Date();
  session.beeped = new Set();
  sendNotification("Next Kathēkõ step", next.title);
  notifyCountdown(true);
  render();
}

function completeSession(completed) {
  const session = runtime.session;
  if (!session) return;
  const season = activeSeason();
  const endedAt = new Date();
  const durationSeconds = Math.max(1, Math.round((endedAt - session.startedAt) / 1000));
  const savedSession = {
    id: uid("session"),
    userId: state.activeUserId,
    seasonId: season.id,
    loopId: session.loop.id,
    loopTitle: session.loop.title,
    startedAt: session.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds,
    completed,
    steps: session.runSteps,
  };
  state.sessions.push(savedSession);
  state.events.push(
    event(state.activeUserId, season.id, "session", `${completed ? "Completed" : "Broke"} ${session.loop.title}`, endedAt.toISOString()),
  );
  evaluateAllActiveChallenges();
  if (runtime.ticker) clearInterval(runtime.ticker);
  runtime.session = null;
  runtime.ticker = null;
  document.title = "Kathēkõ";
  persist();
  sendNotification("Kathēkõ session ended", completed ? "Loop completed." : "Loop abandoned.");
  toast(completed ? "Loop completed." : "Loop abandoned.");
  render();
}

function discardSession() {
  if (!runtime.session) return;
  if ((new Date() - runtime.session.startedAt) / 1000 > 60) return;
  if (runtime.ticker) clearInterval(runtime.ticker);
  runtime.session = null;
  runtime.ticker = null;
  document.title = "Kathēkõ";
  toast("Accidental start discarded.");
  render();
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    toast("Notifications are not available in this browser.");
    return;
  }
  await registerServiceWorker();
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "Notifications enabled." : "Notifications not enabled.");
}

async function sendNotification(title, body, options = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const notificationOptions = {
      body,
      icon: "./assets/katheko-logo.png",
      badge: "./assets/katheko-logo.png",
      ...options,
    };
    const registration = await runtime.serviceWorkerReady;
    if (registration?.showNotification) {
      await registration.showNotification(title, notificationOptions);
      return;
    }
    new Notification(title, notificationOptions);
  } catch {
    // Browser may block page notifications in some contexts.
  }
}

function notifyCountdown(force) {
  const session = runtime.session;
  if (!session) return;
  const step = session.loop.steps[session.stepIndex];
  if (!force && (!("Notification" in window) || Notification.permission !== "granted")) return;
  document.title = `${formatClock(session.remaining)} · ${step.title} · Kathēkõ`;
  sendNotification("Kathēkõ focus", `${step.title} · ${formatClock(session.remaining)} remaining`, {
    tag: "katheko-live-session",
    renotify: false,
    silent: true,
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  if (!runtime.serviceWorkerReady) {
    runtime.serviceWorkerReady = navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return runtime.serviceWorkerReady;
}

function playBeep() {
  const context = audioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.09);
}

function playBuzzer() {
  const context = audioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sawtooth";
  oscillator.frequency.value = 160;
  gain.gain.value = 0.025;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 3);
}

function audioContext() {
  try {
    if (!runtime.audio) runtime.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (runtime.audio.state === "suspended") runtime.audio.resume();
    return runtime.audio;
  } catch {
    return null;
  }
}

function addKnowledgeNote(data) {
  const title = String(data.title || "").trim();
  const body = String(data.body || "").trim();
  const season = activeSeason();
  const tag = resolveKnowledgeTag(data.tagKey, season);
  if (!title || !body) return;
  state.knowledgeNotes.push({
    id: uid("note"),
    userId: state.activeUserId,
    seasonId: tag.seasonId,
    tagType: tag.type,
    tagId: tag.id,
    tagLabel: tag.label,
    title,
    body,
    createdAt: nowIso(),
  });
  evaluateAllActiveChallenges();
  persist();
  toast("Note saved.");
  render();
}

function knowledgeTagOptions(season) {
  if (!season) return [{ key: "season:", label: "Season" }];
  return [
    { key: `season:${season.id}`, label: `Season · ${season.name}` },
    ...activeHabits(season).map((habit) => ({ key: `habit:${habit.id}`, label: `Habit · ${habit.title}` })),
    ...activeLoops(season).map((loop) => ({ key: `loop:${loop.id}`, label: `Loop · ${loop.title}` })),
  ];
}

function knowledgeFilterOptions(season) {
  return [{ key: "all", label: "All notes" }, ...knowledgeTagOptions(season)];
}

function resolveKnowledgeTag(tagKey, season) {
  const [type, id] = String(tagKey || `season:${season?.id || ""}`).split(":");
  if (type === "habit") {
    const habit = userHabits().find((item) => item.id === id);
    if (habit) return { type: "habit", id: habit.id, label: habit.title, seasonId: habit.seasonId };
  }
  if (type === "loop") {
    const loop = userLoops().find((item) => item.id === id);
    if (loop) return { type: "loop", id: loop.id, label: loop.title, seasonId: loop.seasonId };
  }
  if (type === "challenge") {
    const attempt = userChallengeAttempts().find((item) => item.id === id);
    return {
      type: "challenge",
      id: attempt?.id || "",
      label: attempt?.title || "Challenges",
      seasonId: attempt?.seasonId || season?.id || "",
    };
  }
  const selectedSeason = userSeasons().find((item) => item.id === id) || season || userSeasons()[0];
  return {
    type: "season",
    id: selectedSeason?.id || "",
    label: selectedSeason?.name || "Season",
    seasonId: selectedSeason?.id || "",
  };
}

function noteTagKey(note) {
  if (note.tagType && note.tagId) return `${note.tagType}:${note.tagId}`;
  if (note.tagType === "challenge") return "challenge:";
  if (note.seasonId) return `season:${note.seasonId}`;
  return "season:";
}

function noteTagLabel(note) {
  if (note.tagType === "challenge") return note.tagLabel && note.tagLabel !== "Challenges" ? `Challenge · ${note.tagLabel}` : "Challenges";
  if (note.tagLabel) return note.tagType === "season" ? `Season · ${note.tagLabel}` : `${titleCase(note.tagType || "note")} · ${note.tagLabel}`;
  if (note.seasonId) return `Season · ${seasonName(note.seasonId)}`;
  return "General";
}

function filteredNotes(season) {
  const notes = userNotes().sort((a, b) => parseISO(b.createdAt) - parseISO(a.createdAt));
  const available = new Set(knowledgeFilterOptions(season).map((option) => option.key));
  const filter = available.has(ui.noteFilter) ? ui.noteFilter : "all";
  if (filter !== ui.noteFilter) ui.noteFilter = filter;
  if (filter === "all") return notes;
  if (filter === "challenge:") return notes.filter((note) => note.tagType === "challenge");
  return notes.filter((note) => noteTagKey(note) === filter);
}

function toggleNotesExpanded() {
  ui.notesExpanded = !ui.notesExpanded;
  persistUi();
  render();
}

function coachInsight(season) {
  const habits = activeHabits(season);
  const weakest = habits
    .map((habit) => ({ habit, rate: habitRate(habit, season) }))
    .sort((a, b) => a.rate - b.rate)[0];
  const strongest = habits
    .map((habit) => ({ habit, rate: habitRate(habit, season) }))
    .sort((a, b) => b.rate - a.rate)[0];
  const loops = activeLoops(season);
  const sessions = userSessions().filter((session) => session.seasonId === season.id);
  const notes = userNotes();
  const challenge = challengeSuggestions(season)[0];
  return [
    {
      title: weakest ? `Tighten ${weakest.habit.title}` : "Create a first target",
      body: weakest
        ? `Current success is ${weakest.rate}%. Reduce friction or lower the weekly target for one week if execution keeps slipping.`
        : "Add one build habit and one break habit so the season has a clear behavioural centre.",
    },
    {
      title: strongest ? `Protect ${strongest.habit.title}` : "Build a loop",
      body: strongest
        ? `${strongest.habit.title} is carrying the season at ${strongest.rate}%. Link it into a loop so the behaviour becomes easier to repeat.`
        : "Create a short morning or study loop and run it three times this week.",
    },
    {
      title: "Loop rhythm",
      body: loops.length
        ? `${sessions.filter((session) => session.completed).length} completed session${sessions.filter((session) => session.completed).length === 1 ? "" : "s"} recorded this season. Keep loops short enough to start without negotiation.`
        : "Loops turn intention into execution. Start with three steps and a total duration under 30 minutes.",
    },
    {
      title: challenge ? `Try: ${challenge.title}` : "Challenge system",
      body: challenge
        ? `${challenge.reason} ${challenge.difficulty} · ${challenge.xp} XP. Open Coach when you want a structured push.`
        : "No urgent challenge is needed. Keep collecting evidence through habits, loops, and reflections.",
    },
    {
      title: notes.length ? "Knowledge cue" : "Add a principle",
      body: notes.length
        ? notes[notes.length - 1].body
        : "Save one personal rule or reflection. Later this can become the source material for an AI coach.",
    },
  ];
}

function exportCsv() {
  const rows = [
    ["type", "user", "season", "date", "item", "status", "value", "meta"],
    ...userSeasons().map((season) => [
      "season",
      activeUser().name,
      season.name,
      season.startDate,
      season.name,
      season.archived ? "archived" : "active",
      seasonProgress(season),
      `${season.startDate} to ${season.endDate}`,
    ]),
    ...userHabits().flatMap((habit) =>
      Object.keys(habit.logs).map((date) => [
        "habit",
        activeUser().name,
        seasonName(habit.seasonId),
        date,
        habit.title,
        "logged",
        1,
        `${habit.type}; target ${habit.weeklyTarget}`,
      ]),
    ),
    ...userSessions().map((session) => [
      "session",
      activeUser().name,
      seasonName(session.seasonId),
      session.startedAt,
      session.loopTitle,
      session.completed ? "completed" : "broken",
      session.durationSeconds,
      `${session.steps.length} steps`,
    ]),
    ...userChallengeAttempts().map((attempt) => [
      "challenge",
      activeUser().name,
      seasonName(attempt.seasonId),
      attempt.completedAt || attempt.droppedAt || attempt.startedAt,
      attempt.title,
      attempt.status,
      attempt.xp,
      `${attempt.category}; ${attempt.challengeType || "tracked"}; ${attempt.evidence || attempt.reason || ""}`,
    ]),
    ...userXpEvents().map((item) => [
      "xp",
      activeUser().name,
      seasonName(item.seasonId),
      item.createdAt,
      item.eventType,
      "earned",
      item.xpEarned,
      item.awardKey,
    ]),
    ...userEvents().map((item) => [
      "event",
      activeUser().name,
      seasonName(item.seasonId),
      item.at,
      item.label,
      item.type,
      "",
      "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  download(`katheko-export-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
}

function exportJson() {
  const payload = {
    user: activeUser(),
    seasons: userSeasons(),
    habits: userHabits(),
    loops: userLoops(),
    sessions: userSessions(),
    events: userEvents(),
    knowledgeNotes: userNotes(),
    xpEvents: userXpEvents(),
    challengeAttempts: userChallengeAttempts(),
  };
  download(`katheko-export-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportKnowledgeBase() {
  const notes = userNotes().sort((a, b) => parseISO(a.createdAt) - parseISO(b.createdAt));
  const root = `katheko-knowledge-base-${todayISO()}`;
  const files = notes.length
    ? notes.map((note, index) => ({
        path: `${root}/${knowledgeNotePath(note, index)}`,
        content: knowledgeNoteMarkdown(note),
      }))
    : [
        {
          path: `${root}/README.md`,
          content: "# Katheko Knowledge Base\n\nNo notes have been saved yet.\n",
        },
      ];
  const zip = createZip(files);
  downloadBlob(`${root}.zip`, zip);
}

function knowledgeNotePath(note, index) {
  const season = state.seasons.find((item) => item.id === note.seasonId) || state.seasons.find((item) => item.id === note.tagId);
  const seasonFolder = safePathPart(season?.name || "Unassigned season");
  const noteName = `${String(index + 1).padStart(3, "0")}-${safePathPart(note.title || "Untitled note")}.md`;
  if (note.tagType === "habit") {
    const habit = state.habits.find((item) => item.id === note.tagId);
    return `${seasonFolder}/Habits/${safePathPart(habit?.title || note.tagLabel || "Habit")}/${noteName}`;
  }
  if (note.tagType === "loop") {
    const loop = state.loops.find((item) => item.id === note.tagId);
    return `${seasonFolder}/Loops/${safePathPart(loop?.title || note.tagLabel || "Loop")}/${noteName}`;
  }
  if (note.tagType === "challenge") {
    const attempt = state.challengeAttempts.find((item) => item.id === note.tagId);
    return `${seasonFolder}/Challenges/${safePathPart(attempt?.title || note.tagLabel || note.title || "Challenge")}/${noteName}`;
  }
  return `${seasonFolder}/Season Notes/${noteName}`;
}

function knowledgeNoteMarkdown(note) {
  return [
    `# ${note.title || "Untitled note"}`,
    "",
    `- Journal: ${noteTagLabel(note)}`,
    `- Created: ${formatDateTime(note.createdAt)}`,
    "",
    note.body || "",
    "",
  ].join("\n");
}

function safePathPart(value) {
  return String(value || "Untitled")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    || "Untitled";
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetDemoData() {
  if (!confirm("Reset account and delete all Kathēkõ app data for this signed-in account? This cannot be undone.")) return;
  if (!confirm("Final confirmation: delete all seasons, habits, loops, sessions, notes, XP, and challenge data?")) return;
  state = createEmptyState(currentUser?.id || "_anon");
  ui = normaliseUi({});
  persist();
  persistUi();
  render();
}

function activeUser() {
  if (!state) return { id: "_anon", name: "Loading…", email: "" };
  return state.users.find((user) => user.id === state.activeUserId) || state.users[0];
}

function userSeasons() {
  return state.seasons
    .filter((season) => season.userId === state.activeUserId)
    .sort((a, b) => parseISO(b.startDate) - parseISO(a.startDate));
}

function activeSeason() {
  return userSeasons().find((season) => !season.archived) || userSeasons()[0];
}

function userHabits() {
  return state.habits.filter((habit) => habit.userId === state.activeUserId);
}

function activeHabits(season) {
  return userHabits().filter((habit) => habit.seasonId === season?.id && !habit.archived);
}

function userLoops() {
  return state.loops.filter((loop) => loop.userId === state.activeUserId);
}

function activeLoops(season) {
  return userLoops().filter((loop) => loop.seasonId === season?.id && !loop.archived);
}

function userSessions() {
  return state.sessions
    .filter((session) => session.userId === state.activeUserId)
    .sort((a, b) => parseISO(b.startedAt) - parseISO(a.startedAt));
}

function userEvents() {
  return state.events
    .filter((item) => item.userId === state.activeUserId)
    .sort((a, b) => parseISO(b.at) - parseISO(a.at));
}

function userNotes() {
  return state.knowledgeNotes.filter((note) => note.userId === state.activeUserId);
}

function userXpEvents() {
  return (state.xpEvents || []).filter((item) => item.userId === state.activeUserId);
}

function userChallengeAttempts() {
  return (state.challengeAttempts || []).filter((item) => item.userId === state.activeUserId);
}

function setEditHabit(habitId) {
  ui.editHabitId = habitId || "";
  ui.editLoopId = "";
  persistUi();
  render();
}

function setEditLoop(loopId) {
  ui.editLoopId = loopId || "";
  ui.editHabitId = "";
  persistUi();
  render();
}

function setHabitWeek(delta, current = false) {
  const season = activeSeason();
  const currentWeek = currentWeekIndex(season);
  ui.habitWeekOffset = current ? 0 : clamp((Number(ui.habitWeekOffset) || 0) + delta, -currentWeek, 0);
  persistUi();
  render();
}

function selectProfileSeason(seasonId) {
  ui.profileSeasonId = ui.profileSeasonId === seasonId ? "" : seasonId || "";
  persistUi();
  render();
}

function selectAnalyticsLoop(loopId) {
  ui.analyticsLoopId = loopId || "";
  persistUi();
  render();
}

function xpSummary(season = activeSeason()) {
  const events = userXpEvents();
  const total = events.reduce((sum, item) => sum + Math.max(0, Number(item.xpEarned) || 0), 0);
  const level = xpLevel(total);
  const currentLevelXp = xpThreshold(level);
  const nextLevelXp = xpThreshold(level + 1);
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  const seasonXp = season ? events
    .filter((item) => item.seasonId === season.id)
    .reduce((sum, item) => sum + Math.max(0, Number(item.xpEarned) || 0), 0) : 0;
  const challengeXp = season ? events
    .filter((item) => item.seasonId === season.id && String(item.eventType || "").startsWith("challenge"))
    .reduce((sum, item) => sum + Math.max(0, Number(item.xpEarned) || 0), 0) : 0;
  return {
    total,
    season: seasonXp,
    challenge: challengeXp,
    level,
    toNext: Math.max(0, nextLevelXp - total),
    nextProgress: clamp(Math.round(((total - currentLevelXp) / span) * 100), 0, 100),
  };
}

function xpLevel(totalXp) {
  return Math.floor(Math.sqrt(Math.max(0, totalXp) / 100)) + 1;
}

function xpThreshold(level) {
  return Math.pow(Math.max(1, level) - 1, 2) * 100;
}

function recomputeXpAchievements() {
  if (!state?.activeUserId) return;
  const currentUserId = state.activeUserId;
  const events = [];
  const awards = {};
  const addComputedXp = ({ awardKey, eventType, xpEarned, seasonId, metadata = {}, createdAt = nowIso() }) => {
    const amount = Math.max(0, Number(xpEarned) || 0);
    if (!awardKey || !amount || awards[awardKey]) return;
    awards[awardKey] = true;
    events.push({
      id: awardKey,
      userId: currentUserId,
      seasonId: seasonId || "",
      awardKey,
      eventType,
      xpEarned: amount,
      metadata,
      createdAt,
    });
  };

  userHabits().forEach((habit) => {
    const season = state.seasons.find((item) => item.id === habit.seasonId);
    if (!season) return;
    Object.keys(habit.logs || {})
      .filter((date) => date >= season.startDate && date <= season.endDate && date <= todayISO())
      .forEach((date) => {
        addComputedXp({
          awardKey: `habit-log:${habit.id}:${date}`,
          eventType: "habit_log",
          xpEarned: XP_RULES.habitLog,
          seasonId: habit.seasonId,
          metadata: { habitId: habit.id, date, habitTitle: habit.title },
          createdAt: `${date}T12:00:00.000Z`,
        });
      });

    range(currentWeekIndex(season) + 1).forEach((week) => {
      const weekStart = toISO(addDays(parseISO(season.startDate), week * 7));
      const count = weekCount(habit, season, week);
      if (count >= habit.weeklyTarget) {
        addComputedXp({
          awardKey: `habit-week:${habit.id}:${week}`,
          eventType: "habit_week_target",
          xpEarned: XP_RULES.habitWeek,
          seasonId: season.id,
          metadata: { habitId: habit.id, week, habitTitle: habit.title },
          createdAt: `${weekStart}T12:00:00.000Z`,
        });
      }
      if (count >= 7) {
        addComputedXp({
          awardKey: `habit-perfect-week:${habit.id}:${week}`,
          eventType: "habit_perfect_week",
          xpEarned: XP_RULES.habitPerfectWeek,
          seasonId: season.id,
          metadata: { habitId: habit.id, week, habitTitle: habit.title },
          createdAt: `${weekStart}T12:00:00.000Z`,
        });
      }
    });
  });

  userSessions()
    .filter((session) => session.completed)
    .forEach((session) => {
      addComputedXp({
        awardKey: `loop-session:${session.id}`,
        eventType: "loop_complete",
        xpEarned: XP_RULES.loopComplete,
        seasonId: session.seasonId,
        metadata: { loopId: session.loopId, loopTitle: session.loopTitle },
        createdAt: session.endedAt,
      });
    });

  userLoops().forEach((loop) => {
    const season = state.seasons.find((item) => item.id === loop.seasonId);
    if (!season) return;
    range(currentWeekIndex(season) + 1).forEach((week) => {
      if (loopWeekCompletedCount(loop, season, week) >= loop.weeklyTarget) {
        const weekStart = toISO(addDays(parseISO(season.startDate), week * 7));
        addComputedXp({
          awardKey: `loop-week:${loop.id}:${week}`,
          eventType: "loop_week_target",
          xpEarned: XP_RULES.loopWeek,
          seasonId: season.id,
          metadata: { loopId: loop.id, week, loopTitle: loop.title },
          createdAt: `${weekStart}T12:00:00.000Z`,
        });
      }
    });
  });

  userSeasons().forEach((season) => {
    if (parseISO(season.endDate) <= startOfToday()) {
      addComputedXp({
        awardKey: `season-complete:${season.id}`,
        eventType: "season_complete",
        xpEarned: XP_RULES.seasonComplete,
        seasonId: season.id,
        metadata: { seasonName: season.name },
        createdAt: `${season.endDate}T12:00:00.000Z`,
      });
    }
  });

  userChallengeAttempts()
    .filter((attempt) => attempt.status === "completed")
    .forEach((attempt) => {
      addComputedXp({
        awardKey: `challenge-complete:${attempt.id}`,
        eventType: "challenge_complete",
        xpEarned: attempt.xp,
        seasonId: attempt.seasonId,
        metadata: { challengeId: attempt.challengeId, challengeType: attempt.challengeType, title: attempt.title, evidence: attempt.evidence },
        createdAt: attempt.completedAt || attempt.updatedAt || nowIso(),
      });
    });

  events.sort((a, b) => parseISO(a.createdAt) - parseISO(b.createdAt));
  state.xpEvents = events;
  state.xpAwards = awards;
  syncProfileXp();
}

function syncProfileXp() {
  if (!currentUser || !state) return;
  const total = xpSummary().total;
  _db.from("profiles")
    .update({ xp: total, level: xpLevel(total) })
    .eq("id", currentUser.id)
    .then(({ error }) => { if (error) console.warn("XP profile sync failed:", error.message); });
}

function reconcileXpAchievements({ silent = false } = {}) {
  recomputeXpAchievements();
  if (!silent) toast("XP refreshed.");
}

function currentWeekIndexForDate(season, date) {
  const start = parseISO(season.startDate);
  const day = parseISO(date);
  return clamp(Math.floor((day - start) / DAY_MS / 7), 0, 11);
}

function loopWeekCompletedCount(loop, season, week) {
  const weekStart = addDays(parseISO(season.startDate), week * 7);
  const weekEnd = addDays(weekStart, 6);
  return loopSessions(loop, season).filter((session) => {
    const ended = parseISO(session.endedAt || session.startedAt);
    return session.completed && ended >= weekStart && ended <= addDays(weekEnd, 1);
  }).length;
}

function challengeSuggestions(season) {
  if (!season) return [];
  const usedIds = new Set(
    userChallengeAttempts()
      .filter((attempt) => attempt.seasonId === season.id)
      .map((attempt) => attempt.challengeId),
  );
  const score = overallPerformance(season);
  const suggestions = score < 60 ? recoveryChallenges(season, score) : score > 80 ? bonusChallenges(season, score) : [];
  return suggestions.filter((challenge) => !usedIds.has(challenge.id)).slice(0, 12);
}

function recoveryChallenges(season, score = overallPerformance(season)) {
  const limit = recoverySuggestionLimit(score);
  if (!limit) return [];
  const current = currentWeekIndex(season);
  const suggestions = [];
  const weakHabits = activeHabits(season)
    .map((habit) => ({
      habit,
      rate: habitRate(habit, season),
      currentCount: weekCount(habit, season, current),
    }))
    .filter((item) => item.rate < 65 || item.currentCount < item.habit.weeklyTarget)
    .sort((a, b) => a.rate - b.rate || a.currentCount - b.currentCount);
  weakHabits.forEach(({ habit, rate, currentCount }) => {
    const missed = Math.max(0, habit.weeklyTarget - currentCount);
    if (score < 40 && missed >= Math.ceil(habit.weeklyTarget / 2)) {
      suggestions.push(makeChallenge({
        id: `recovery-window:${habit.id}:${current}`,
        category: "recovery",
        type: "recovery_window",
        title: `Rebuild ${habit.title}`,
        description: `Hit a smaller target first, then return ${habit.title} to its full weekly target.`,
        reason: `${habit.title} is running at ${rate}% and needs a staged recovery.`,
        difficulty: score < 30 ? "Deep" : "Standard",
        xp: score < 30 ? 150 : 75,
        objective: {
          type: "recovery_window",
          habitId: habit.id,
          firstWeek: current,
          firstTarget: Math.max(1, Math.ceil(habit.weeklyTarget / 2)),
          secondWeek: Math.min(11, current + 1),
          secondTarget: habit.weeklyTarget,
        },
      }));
      return;
    }
    const targetDays = score < 40 ? 5 : 3;
    suggestions.push(makeChallenge({
      id: `recovery-habit-streak:${habit.id}:${current}:${targetDays}`,
      category: "recovery",
      type: "habit_streak",
      title: `${targetDays}-day ${habit.title} streak`,
      description: `Log ${habit.title} for ${targetDays} consecutive days. Completion is detected from habit logs.`,
      reason: `${habit.title} is below target this week.`,
      difficulty: targetDays >= 5 ? "Standard" : "Light",
      xp: targetDays >= 5 ? 75 : 30,
      objective: { type: "habit_streak", habitId: habit.id, targetDays, windowDays: targetDays + 4 },
    }));
  });
  activeLoops(season)
    .map((loop) => ({ loop, stats: loopStats(loop, season) }))
    .filter(({ stats }) => stats.successRate < 60 || stats.broken > 0)
    .sort((a, b) => a.stats.successRate - b.stats.successRate || b.stats.broken - a.stats.broken)
    .forEach(({ loop, stats }) => {
      const targetCount = score < 40 ? 3 : 2;
      suggestions.push(makeChallenge({
        id: `recovery-loop-count:${loop.id}:${current}:${targetCount}`,
        category: "recovery",
        type: "loop_completion_count",
        title: `Restart ${loop.title}`,
        description: `Complete ${loop.title} ${targetCount} time${targetCount === 1 ? "" : "s"} in the next 7 days.`,
        reason: `${loop.title} is at ${stats.successRate}% completion.`,
        difficulty: targetCount >= 3 ? "Standard" : "Light",
        xp: targetCount >= 3 ? 75 : 30,
        objective: { type: "loop_completion_count", loopId: loop.id, targetCount, windowDays: 7 },
      }));
    });
  const inactiveDays = inactiveDayCount(season);
  if (inactiveDays >= 2) {
    const targetDays = score < 30 ? 5 : 3;
    suggestions.push(makeChallenge({
      id: `recovery-note-streak:${season.id}:${current}:${targetDays}`,
      category: "recovery",
      type: "knowledge_note_streak",
      title: `${targetDays}-day reflection restart`,
      description: `Create one knowledge note per day for ${targetDays} consecutive days.`,
      reason: `${inactiveDays} inactive day${inactiveDays === 1 ? "" : "s"} detected.`,
      difficulty: targetDays >= 5 ? "Standard" : "Light",
      xp: targetDays >= 5 ? 75 : 30,
      objective: { type: "knowledge_note_streak", targetDays, windowDays: targetDays + 4 },
    }));
  }
  return suggestions.slice(0, limit);
}

function bonusChallenges(season, score = overallPerformance(season)) {
  const limit = bonusSuggestionLimit(score);
  if (!limit) return [];
  const current = currentWeekIndex(season);
  const habits = activeHabits(season);
  const loops = activeLoops(season);
  const suggestions = [];
  const strongest = habits
    .map((habit) => ({ habit, rate: habitRate(habit, season), streak: weeklyStreak(habit, season) }))
    .sort((a, b) => b.rate - a.rate || b.streak - a.streak)[0];
  if (strongest) {
    suggestions.push(makeChallenge({
      id: `bonus-habit-week-streak:${strongest.habit.id}:${current}`,
      category: "bonus",
      type: "habit_week_streak",
      title: `Three strong weeks: ${strongest.habit.title}`,
      description: `Hit the weekly target for ${strongest.habit.title} for 3 weeks in a row.`,
      reason: `${strongest.habit.title} is strong enough for a longer streak challenge.`,
      difficulty: "Deep",
      xp: 150,
      objective: { type: "habit_week_streak", habitId: strongest.habit.id, targetWeeks: 3, startWeek: current },
    }));
  }
  const weakLoop = loops
    .map((loop) => ({ loop, stats: loopStats(loop, season) }))
    .sort((a, b) => a.stats.successRate - b.stats.successRate)[0];
  const upgradeHabit = strongest?.habit && weakLoop && !loopHasHabit(weakLoop.loop, strongest.habit.id) ? strongest.habit : null;
  if (weakLoop && upgradeHabit) {
    suggestions.push(makeChallenge({
      id: `bonus-loop-upgrade:${weakLoop.loop.id}:${upgradeHabit.id}:${current}`,
      category: "bonus",
      type: "loop_upgrade",
      title: `Upgrade ${weakLoop.loop.title}`,
      description: `Add ${upgradeHabit.title} to ${weakLoop.loop.title}, then complete the upgraded loop 3 times.`,
      reason: `${upgradeHabit.title} is strong and ${weakLoop.loop.title} can absorb it.`,
      difficulty: "Deep",
      xp: 150,
      objective: { type: "loop_upgrade", loopId: weakLoop.loop.id, habitId: upgradeHabit.id, targetRuns: 3, windowDays: 21 },
    }));
  }
  const bestLoop = loops
    .map((loop) => ({ loop, stats: loopStats(loop, season) }))
    .sort((a, b) => b.stats.successRate - a.stats.successRate)[0];
  if (bestLoop) {
    suggestions.push(makeChallenge({
      id: `bonus-loop-streak:${bestLoop.loop.id}:${current}`,
      category: "bonus",
      type: "loop_streak",
      title: `Three-week ${bestLoop.loop.title} streak`,
      description: `Hit the weekly loop target for ${bestLoop.loop.title} for 3 consecutive weeks.`,
      reason: `${bestLoop.loop.title} is ready for a harder consistency challenge.`,
      difficulty: "Deep",
      xp: 150,
      objective: { type: "loop_streak", loopId: bestLoop.loop.id, targetWeeks: 3, startWeek: current },
    }));
  }
  suggestions.push(makeChallenge({
    id: `bonus-note-streak:${season.id}:${current}`,
    category: "bonus",
    type: "knowledge_note_streak",
    title: "10-day knowledge streak",
    description: "Create a knowledge note for 10 consecutive days.",
    reason: "Your current season performance is strong enough for deeper reflection.",
    difficulty: "Deep",
    xp: 100,
    objective: { type: "knowledge_note_streak", targetDays: 10, windowDays: 14 },
  }));
  return suggestions.slice(0, limit);
}

function makeChallenge({ id, category, type, title, description, reason, difficulty, xp, objective }) {
  return { id, category, type, title, description, reason, difficulty, xp, objective };
}

function overallPerformance(season) {
  const metrics = seasonMetrics(season);
  const parts = [];
  if (activeHabits(season).length) parts.push(metrics.weeklyScore, metrics.averageHabitRate);
  if (activeLoops(season).length) parts.push(metrics.loopCompletionRate);
  if (!parts.length) return 0;
  return clamp(Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length), 0, 100);
}

function performanceBandLabel(score) {
  if (score < 60) return "Recovery zone";
  if (score <= 80) return "Neutral zone";
  return "Bonus zone";
}

function recoverySuggestionLimit(score) {
  if (score >= 60) return 0;
  if (score >= 50) return 1;
  if (score >= 40) return 2;
  if (score >= 30) return 3;
  return 5;
}

function bonusSuggestionLimit(score) {
  if (score <= 80) return 0;
  if (score < 90) return 1;
  if (score < 100) return 2;
  return 4;
}

function loopHasHabit(loop, habitId) {
  return Boolean(loop?.steps?.some((step) => step.habitId === habitId));
}

function inactiveDayCount(season) {
  let count = 0;
  for (let offset = 0; offset < Math.min(elapsedDays(season), 14); offset += 1) {
    const date = toISO(addDays(startOfToday(), -offset));
    const hasHabit = activeHabits(season).some((habit) => habit.logs[date]);
    const hasLoop = userSessions().some((session) => session.seasonId === season.id && toISO(parseISO(session.startedAt)) === date);
    if (hasHabit || hasLoop) break;
    count += 1;
  }
  return count;
}

function findSuggestedChallenge(challengeId) {
  return challengeSuggestions(activeSeason()).find((challenge) => challenge.id === challengeId);
}

function startChallenge(challengeId) {
  const challenge = findSuggestedChallenge(challengeId);
  const season = activeSeason();
  if (!challenge || !season) return;
  state.challengeAttempts ||= [];
  state.challengeAttempts.push({
    id: uid("challenge"),
    userId: state.activeUserId,
    seasonId: season.id,
    challengeId: challenge.id,
    title: challenge.title,
    description: challenge.description,
    category: challenge.category,
    difficulty: challenge.difficulty,
    xp: challenge.xp,
    challengeType: challenge.type,
    objective: { ...challenge.objective },
    reason: challenge.reason,
    progress: { value: 0, target: challenge.objective.targetDays || challenge.objective.targetWeeks || challenge.objective.targetCount || challenge.objective.targetRuns || 1 },
    status: "active",
    startedAt: nowIso(),
    deadlineDate: challenge.objective.windowDays ? toISO(addDays(startOfToday(), challenge.objective.windowDays - 1)) : "",
    updatedAt: nowIso(),
  });
  evaluateAllActiveChallenges();
  state.events.push(event(state.activeUserId, season.id, "challenge", `Started ${challenge.title}`, nowIso()));
  persist();
  toast("Challenge started.");
  render();
}

function dropChallenge(attemptId) {
  const attempt = state.challengeAttempts.find((item) => item.id === attemptId && item.userId === state.activeUserId);
  if (!attempt || attempt.status !== "active") return;
  attempt.status = "dropped";
  attempt.droppedAt = nowIso();
  attempt.updatedAt = nowIso();
  attempt.evidence = "Dropped by user. No completion XP awarded.";
  persist();
  toast("Challenge dropped.");
  render();
}

function evaluateAllActiveChallenges() {
  if (!state?.challengeAttempts) return;
  state.challengeAttempts
    .filter((attempt) => attempt.userId === state.activeUserId && attempt.status === "active")
    .forEach((attempt) => {
      const progress = evaluateChallengeProgress(attempt);
      attempt.progress = progress;
      attempt.updatedAt = nowIso();
      if (progress.expired) expireChallenge(attempt, progress.evidence);
      else if (progress.complete) completeChallenge(attempt, progress.evidence);
    });
}

function completeChallenge(attempt, evidence) {
  if (!attempt || attempt.status !== "active") return;
  const at = nowIso();
  attempt.status = "completed";
  attempt.completedAt = at;
  attempt.updatedAt = at;
  attempt.evidence = evidence || "Objective completed from tracked activity.";
}

function expireChallenge(attempt, evidence) {
  if (!attempt || attempt.status !== "active") return;
  attempt.status = "expired";
  attempt.expiredAt = nowIso();
  attempt.updatedAt = nowIso();
  attempt.evidence = evidence || "Challenge window expired before the objective was completed.";
}

function evaluateChallengeProgress(attempt) {
  if (!attempt?.objective) return { value: 0, target: 1, expired: true, evidence: "Legacy self-attested challenge retired." };
  const objective = attempt.objective;
  if (attempt.deadlineDate && parseISO(todayISO()) > parseISO(attempt.deadlineDate)) {
    return { value: attempt.progress?.value || 0, target: attempt.progress?.target || 1, expired: true, evidence: `Expired after ${formatDate(attempt.deadlineDate)}.` };
  }
  if (objective.type === "habit_streak") return evaluateHabitStreakChallenge(attempt);
  if (objective.type === "habit_week_streak") return evaluateHabitWeekStreakChallenge(attempt);
  if (objective.type === "loop_completion_count") return evaluateLoopCompletionChallenge(attempt);
  if (objective.type === "loop_streak") return evaluateLoopStreakChallenge(attempt);
  if (objective.type === "loop_upgrade") return evaluateLoopUpgradeChallenge(attempt);
  if (objective.type === "knowledge_note_streak") return evaluateKnowledgeNoteStreakChallenge(attempt);
  if (objective.type === "recovery_window") return evaluateRecoveryWindowChallenge(attempt);
  return { value: 0, target: 1, expired: true, evidence: "Unknown challenge objective retired." };
}

function evaluateHabitStreakChallenge(attempt) {
  const habit = userHabits().find((item) => item.id === attempt.objective.habitId);
  if (!habit) return { value: 0, target: attempt.objective.targetDays, expired: true, evidence: "Habit no longer exists." };
  const result = longestConsecutiveRun(Object.keys(habit.logs || {}), toISO(parseISO(attempt.startedAt)), todayISO());
  const target = attempt.objective.targetDays;
  return {
    value: result.longest,
    target,
    complete: result.longest >= target,
    evidence: result.longest >= target ? `${habit.title} logged for ${target} consecutive days.` : `${result.longest}/${target} consecutive days logged.`,
  };
}

function evaluateHabitWeekStreakChallenge(attempt) {
  const season = state.seasons.find((item) => item.id === attempt.seasonId);
  const habit = userHabits().find((item) => item.id === attempt.objective.habitId);
  if (!season || !habit) return { value: 0, target: attempt.objective.targetWeeks, expired: true, evidence: "Habit or season no longer exists." };
  const startWeek = Number(attempt.objective.startWeek) || currentWeekIndexForDate(season, attempt.startedAt);
  const target = attempt.objective.targetWeeks;
  const result = longestSuccessfulWeekRun(startWeek, currentWeekIndex(season), (week) => weekCount(habit, season, week) >= habit.weeklyTarget);
  return {
    value: result.longest,
    target,
    complete: result.longest >= target,
    evidence: result.longest >= target ? `${habit.title} hit target for ${target} consecutive weeks.` : `${result.longest}/${target} successful weeks.`,
  };
}

function evaluateLoopCompletionChallenge(attempt) {
  const loop = userLoops().find((item) => item.id === attempt.objective.loopId);
  if (!loop) return { value: 0, target: attempt.objective.targetCount, expired: true, evidence: "Loop no longer exists." };
  const count = completedLoopRunsSince(loop.id, attempt.startedAt, attempt.deadlineDate);
  const target = attempt.objective.targetCount;
  return {
    value: count,
    target,
    complete: count >= target,
    evidence: count >= target ? `${loop.title} completed ${target} times.` : `${count}/${target} loop completions recorded.`,
  };
}

function evaluateLoopStreakChallenge(attempt) {
  const season = state.seasons.find((item) => item.id === attempt.seasonId);
  const loop = userLoops().find((item) => item.id === attempt.objective.loopId);
  if (!season || !loop) return { value: 0, target: attempt.objective.targetWeeks, expired: true, evidence: "Loop or season no longer exists." };
  const startWeek = Number(attempt.objective.startWeek) || currentWeekIndexForDate(season, attempt.startedAt);
  const target = attempt.objective.targetWeeks;
  const result = longestSuccessfulWeekRun(startWeek, currentWeekIndex(season), (week) => loopWeekCompletedCount(loop, season, week) >= loop.weeklyTarget);
  return {
    value: result.longest,
    target,
    complete: result.longest >= target,
    evidence: result.longest >= target ? `${loop.title} hit target for ${target} consecutive weeks.` : `${result.longest}/${target} successful loop weeks.`,
  };
}

function evaluateLoopUpgradeChallenge(attempt) {
  const loop = userLoops().find((item) => item.id === attempt.objective.loopId);
  const habit = userHabits().find((item) => item.id === attempt.objective.habitId);
  const target = attempt.objective.targetRuns;
  if (!loop || !habit) return { value: 0, target, expired: true, evidence: "Loop or habit no longer exists." };
  if (!loopHasHabit(loop, habit.id)) return { value: 0, target, complete: false, evidence: `Add ${habit.title} to ${loop.title} first.` };
  if (!attempt.objective.upgradedAt) attempt.objective.upgradedAt = nowIso();
  const count = completedLoopRunsSince(loop.id, attempt.objective.upgradedAt, attempt.deadlineDate);
  return {
    value: count,
    target,
    complete: count >= target,
    evidence: count >= target ? `${loop.title} includes ${habit.title} and was completed ${target} times.` : `${count}/${target} upgraded loop completions recorded.`,
  };
}

function evaluateKnowledgeNoteStreakChallenge(attempt) {
  const dates = userNotes()
    .filter((note) => note.seasonId === attempt.seasonId && note.tagType !== "challenge")
    .map((note) => toISO(parseISO(note.createdAt)));
  const result = longestConsecutiveRun(dates, toISO(parseISO(attempt.startedAt)), todayISO());
  const target = attempt.objective.targetDays;
  return {
    value: result.longest,
    target,
    complete: result.longest >= target,
    evidence: result.longest >= target ? `${target} consecutive days of knowledge notes created.` : `${result.longest}/${target} note streak days recorded.`,
  };
}

function evaluateRecoveryWindowChallenge(attempt) {
  const season = state.seasons.find((item) => item.id === attempt.seasonId);
  const habit = userHabits().find((item) => item.id === attempt.objective.habitId);
  if (!season || !habit) return { value: 0, target: 2, expired: true, evidence: "Habit or season no longer exists." };
  const firstMet = weekCount(habit, season, attempt.objective.firstWeek) >= attempt.objective.firstTarget;
  const secondMet = weekCount(habit, season, attempt.objective.secondWeek) >= attempt.objective.secondTarget;
  const value = Number(firstMet) + Number(firstMet && secondMet);
  return {
    value,
    target: 2,
    complete: firstMet && secondMet,
    evidence: firstMet && secondMet
      ? `${habit.title} rebuilt through staged weekly targets.`
      : `${value}/2 staged recovery targets completed.`,
  };
}

function challengeProgressPercent(progress = {}) {
  const target = Math.max(1, Number(progress.target) || 1);
  const value = clamp(Number(progress.value) || 0, 0, target);
  return clamp(Math.round((value / target) * 100), 0, 100);
}

function challengeProgressText(progress = {}) {
  if (progress.evidence) return progress.evidence;
  const target = Math.max(1, Number(progress.target) || 1);
  const value = clamp(Number(progress.value) || 0, 0, target);
  return `${value}/${target} tracked`;
}

function longestConsecutiveRun(dates, startDate, endDate) {
  const marked = new Set((dates || []).map((date) => toISO(parseISO(date))));
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  let longest = 0;
  let current = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (marked.has(toISO(day))) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return { longest, current };
}

function longestSuccessfulWeekRun(startWeek, endWeek, predicate) {
  let longest = 0;
  let current = 0;
  for (let week = Math.max(0, Number(startWeek) || 0); week <= Math.max(0, Number(endWeek) || 0); week += 1) {
    if (predicate(week)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return { longest, current };
}

function completedLoopRunsSince(loopId, startAt, endDate = "") {
  const start = parseISO(startAt);
  const end = endDate ? addDays(parseISO(endDate), 1) : addDays(startOfToday(), 1);
  return userSessions().filter((session) => {
    const ended = parseISO(session.endedAt || session.startedAt);
    return session.loopId === loopId && session.completed && ended >= start && ended < end;
  }).length;
}

function seasonMetrics(season) {
  const habits = activeHabits(season);
  const loops = activeLoops(season);
  const sessions = userSessions().filter((session) => session.seasonId === season.id);
  const currentWeek = currentWeekIndex(season);
  const weeklyTargetSum = habits.reduce((sum, habit) => sum + habit.weeklyTarget, 0);
  const weeklyDoneSum = habits.reduce((sum, habit) => sum + Math.min(habit.weeklyTarget, weekCount(habit, season, currentWeek)), 0);
  const averageHabitRate = habits.length
    ? Math.round(habits.reduce((sum, habit) => sum + habitRate(habit, season), 0) / habits.length)
    : 0;
  const completedRuns = sessions.filter((session) => session.completed).length;
  return {
    daysLeft: Math.max(0, Math.ceil((parseISO(season.endDate) - startOfToday()) / DAY_MS)),
    weeklyScore: weeklyTargetSum ? Math.round((weeklyDoneSum / weeklyTargetSum) * 100) : 0,
    averageHabitRate,
    completedRuns,
    loopCompletionRate: sessions.length ? Math.round((completedRuns / sessions.length) * 100) : loops.length ? 0 : 100,
  };
}

function seasonSummary(season) {
  const habits = userHabits().filter((habit) => habit.seasonId === season.id);
  const loops = userLoops().filter((loop) => loop.seasonId === season.id);
  const sessions = userSessions().filter((session) => session.seasonId === season.id);
  const habitSummaries = habits.map((habit) => ({
    title: habit.title,
    type: habit.type,
    rate: habitRate(habit, season),
    streak: longestWeeklyStreak(habit, season),
    completions: completionCount(habit, season),
  }));
  const goalsAchieved = habitSummaries.filter((habit) => habit.rate >= 100).length;
  const completedRuns = sessions.filter((session) => session.completed).length;
  const loopSuccessRate = sessions.length ? Math.round((completedRuns / sessions.length) * 100) : 0;
  const achievementLevel = habits.length
    ? Math.round(habitSummaries.reduce((sum, habit) => sum + habit.rate, 0) / habits.length)
    : sessions.length
      ? loopSuccessRate
      : 0;
  return {
    id: season.id,
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    achievementLevel,
    goalsAchieved,
    habitsWorkedOn: habits.length,
    loopSuccessRate,
    habits: habitSummaries,
    loops,
  };
}

function weekCount(habit, season, weekIndex) {
  const start = addDays(parseISO(season.startDate), weekIndex * 7);
  return range(7).filter((offset) => habit.logs[toISO(addDays(start, offset))]).length;
}

function habitRate(habit, season) {
  const elapsed = elapsedDays(season);
  if (!elapsed) return 0;
  const current = currentWeekIndex(season);
  const today = startOfToday();
  const seasonEnded = today > parseISO(season.endDate);
  const currentWeekComplete = weekCount(habit, season, current) >= habit.weeklyTarget;
  const eligibleWeeks = range(current + 1).filter((week) => seasonEnded || week < current || currentWeekComplete);
  if (!eligibleWeeks.length) {
    return Math.round((Math.min(habit.weeklyTarget, weekCount(habit, season, current)) / habit.weeklyTarget) * 100);
  }
  const successfulWeeks = eligibleWeeks.filter((week) => weekCount(habit, season, week) >= habit.weeklyTarget).length;
  return clamp(Math.round((successfulWeeks / eligibleWeeks.length) * 100), 0, 100);
}

function habitOverallPerformance(habit, season) {
  const elapsed = elapsedDays(season);
  if (!elapsed) return 0;
  const expected = Math.max(1, (elapsed / 7) * habit.weeklyTarget);
  return clamp(Math.round((completionCount(habit, season) / expected) * 100), 0, 100);
}

function completionCount(habit, season) {
  return Object.keys(habit.logs).filter((date) => date >= season.startDate && date <= season.endDate && date <= todayISO()).length;
}

function habitProgressText(habit, season, week = currentWeekIndex(season)) {
  const count = weekCount(habit, season, week);
  const streak = weeklyStreak(habit, season);
  const label = week === currentWeekIndex(season) ? "this week" : `week ${week + 1}`;
  return `${count}/${habit.weeklyTarget} ${label} · ${streak} week streak · ${habitRate(habit, season)}%`;
}

function weeklyStreak(habit, season) {
  const current = currentWeekIndex(season);
  const today = startOfToday();
  const seasonEnded = today > parseISO(season.endDate);
  let startWeek = current;
  if (!seasonEnded && weekCount(habit, season, current) < habit.weeklyTarget && current > 0) {
    startWeek = current - 1;
  }
  let streak = 0;
  for (let week = startWeek; week >= 0; week -= 1) {
    if (weekCount(habit, season, week) >= habit.weeklyTarget) streak += 1;
    else break;
  }
  return streak;
}

function longestWeeklyStreak(habit, season) {
  const maxWeek = currentWeekIndex(season);
  let longest = 0;
  let current = 0;
  for (let week = 0; week <= maxWeek; week += 1) {
    if (weekCount(habit, season, week) >= habit.weeklyTarget) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function longestSeasonStreak(habits, season) {
  const best = habits
    .map((habit) => ({ habitTitle: habit.title, weeks: longestWeeklyStreak(habit, season) }))
    .sort((a, b) => b.weeks - a.weeks)[0];
  return best || { habitTitle: "None yet", weeks: 0 };
}

function loopCompletionText(loop, season) {
  const runs = loopSessions(loop, season);
  const completed = runs.filter((session) => session.completed).length;
  return `${completed}/${Math.max(runs.length, 1)} completed`;
}

function loopSessions(loop, season) {
  return userSessions().filter((session) => session.loopId === loop.id && session.seasonId === season.id);
}

function loopStats(loop, season) {
  const runs = loopSessions(loop, season);
  const completed = runs.filter((session) => session.completed).length;
  const broken = runs.length - completed;
  return {
    runs: runs.length,
    completed,
    broken,
    successRate: runs.length ? Math.round((completed / runs.length) * 100) : 0,
  };
}

function loopDuration(loop) {
  return loop.steps.reduce((sum, step) => sum + step.minutes, 0);
}

function seasonProgress(season) {
  if (!season) return 0;
  return clamp(Math.round((elapsedDays(season) / 84) * 100), 0, 100);
}

function elapsedDays(season) {
  const start = parseISO(season.startDate);
  const today = startOfToday();
  if (today < start) return 0;
  return clamp(Math.floor((today - start) / DAY_MS) + 1, 0, 84);
}

function currentWeekIndex(season) {
  return clamp(Math.floor((elapsedDays(season) - 1) / 7), 0, 11);
}

function seasonName(seasonId) {
  return state.seasons.find((season) => season.id === seasonId)?.name || "Unknown season";
}

function habitTypeChip(type) {
  return `<span class="chip neutral">${type === "break" ? "Break" : "Build"}</span>`;
}

function setView(view) {
  ui.view = view === "challenges" ? "coach" : view;
  ui.mobileMoreOpen = false;
  ui.flippedMetricId = "";
  clearTimeout(runtime.metricTimer);
  persistUi();
  render();
}

function toggleMobileMore() {
  ui.mobileMoreOpen = !ui.mobileMoreOpen;
  persistUi();
  render();
}

function flipMetric(metricId) {
  if (!metricId) return;
  ui.flippedMetricId = ui.flippedMetricId === metricId ? "" : metricId;
  persistUi();
  render();
  clearTimeout(runtime.metricTimer);
  if (ui.flippedMetricId) {
    runtime.metricTimer = setTimeout(() => {
      ui.flippedMetricId = "";
      persistUi();
      render();
    }, 10_000);
  }
}

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2200);
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function range(length) {
  return Array.from({ length }, (_, index) => index);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function nowIso() {
  return new Date().toISOString();
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function todayISO() {
  return toISO(startOfToday());
}

function parseISO(value) {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function toISO(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(parseISO(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseISO(value));
}

function weekday(value) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(parseISO(value));
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, totalSeconds);
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach((file) => {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = zipLocalHeader(name, data.length, crc);
    chunks.push(local, name, data);
    central.push({ name, size: data.length, crc, offset });
    offset += local.length + name.length + data.length;
  });

  let centralSize = 0;
  central.forEach((file) => {
    const header = zipCentralHeader(file);
    chunks.push(header, file.name);
    centralSize += header.length + file.name.length;
  });

  chunks.push(zipEndRecord(central.length, centralSize, offset));
  return new Blob(chunks, { type: "application/zip" });
}

function zipLocalHeader(name, size, crc) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  return header;
}

function zipCentralHeader(file) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, file.crc, true);
  view.setUint32(20, file.size, true);
  view.setUint32(24, file.size, true);
  view.setUint16(28, file.name.length, true);
  view.setUint32(42, file.offset, true);
  return header;
}

function zipEndRecord(count, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return header;
}

function crc32(data) {
  let crc = -1;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function titleCase(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUPABASE AUTH + STATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Boot ─────────────────────────────────────────────────────────────────────

async function initApp() {
  // Show a loading state immediately
  document.querySelector("#app").innerHTML = renderLoading();

  // Restore any existing session from cookies/localStorage
  const { data: { session } } = await _db.auth.getSession();
  currentUser = session?.user ?? null;

  if (currentUser) {
    state = await loadStateFromSupabase(currentUser.id);
    reconcileXpAchievements({ silent: true });
    evaluateAllActiveChallenges();
    persist();
  }

  render();

  // Keep in sync with auth events (login, logout, token refresh)
  _db.auth.onAuthStateChange(async (_event, newSession) => {
    const newUser = newSession?.user ?? null;
    if (newUser && (!currentUser || currentUser.id !== newUser.id)) {
      currentUser = newUser;
      state = await loadStateFromSupabase(currentUser.id);
      reconcileXpAchievements({ silent: true });
      evaluateAllActiveChallenges();
      persist();
      ui = normaliseUi({});
      render();
    } else if (!newUser) {
      currentUser = null;
      state = null;
      render();
    }
  });
}

// ── State load/create ─────────────────────────────────────────────────────────

async function loadStateFromSupabase(userId) {
  const { data, error } = await _db
    .from("user_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load state:", error.message);
    toast("Could not load your data — please refresh.");
    return createEmptyState(userId);
  }

  if (!data) {
    // First login — check if there's local localStorage data to migrate
    const localRaw = localStorage.getItem(STORAGE_KEY);
    if (localRaw) {
      try {
        const localState = normaliseState(JSON.parse(localRaw));
        // Re-key all user-owned records to the real Supabase user id
        const remapped = remapStateUserId(localState, userId);
        // Save to Supabase immediately
        await _db.from("user_state").insert({
          user_id: userId,
          data: remapped,
          updated_at: new Date().toISOString(),
        });
        localStorage.removeItem(STORAGE_KEY); // clean up
        toast("Local data migrated to your account.");
        return remapped;
      } catch {
        // Fall through to empty state
      }
    }
    return createEmptyState(userId);
  }

  return normaliseState(data.data);
}

function remapStateUserId(oldState, newUserId) {
  // Replace every occurrence of the old anon userId with the real Supabase one
  const oldId = oldState.activeUserId;
  const json  = JSON.stringify(oldState).replaceAll(oldId, newUserId);
  return JSON.parse(json);
}

function createEmptyState(userId) {
  return {
    activeUserId: userId,
    users: [{ id: userId, name: currentUser?.user_metadata?.display_name || "You",
               email: currentUser?.email || "", createdAt: nowIso() }],
    seasons:       [],
    habits:        [],
    loops:         [],
    sessions:      [],
    events:        [],
    xpEvents:      [],
    xpAwards:      {},
    challengeAttempts: [],
    knowledgeNotes: [],
  };
}

// ── Auth screen ───────────────────────────────────────────────────────────────

let _authMode = "login"; // "login" | "signup"

function toggleAuthMode() {
  _authMode = _authMode === "login" ? "signup" : "login";
  render();
}

function renderLoading() {
  return `<div class="auth-shell"><div class="auth-card"><p class="auth-loading">Loading…</p></div></div>`;
}

function renderAuthScreen() {
  const isLogin = _authMode === "login";
  return `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="./assets/katheko-logo.png" alt="Kathēkõ" />
          <div>
            <h1>Kathēkõ</h1>
            <p>Appropriate action, Measured well, Guided better</p>
          </div>
        </div>

        <form data-form="${isLogin ? "auth-login" : "auth-signup"}" class="auth-form" novalidate>
          <h2>${isLogin ? "Sign in" : "Create account"}</h2>

          ${!isLogin ? `
          <div class="field">
            <label for="auth-name">Your name</label>
            <input id="auth-name" name="name" type="text" placeholder="Malav" required autocomplete="name" />
          </div>` : ""}

          <div class="field">
            <label for="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" placeholder="you@example.com"
                   required autocomplete="email" />
          </div>

          <div class="field">
            <label for="auth-password">Password</label>
            <input id="auth-password" name="password" type="password"
                   placeholder="${isLogin ? "Your password" : "At least 8 characters"}"
                   required autocomplete="${isLogin ? "current-password" : "new-password"}" />
          </div>

          <button type="submit" class="btn-primary auth-submit">
            ${isLogin ? "Sign in" : "Create account"}
          </button>
        </form>

        <p class="auth-toggle">
          ${isLogin ? "No account yet?" : "Already have an account?"}
          <button class="link-btn" data-action="auth-toggle">
            ${isLogin ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>`;
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

async function handleAuthLogin({ email, password }) {
  const submitBtn = document.querySelector(".auth-submit");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Signing in…"; }

  const { error } = await _db.auth.signInWithPassword({ email, password });

  if (error) {
    toast(error.message === "Invalid login credentials"
      ? "Email or password incorrect."
      : error.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Sign in"; }
  }
  // onAuthStateChange handles the rest on success
}

async function handleAuthSignup({ name, email, password }) {
  if (!password || password.length < 8) {
    toast("Password must be at least 8 characters."); return;
  }

  const submitBtn = document.querySelector(".auth-submit");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Creating account…"; }

  const { error } = await _db.auth.signUp({
    email,
    password,
    options: { data: { display_name: name || email.split("@")[0] } },
  });

  if (error) {
    toast(error.message);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create account"; }
  } else {
    toast("Account created — check your email to confirm, then sign in.");
    _authMode = "login";
    render();
  }
}

async function handleSignOut() {
  if (!confirm("Sign out of Kathēkõ?")) return;
  await _db.auth.signOut();
  ui = normaliseUi({});
  persistUi();
  // onAuthStateChange clears state and re-renders
}
