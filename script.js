const API_BASE = 'https://metroroute.onrender.com';

const fromSelect       = document.getElementById('from-station');
const toInput          = document.getElementById('to-station');
const toSuggestions    = document.getElementById('to-suggestions');
const findBtn          = document.getElementById('find-route-btn');
const swapBtn          = document.getElementById('swap-btn');
const errorMsg         = document.getElementById('error-msg');
const loading          = document.getElementById('loading');
const results          = document.getElementById('results');
const statStops        = document.getElementById('stat-stops');
const statLines        = document.getElementById('stat-lines');
const statFrom         = document.getElementById('stat-from');
const statTo           = document.getElementById('stat-to');
const interchangeBadge = document.getElementById('interchange-badge');
const segmentsContainer = document.getElementById('segments-container');
const mapsLink         = document.getElementById('maps-link');
const nearestInfo      = document.getElementById('nearest-info');

let stationsData   = { purple: [], green: [] };
let allStationNames = new Set();

/* ---- Init ---- */
async function initStations() {
  try {
    const res  = await fetch(`${API_BASE}/stations`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    stationsData.purple = Array.isArray(data.purple) ? data.purple : [];
    stationsData.green  = Array.isArray(data.green)  ? data.green  : [];
    allStationNames = new Set([...stationsData.purple, ...stationsData.green]);

    populateDropdowns();
    enableControls();
  } catch (err) {
    showError('Could not connect to the metro API. Is the server running at ' + API_BASE + '?');
    console.error(err);
  }
}

function populateDropdowns() {
  const purpleSorted = [...stationsData.purple].sort((a, b) => a.localeCompare(b));
  const greenSorted  = [...stationsData.green].sort((a, b) => a.localeCompare(b));

  // From — dropdown with optgroups
  fromSelect.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = 'Select departure station...';
  ph.disabled = true; ph.selected = true;
  fromSelect.appendChild(ph);

  [['— Purple Line —', purpleSorted], ['— Green Line —', greenSorted]].forEach(([label, list]) => {
    if (!list.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    list.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      group.appendChild(opt);
    });
    fromSelect.appendChild(group);
  });

}

function enableControls() {
  fromSelect.disabled = false;
  toInput.disabled    = false;
  findBtn.disabled    = false;
  swapBtn.disabled    = false;
}

/* ---- Autocomplete for "To" field ---- */
let acActiveIdx = -1;

function showSuggestions(query) {
  const q = query.trim().toLowerCase();
  toSuggestions.innerHTML = '';
  acActiveIdx = -1;

  if (!q) { toSuggestions.classList.add('hidden'); return; }

  const matches = [...allStationNames]
    .filter(n => n.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.toLowerCase().startsWith(q);
      const bStarts = b.toLowerCase().startsWith(q);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return a.localeCompare(b);
    })
    .slice(0, 10);

  if (!matches.length) { toSuggestions.classList.add('hidden'); return; }

  matches.forEach(name => {
    const li = document.createElement('li');
    li.className = 'autocomplete-item';
    const idx = name.toLowerCase().indexOf(q);
    li.innerHTML = name.slice(0, idx)
      + `<mark>${name.slice(idx, idx + q.length)}</mark>`
      + name.slice(idx + q.length);
    li.addEventListener('mousedown', e => {
      e.preventDefault();
      toInput.value = name;
      closeSuggestions();
      clearError();
    });
    toSuggestions.appendChild(li);
  });

  toSuggestions.classList.remove('hidden');
}

function closeSuggestions() {
  toSuggestions.classList.add('hidden');
  acActiveIdx = -1;
}

toInput.addEventListener('input', () => showSuggestions(toInput.value));

toInput.addEventListener('keydown', e => {
  const items = toSuggestions.querySelectorAll('.autocomplete-item');
  if (toSuggestions.classList.contains('hidden') || !items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acActiveIdx = Math.min(acActiveIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acActiveIdx = Math.max(acActiveIdx - 1, -1);
  } else if (e.key === 'Enter' && acActiveIdx >= 0) {
    e.stopPropagation();
    toInput.value = items[acActiveIdx].textContent;
    closeSuggestions();
    clearError();
    return;
  } else if (e.key === 'Escape') {
    closeSuggestions();
    return;
  } else {
    return;
  }

  items.forEach((el, i) => el.classList.toggle('active', i === acActiveIdx));
  if (acActiveIdx >= 0) items[acActiveIdx].scrollIntoView({ block: 'nearest' });
});

toInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

/* ---- Swap (only if To is also a metro station) ---- */
swapBtn.addEventListener('click', () => {
  const fromVal = fromSelect.value;
  const toVal   = toInput.value.trim();
  if (fromVal && toVal && allStationNames.has(toVal)) {
    fromSelect.value = toVal;
    toInput.value    = fromVal;
    clearError();
  } else if (toVal && !allStationNames.has(toVal)) {
    showError('Cannot swap — destination is not a metro station.');
  }
});

/* ---- Find Route ---- */
findBtn.addEventListener('click', findRoute);
[fromSelect, toInput].forEach(el => {
  el.addEventListener('change', clearError);
  el.addEventListener('input',  clearError);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') findRoute(); });
});

async function findRoute() {
  const from = fromSelect.value.trim();
  const to   = toInput.value.trim();

  if (!from || !to) {
    showError('Please fill in both departure and destination.');
    return;
  }

  clearError();
  showLoading(true);
  hideResults();
  hideNearestInfo();

  try {
    let routeEnd   = to;
    let nearestData = null;

    if (!allStationNames.has(to)) {
      // Geocode and find nearest metro
      const nRes = await fetch(`${API_BASE}/nearest-station?location=${encodeURIComponent(to)}`);
      if (!nRes.ok) {
        const body = await nRes.json().catch(() => ({}));
        throw new Error(body.detail || `Could not locate "${to}"`);
      }
      nearestData = await nRes.json();
      routeEnd    = nearestData.nearest_station;
    }

    if (from === routeEnd) {
      showLoading(false);
      showError(
        nearestData
          ? `You're already at ${from}, the nearest metro to "${to}".`
          : 'Departure and destination are the same station.'
      );
      return;
    }

    const rRes = await fetch(
      `${API_BASE}/get-route?start=${encodeURIComponent(from)}&end=${encodeURIComponent(routeEnd)}`
    );
    if (!rRes.ok) {
      const body = await rRes.json().catch(() => ({}));
      throw new Error(body.detail || `Server error (${rRes.status})`);
    }

    const data = await rRes.json();
    showLoading(false);
    renderResults(data, from, routeEnd);

    if (nearestData) renderNearestInfo(to, nearestData);

  } catch (err) {
    showLoading(false);
    showError(err.message || 'Something went wrong. Please try again.');
    console.error(err);
  }
}

/* ---- Nearest station card ---- */
function renderNearestInfo(typedDest, nd) {
  document.getElementById('nearest-destination-label').textContent = typedDest;
  document.getElementById('nearest-station-name').textContent      = nd.nearest_station;
  document.getElementById('nearest-distance').textContent          = nd.distance_km;
  document.getElementById('nearest-walk-min').textContent          = nd.walk_minutes;
  const link = document.getElementById('nearest-walk-link');
  link.href = nd.walk_maps_link;
  nearestInfo.classList.remove('hidden');
}

function hideNearestInfo() { nearestInfo.classList.add('hidden'); }

/* ---- Render route results ---- */
function renderResults(data, from, to) {
  statStops.textContent = data.stops ?? '—';
  statFrom.textContent  = shortenName(from);
  statTo.textContent    = shortenName(to);

  const linesArr = Array.isArray(data.lines) ? data.lines : [];
  statLines.textContent = linesArr.length
    ? linesArr.map(l => l.replace(' Line', '')).join(' + ')
    : '—';

  interchangeBadge.classList.toggle('hidden', !data.interchange);

  segmentsContainer.innerHTML = '';
  const directions = Array.isArray(data.directions) ? data.directions : [];

  if (!directions.length && Array.isArray(data.route)) {
    const colorKey = (linesArr[0] || '').toLowerCase().includes('green') ? 'green' : 'purple';
    segmentsContainer.appendChild(
      buildSegmentCard(
        { segment: linesArr[0] || 'Metro Line', direction: '', stations: data.route },
        colorKey, data.interchange_station, 0, 1
      )
    );
  } else {
    directions.forEach((dir, idx) => {
      segmentsContainer.appendChild(
        buildSegmentCard(dir, getColorKey(dir.segment), data.interchange_station, idx, directions.length)
      );
    });
  }

  mapsLink.href = data.maps_link || '#';
  mapsLink.classList.toggle('hidden', !data.maps_link);

  showResults();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildSegmentCard(dir, colorKey, interchangeStation, segIdx, totalSegs) {
  const stations = Array.isArray(dir.stations) ? dir.stations : [];
  const card = document.createElement('div');
  card.className = 'segment-card';

  // Header
  const header = document.createElement('div');
  header.className = 'segment-header';

  const dot = document.createElement('span');
  dot.className = `segment-line-dot ${colorKey}`;

  const info = document.createElement('div');
  info.className = 'segment-info';
  info.innerHTML = `<div class="segment-line-name">${dir.segment || 'Metro Line'}</div>`;
  if (dir.direction) {
    info.innerHTML += `<div class="segment-direction">${dir.direction}</div>`;
  }

  const count = document.createElement('span');
  count.className = `segment-count ${colorKey}`;
  const n = stations.length - 1;
  count.textContent = n > 0 ? `${n} stop${n !== 1 ? 's' : ''}` : '1 station';

  header.appendChild(dot);
  header.appendChild(info);
  header.appendChild(count);
  card.appendChild(header);

  // Timeline
  const timeline = document.createElement('div');
  timeline.className = 'timeline';

  stations.forEach((name, idx) => {
    const isFirst       = idx === 0;
    const isLast        = idx === stations.length - 1;
    const isInterchange = interchangeStation && name.toLowerCase() === interchangeStation.toLowerCase();
    const isStart       = segIdx === 0 && isFirst;
    const isEnd         = segIdx === totalSegs - 1 && isLast;

    const item = document.createElement('div');
    item.className = 'timeline-item';

    const left = document.createElement('div');
    left.className = 'timeline-left';

    const dotEl = document.createElement('div');
    let dc = `timeline-dot ${colorKey}`;
    if (isInterchange) dc += ' interchange-stop';
    else if (isStart)  dc += ' first-station';
    else if (isEnd)    dc += ' last-station';
    dotEl.className = dc;
    left.appendChild(dotEl);

    if (!isLast) {
      const connector = document.createElement('div');
      connector.className = `timeline-connector ${colorKey}`;
      left.appendChild(connector);
    }

    const content = document.createElement('div');
    content.className = 'timeline-content';

    const nameEl = document.createElement('span');
    let nc = 'station-name';
    if (isInterchange) nc += ' interchange-stop';
    else if (isStart)  nc += ' first-station';
    else if (isEnd)    nc += ' last-station';
    nameEl.className = nc;
    nameEl.textContent = name;
    content.appendChild(nameEl);

    if (isInterchange) content.appendChild(makeTag('Interchange', 'tag-interchange'));
    else if (isStart)  content.appendChild(makeTag('Start', 'tag-start'));
    else if (isEnd)    content.appendChild(makeTag('End', 'tag-end'));

    item.appendChild(left);
    item.appendChild(content);
    timeline.appendChild(item);
  });

  card.appendChild(timeline);
  return card;
}

function makeTag(text, cls) {
  const tag = document.createElement('span');
  tag.className = `station-tag ${cls}`;
  tag.textContent = text;
  return tag;
}

function getColorKey(seg) {
  return (seg || '').toLowerCase().includes('green') ? 'green' : 'purple';
}

function shortenName(name) {
  return name.length > 18 ? name.slice(0, 16) + '…' : name;
}

function showError(msg)  { errorMsg.textContent = msg; errorMsg.classList.remove('hidden'); }
function clearError()    { errorMsg.textContent = '';  errorMsg.classList.add('hidden'); }
function showLoading(on) { loading.classList.toggle('hidden', !on); }
function showResults()   { results.classList.remove('hidden'); }
function hideResults()   { results.classList.add('hidden'); }

initStations();
