import { createTranslator } from './prism-i18n.js';

const labels = {
  waiting: "messages.waiting", running: "messages.running", done: "messages.complete2", warning: "messages.review", error: "messages.failed2",
};

export function mountProbeView({ title, scope, steps, success = "messages.resultsSaved" }, preview) {
  const preferences = new URLSearchParams(location.search);
  const englishSelected = preferences.get('lang') === 'en';
  const t = createTranslator(englishSelected ? 'en' : 'zh-CN');
  const locale = englishSelected ? 'en' : 'zh-CN';
  const started = [];
  const beganAt = performance.now();
  const host = document.querySelector('[data-prism-probe]');
  document.documentElement.lang = locale;
  host.dataset.theme = preferences.get('theme') === 'dark' ? 'dark' : 'light';
  const icon = host.dataset.theme === 'dark' ? '/prism-favicon-dark.png' : '/prism-favicon.png';
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.append(favicon);
  }
  favicon.href = icon;
  document.title = `Prism · ${t(title)}`;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <link rel="stylesheet" href="/prism-theme.css">
    <link rel="stylesheet" href="/probe-view.css">
    <header class="top">
      <div class="frame top-inner">
        <div class="wordmark"><img class="mark" src="${icon}" width="32" height="32" alt="">Prism</div>
        <span class="scope"></span>
      </div>
    </header>
    <main class="frame workspace" aria-labelledby="probe-title">
      <h1 id="probe-title"></h1>
      <p class="note">${t(preview ? "messages.thisPreviewShowsSampleStatusesAndTimings" : "messages.keepThisTabOpenItWillCloseAfterThe")}</p>
      <section class="monitor" data-state="running" aria-label="${t("messages.checkProgress")}">
        <div class="monitor-readout">
          <div class="status" role="status" data-state="running">
            <span class="state-symbol" aria-hidden="true"></span>
            <span class="status-text"></span>
          </div>
          <div class="elapsed"><span>${t("messages.elapsedTime")}</span><time class="elapsed-time">00:00</time></div>
        </div>
        <div class="progress" role="progressbar" aria-label="${t("messages.stepsProcessed")}" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="0"></div>
      </section>
      <section class="timeline" aria-labelledby="steps-title">
        <div class="timeline-heading">
          <h2 id="steps-title">${t("messages.checkSteps")}</h2>
          <span class="step-count" aria-label="${t("messages.stepsProcessed")}"></span>
        </div>
        <ol class="steps" role="list"></ol>
      </section>
    </main>
  `;
  shadow.querySelector('h1').textContent = t(title);
  shadow.querySelector('.scope').textContent = preview ? t("messages.preview") + ' · ' + t(scope) : t(scope);
  const status = shadow.querySelector('.status');
  const statusText = shadow.querySelector('.status-text');
  statusText.textContent = t("messages.preparingTheCheck");
  const note = shadow.querySelector('.note');
  const monitor = shadow.querySelector('.monitor');
  const elapsedTime = shadow.querySelector('.elapsed-time');
  const progress = shadow.querySelector('.progress');
  const count = shadow.querySelector('.step-count');
  const list = shadow.querySelector('.steps');
  const segments = steps.map(() => {
    const segment = document.createElement('span');
    segment.dataset.state = 'waiting';
    segment.setAttribute('aria-hidden', 'true');
    progress.append(segment);
    return segment;
  });
  const rows = steps.map(([name, detail]) => {
    const row = document.createElement('li');
    row.dataset.state = 'waiting';
    row.innerHTML = `<span class="step-marker" aria-hidden="true"></span>
      <details>
        <summary>
          <strong class="step-name"></strong>
          <span class="step-result"><span class="step-status"></span><small class="step-elapsed"></small></span>
        </summary>
        <div class="step-detail"></div>
        <div class="step-readout"></div>
        <ul class="step-children" hidden></ul>
      </details>`;
    row.querySelector('strong').textContent = t(name);
    row.querySelector('.step-detail').textContent = t(detail);
    row.querySelector('.step-status').textContent = t(labels.waiting);
    list.append(row);
    return row;
  });

  function updateProgress() {
    const processed = rows.filter(row => ['done', 'warning', 'error'].includes(row.dataset.state)).length;
    progress.setAttribute('aria-valuenow', processed);
    count.textContent = `${processed} / ${rows.length}`;
  }

  function updateClock() {
    const now = performance.now();
    const seconds = Math.floor((preview?.elapsed ?? (now - beganAt)) / 1000);
    elapsedTime.textContent = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
    elapsedTime.dateTime = `PT${seconds}S`;
    rows.forEach((row, index) => {
      if (row.dataset.state === 'running') {
        const duration = preview?.durations[index] ?? (now - started[index]);
        row.querySelector('.step-elapsed').textContent = `${(duration / 1000).toFixed(1)} ${t("messages.s")}`;
      }
    });
  }

  updateProgress();
  updateClock();
  const timer = preview ? undefined : window.setInterval(updateClock, 250);
  if (timer !== undefined) window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });

  function children(index, entries) {
    const list = rows[index].querySelector('.step-children');
    list.hidden = entries.length === 0;
    list.replaceChildren(...entries.map(({ name, state, elapsedMs, detail }) => {
      const item = document.createElement('li');
      item.className = 'step-child';
      item.dataset.state = state;
      const label = document.createElement('span');
      label.textContent = t(name);
      const result = document.createElement('span');
      result.className = 'child-result';
      result.textContent = [t(labels[state] ?? state), Number.isFinite(elapsedMs) ? `${Math.round(elapsedMs)} ${t("messages.ms")}` : null]
        .filter(Boolean).join(' · ');
      item.append(label, result);
      if (detail) {
        const description = document.createElement('small');
        description.textContent = t(detail);
        item.append(description);
      }
      return item;
    }));
  }

  function step(index, state, readings, entries) {
    const row = rows[index];
    if (state === 'running') started[index] ??= performance.now();
    else if (started[index] !== undefined) {
      const duration = preview?.durations[index] ?? (performance.now() - started[index]);
      row.querySelector('.step-elapsed').textContent = `${Math.round(duration)} ${t("messages.ms")}`;
    }
    row.dataset.state = state;
    segments[index].dataset.state = state;
    row.querySelector('.step-status').textContent = t(labels[state]);
    if (readings) {
      const items = readings.map(([label, ...values]) => {
        const item = document.createElement('span');
        item.textContent = t(label, ...values);
        return item;
      });
      row.querySelector('.step-readout').replaceChildren(...items);
    }
    if (entries) children(index, entries);
    updateProgress();
    updateClock();
  }

  function setStatus(state, text) {
    if (!host.isConnected) document.body.append(host);
    monitor.dataset.state = state;
    status.dataset.state = state;
    statusText.textContent = t(text);
    if (state !== 'running') {
      updateClock();
      window.clearInterval(timer);
    }
  }

  return {
    start(index, text) {
      step(index, 'running');
      setStatus('running', text);
    },
    step,
    children,
    finish(partial) {
      setStatus(partial ? 'warning' : 'done', partial ? "messages.checkCompleteSomeResultsNeedReview" : success);
      if (!preview) note.textContent = t("messages.thisTabWillCloseShortlyViewTheSnapshotIn");
    },
    fail(detail) {
      rows.forEach((row, index) => { if (row.dataset.state === 'running') step(index, 'error'); });
      setStatus('error', "messages.checkDidNotFinish");
      const message = t(detail);
      note.textContent = englishSelected && /\p{Script=Han}/u.test(message)
        ? t("messages.aCheckFailedReturnToPrismToSeeThe") : message;
    },
  };
}
