import { escapeHtml } from '../helpers.js';
import { t } from '../i18n.js';
import { eventDisplayName, eventIcon } from './estado.js';

// The Análisis tab (activity / technical log / energy) was removed from
// the WebUI. The daemon still writes the journal, the log and the energy
// log; what is left here are the pure helpers Inicio's "recent activity"
// and savings bar use to read those files.

export function parseJournalLines(text) {
  return text.split('\n').filter((l) => l.trim().length).map((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === 'object' && obj.ts && obj.severity && obj.message) return obj;
    } catch (e) { /* skip unparseable line */ }
    return null;
  }).filter(Boolean);
}

// BUG FIX (reported: "Arranque" entrando y saliendo continuamente en
// Actividad, sin forma de saber en qué modo está de verdad de fondo).
// Root cause isn't in the event logic itself - "boot" only ever
// activates once, in init_v2() at daemon startup, and state_reconcile()
// (PowerSentinel-state.sh) correctly undoes whatever the PREVIOUS run
// left active before that. Chained together, those are exactly right -
// but if the daemon itself is dying and getting relaunched repeatedly
// (a crash, an OOM kill - service.sh's own watchdog checks every 60s
// and relaunches it whenever this happens), EVERY relaunch produces
// this exact "boot ended" (state_reconcile undoing the crashed run's
// stale boot) immediately followed by a fresh "boot started" - daemon-
// internal bookkeeping noise from an invisible restart, not a
// meaningful mode change a person asked to see. Filters out any
// "boot ended" immediately followed by a "boot started" within 15
// real seconds - generous enough to catch a relaunch (which happens
// within a second or two) while never touching a genuine, deliberately
// re-triggered boot event, which wouldn't happen anywhere near that
// fast. Applied once here so every view built from journal entries
// (Actividad, Inicio's own recent-activity list, today's intervention
// count) is consistent - none of them should show or count restart
// noise as if it were something that happened.
export function filterBootRestartNoise(entries) {
  const result = [];
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const next = entries[i + 1];
    if (cur.event === 'boot' && cur.message === 'boot ended' &&
        next && next.event === 'boot' && next.message === 'boot started' &&
        (next.ts - cur.ts) <= 15) {
      i++; // skip both - a daemon restart, not a real transition
      continue;
    }
    result.push(cur);
  }
  return result;
}

function formatJournalTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// "Timeline de actividad" del roadmap: convierte las entradas ya
// existentes del journal ("night started" + su detalle de mecanismos
// resueltos, "night ended", avisos de capacidad) en algo legible,
// reutilizando exactamente el mismo icono/nombre de evento que ya usa
// el dashboard de Estado (eventDisplayName/eventIcon), para que un
// mismo evento se vea siempre igual en toda la app.
function timelineMechanismPhrases(detail) {
  if (!detail) return [];
  const on = (v) => v && v !== 'false';
  const phrases = [];
  if (on(detail.handle_cores)) phrases.push(t('journal.mechCores'));
  if (detail.doze === 'light') phrases.push(t('journal.mechDozeLight'));
  else if (detail.doze === 'deep') phrases.push(t('journal.mechDozeDeep'));
  if (on(detail.handle_apps)) phrases.push(t('journal.mechApps'));
  if (on(detail.handle_gms)) phrases.push(t('journal.mechGms'));
  if (detail.kill_wifi === 'true') phrases.push(t('journal.mechWifi'));
  if (detail.restrict_data === 'true') phrases.push(t('journal.mechDataSaver'));
  if (detail.tune_system === 'true') phrases.push(t('journal.mechTuneSystem'));
  if (detail.radio_lte === 'true') phrases.push(t('journal.mechRadioLte'));
  if (detail.low_ram === 'true') phrases.push(t('journal.mechLowRam'));
  return phrases;
}

// Rediseño visual del timeline (redesign item "timeline mucho más
// visual"): un carril vertical propio (.timeline-rail) para el punto,
// con la línea de conexión dibujada en CSS entre entradas consecutivas
// - antes el punto vivía inline junto al texto, sin ninguna relación
// visual entre una entrada y la siguiente. La estructura (rail + body)
// es la MISMA para las 4 variantes (started/ended/warning/genérica);
// solo cambian el color del punto y el contenido.
function timelineEntryHtml(dotCls, time, mainHtml, subLines) {
  const subHtml = (subLines || []).map((s) =>
    `<div class="timeline-sub">${s}</div>`
  ).join('');
  return `<div class="timeline-entry">` +
    `<div class="timeline-rail"><span class="timeline-dot ${dotCls}"></span></div>` +
    `<div class="timeline-body">` +
    `<div class="timeline-main"><span class="timeline-time">${time}</span>${mainHtml}</div>` +
    subHtml +
    `</div></div>`;
}

export function renderTimelineEntry(entry) {
  const time = formatJournalTime(entry.ts);
  if (entry.severity === 'warning' || entry.severity === 'critical') {
    return timelineEntryHtml('dot-warn', time, `⚠️ ${escapeHtml(entry.message)}`);
  }
  const startedMatch = /^(.+) started$/.exec(entry.message);
  const endedMatch = /^(.+) ended$/.exec(entry.message);
  if (startedMatch) {
    const name = eventDisplayName(entry.event);
    const phrases = timelineMechanismPhrases(entry.detail);
    return timelineEntryHtml('dot-start', time,
      `${eventIcon(entry.event)} ${escapeHtml(t('journal.entered', { mode: name }))}`,
      phrases.map((p) => escapeHtml(p)));
  }
  if (endedMatch) {
    const name = eventDisplayName(entry.event);
    return timelineEntryHtml('dot-end', time,
      `${eventIcon(entry.event)} ${escapeHtml(t('journal.exited', { mode: name }))}`,
      [escapeHtml(t('journal.restored'))]);
  }
  // Cualquier otra entrada (appwatch, safemode...) - misma estructura
  // rail+body que el resto, en vez del bloque "log-line" con badge que
  // usaba antes, para que la línea de conexión no se rompa cuando el
  // journal mezcla este tipo de entradas con transiciones de evento.
  const isCritical = entry.severity === 'critical';
  const badgeCls = isCritical ? 'critical' : 'info';
  const badgeLabel = isCritical ? t('log.severityCritical') : t('log.severityInfo');
  return timelineEntryHtml(isCritical ? 'dot-warn' : 'dot-end', time,
    `<span class="journal-badge ${badgeCls}">${escapeHtml(badgeLabel)}</span>${escapeHtml(entry.message)}`);
}

// ---------- Energy log analysis ----------
// The daemon only ever collects this (PowerSentinel-energylog.sh) -
// deliberately no analysis or conclusions baked in there, since
// building a view before there was real data to look at would mean
// guessing what the data would even look like. Now that samples
// genuinely accumulate over real usage, this is that follow-up.
//
// A malformed/unparseable line is skipped rather than breaking the
// whole render, same reasoning as parseJournalLines above - the file
// could in principle be read mid-write.
export function parseEnergyLines(text) {
  return text.split('\n').filter((l) => l.trim().length).map((line) => {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj.ts === 'number' && typeof obj.battery === 'number') return obj;
    } catch (e) { /* skip unparseable line */ }
    return null;
  }).filter(Boolean).sort((a, b) => a.ts - b.ts);
}

// Attributes each interval's battery drop to whatever was active at
// the START of that interval, then averages minutes-per-1%-battery
// per distinct "regime" (the exact active-events string at the time) -
// directly answering the project's own stated goal of checking
// whether a given setting genuinely slows discharge, rather than
// assuming it does. Charging intervals are excluded entirely (a
// battery going up, or holding steady while plugged in, isn't a
// "Salud energética" del roadmap: consumo reciente (%/h) y comparación
// con la media histórica - la MISMA función sirve para ambas ventanas,
// solo cambia cuántas horas hacia atrás se consideran. Reutiliza
// exactamente la misma exclusión de tramos cargando ya establecida en
// computeDischargeRates (una batería subiendo o estable enchufada no
// es una tasa de descarga real).
export function computeRecentRate(samples, hoursBack) {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const cutoff = hoursBack ? last.ts - hoursBack * 3600 : -Infinity;
  const scoped = samples.filter((s) => s.ts >= cutoff);
  let totalDrop = 0, totalSeconds = 0;
  for (let i = 1; i < scoped.length; i++) {
    const prev = scoped[i - 1], cur = scoped[i];
    if (prev.charging === 'true' || cur.charging === 'true') continue;
    const drop = prev.battery - cur.battery;
    const seconds = cur.ts - prev.ts;
    if (drop <= 0 || seconds <= 0) continue;
    totalDrop += drop;
    totalSeconds += seconds;
  }
  if (totalSeconds === 0) return null;
  return totalDrop / (totalSeconds / 3600);
}
