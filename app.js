const files = {
  repos: "data/repo-summary.csv",
  depth: "data/depth-histogram.csv",
  findings: "data/unique-findings.csv",
  osvs: "data/osvs-classified.csv"
};

const colors = {
  blue: "#2962a8",
  teal: "#087f8c",
  red: "#c4473c",
  amber: "#c47a19",
  green: "#2f7d46",
  violet: "#6d5794",
  gray: "#617080",
  light: "#d9e0e7"
};

const state = {
  repos: [],
  depth: [],
  findings: [],
  osvs: [],
  filters: {
    search: "",
    risk: "all",
    minTransitive: 0
  }
};

const tooltip = document.getElementById("tooltip");

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  );
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function format(value, decimals = 0) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  }).format(value);
}

function percent(value, decimals = 1) {
  return `${format(value, decimals)}%`;
}

function normalizeLabel(value) {
  return String(value)
    .replace("â‰¤", "<=")
    .replaceAll("â€“", "-");
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rank(values) {
  const sorted = [...values].map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let i = 0; i < sorted.length; i += 1) ranks[sorted[i].index] = i + 1;
  return ranks;
}

function correlation(rows, xKey, yKey, useRank = false) {
  const pairs = rows
    .map((row) => [number(row[xKey]), number(row[yKey])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 2) return 0;

  let xs = pairs.map(([x]) => x);
  let ys = pairs.map(([, y]) => y);
  if (useRank) {
    xs = rank(xs);
    ys = rank(ys);
  }

  const avgX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const avgY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  xs.forEach((x, index) => {
    const dx = x - avgX;
    const dy = ys[index] - avgY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  });

  return denomX && denomY ? numerator / Math.sqrt(denomX * denomY) : 0;
}

function showTip(event, html) {
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;
  tooltip.style.opacity = "1";
}

function hideTip() {
  tooltip.style.opacity = "0";
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function clear(id) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  return el;
}

function empty(el, message = "Sem dados para o filtro selecionado.") {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = message;
  el.appendChild(div);
}

function makeSvg(container, width = 760, height = 340) {
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  container.appendChild(svg);
  return { svg, width, height };
}

function axisText(svg, text, x, y, anchor = "middle") {
  const node = svgEl("text", { x, y, "text-anchor": anchor, fill: colors.gray, "font-size": 12 });
  node.textContent = text;
  svg.appendChild(node);
  return node;
}

function drawBarChart(id, data, options = {}) {
  const container = clear(id);
  if (!data.length) return empty(container);

  const { svg, width, height } = makeSvg(container);
  const margin = options.horizontal ? { top: 16, right: 34, bottom: 28, left: 172 } : { top: 16, right: 16, bottom: 64, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  for (let i = 0; i <= 4; i += 1) {
    const y = margin.top + innerH - (innerH * i) / 4;
    svg.appendChild(svgEl("line", { class: "grid-line", x1: margin.left, y1: y, x2: margin.left + innerW, y2: y }));
    if (!options.horizontal) axisText(svg, format((maxValue * i) / 4), margin.left - 8, y + 4, "end");
  }

  data.forEach((d, index) => {
    const fill = d.color || options.color || colors.blue;
    if (options.horizontal) {
      const rowH = innerH / data.length;
      const barH = Math.min(24, rowH * 0.66);
      const barW = (d.value / maxValue) * innerW;
      const y = margin.top + index * rowH + (rowH - barH) / 2;
      const rect = svgEl("rect", { class: "bar", x: margin.left, y, width: barW, height: barH, fill });
      rect.addEventListener("mousemove", (event) => showTip(event, `<strong>${d.label}</strong><br>${d.tooltip || format(d.value)}`));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
      axisText(svg, d.label, margin.left - 10, y + barH / 2 + 4, "end");
      axisText(svg, format(d.value), margin.left + barW + 8, y + barH / 2 + 4, "start");
    } else {
      const colW = innerW / data.length;
      const barW = Math.max(12, colW * 0.58);
      const barH = (d.value / maxValue) * innerH;
      const x = margin.left + index * colW + (colW - barW) / 2;
      const y = margin.top + innerH - barH;
      const rect = svgEl("rect", { class: "bar", x, y, width: barW, height: barH, fill });
      rect.addEventListener("mousemove", (event) => showTip(event, `<strong>${d.label}</strong><br>${d.tooltip || format(d.value)}`));
      rect.addEventListener("mouseleave", hideTip);
      svg.appendChild(rect);
      axisText(svg, d.label, x + barW / 2, margin.top + innerH + 18, "middle");
    }
  });
}

function drawDonut(id, data) {
  const container = clear(id);
  if (!data.length) return empty(container);

  const { svg, width, height } = makeSvg(container, 620, 280);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const cx = 145;
  const cy = 140;
  const radius = 92;
  const inner = 54;
  let angle = -Math.PI / 2;

  data.forEach((d) => {
    const slice = total ? (d.value / total) * Math.PI * 2 : 0;
    const end = angle + slice;
    const large = slice > Math.PI ? 1 : 0;
    const p1 = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    const p2 = [cx + radius * Math.cos(end), cy + radius * Math.sin(end)];
    const p3 = [cx + inner * Math.cos(end), cy + inner * Math.sin(end)];
    const p4 = [cx + inner * Math.cos(angle), cy + inner * Math.sin(angle)];
    const path = svgEl("path", {
      d: `M ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 ${large} 1 ${p2[0]} ${p2[1]} L ${p3[0]} ${p3[1]} A ${inner} ${inner} 0 ${large} 0 ${p4[0]} ${p4[1]} Z`,
      fill: d.color
    });
    path.addEventListener("mousemove", (event) => showTip(event, `<strong>${d.label}</strong><br>${format(d.value)} (${percent((d.value / total) * 100)})`));
    path.addEventListener("mouseleave", hideTip);
    svg.appendChild(path);
    angle = end;
  });

  axisText(svg, format(total), cx, cy - 4);
  axisText(svg, "total", cx, cy + 16);

  data.forEach((d, index) => {
    const y = 78 + index * 42;
    svg.appendChild(svgEl("rect", { x: 300, y: y - 13, width: 14, height: 14, fill: d.color, rx: 3 }));
    axisText(svg, d.label, 324, y, "start");
    axisText(svg, `${format(d.value)} | ${percent((d.value / total) * 100)}`, width - 16, y, "end");
  });
}

function drawScatter(id, rows) {
  const container = clear(id);
  if (!rows.length) return empty(container);

  const { svg, width, height } = makeSvg(container);
  const margin = { top: 18, right: 22, bottom: 54, left: 62 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const maxX = Math.max(...rows.map((row) => number(row.deps_transitive)), 1);
  const maxY = Math.max(...rows.map((row) => number(row.true_transitive)), 1);

  for (let i = 0; i <= 4; i += 1) {
    const x = margin.left + (innerW * i) / 4;
    const y = margin.top + innerH - (innerH * i) / 4;
    svg.appendChild(svgEl("line", { class: "grid-line", x1: margin.left, y1: y, x2: margin.left + innerW, y2: y }));
    svg.appendChild(svgEl("line", { class: "grid-line", x1: x, y1: margin.top, x2: x, y2: margin.top + innerH }));
    axisText(svg, format((maxX * i) / 4), x, margin.top + innerH + 20);
    axisText(svg, format((maxY * i) / 4), margin.left - 8, y + 4, "end");
  }

  rows.forEach((row) => {
    const x = margin.left + (number(row.deps_transitive) / maxX) * innerW;
    const y = margin.top + innerH - (number(row.true_transitive) / maxY) * innerH;
    const density = number(row.transitive_density_strict_pct);
    const fill = density >= 50 ? colors.red : density >= 20 ? colors.amber : density > 0 ? colors.teal : colors.gray;
    const circle = svgEl("circle", { class: "dot", cx: x, cy: y, r: 4.5, fill, opacity: 0.78 });
    circle.addEventListener("mousemove", (event) =>
      showTip(
        event,
        `<strong>${row.repo}</strong><br>Deps transitivas: ${format(number(row.deps_transitive))}<br>True transitive: ${format(number(row.true_transitive))}<br>Densidade: ${percent(density)}`
      )
    );
    circle.addEventListener("mouseleave", hideTip);
    svg.appendChild(circle);
  });

  axisText(svg, "Dependências transitivas", margin.left + innerW / 2, height - 12);
  axisText(svg, "True transitive vulns", 14, margin.top + innerH / 2, "middle").setAttribute("transform", `rotate(-90 14 ${margin.top + innerH / 2})`);
}

function bucketDeps(rows) {
  const buckets = [
    { label: "0-99", min: 0, max: 99, value: 0 },
    { label: "100-249", min: 100, max: 249, value: 0 },
    { label: "250-499", min: 250, max: 499, value: 0 },
    { label: "500-999", min: 500, max: 999, value: 0 },
    { label: "1000+", min: 1000, max: Infinity, value: 0 }
  ];

  rows.forEach((row) => {
    const deps = number(row.deps_transitive);
    const bucket = buckets.find((item) => deps >= item.min && deps <= item.max);
    if (bucket) bucket.value += 1;
  });
  return buckets;
}

function bucketAges(rows) {
  const buckets = [
    { label: "<=30d", min: 0, max: 30, value: 0 },
    { label: "31-90d", min: 31, max: 90, value: 0 },
    { label: "91-180d", min: 91, max: 180, value: 0 },
    { label: "181-365d", min: 181, max: 365, value: 0 },
    { label: "1-2 anos", min: 366, max: 730, value: 0 },
    { label: "2-3 anos", min: 731, max: 1095, value: 0 },
    { label: "3+ anos", min: 1096, max: Infinity, value: 0 }
  ];

  rows.forEach((row) => {
    const age = number(row.days_since_publication);
    const bucket = buckets.find((item) => age >= item.min && age <= item.max);
    if (bucket) bucket.value += 1;
  });

  return buckets.map((bucket) => ({
    label: bucket.label,
    value: bucket.value,
    color: bucket.min >= 366 ? colors.red : colors.teal,
    tooltip: `${format(bucket.value)} vulnerabilidades`
  }));
}

function aggregateDepth(rows, repoNames = null) {
  const totals = new Map();
  rows.forEach((row) => {
    if (repoNames && !repoNames.has(row.repo)) return;
    const depth = row.depth || "0";
    totals.set(depth, (totals.get(depth) || 0) + number(row.vulns_at_depth));
  });
  return [...totals.entries()]
    .sort((a, b) => number(a[0]) - number(b[0]))
    .map(([depth, value]) => ({ label: `Depth ${depth}`, value, color: colors.violet }));
}

function filteredRepos() {
  return state.repos.filter((row) => {
    const density = number(row.transitive_density_strict_pct);
    const transitive = number(row.true_transitive);
    const matchesSearch = row.repo.toLowerCase().includes(state.filters.search);
    const matchesMin = transitive >= state.filters.minTransitive;
    const matchesRisk =
      state.filters.risk === "all" ||
      (state.filters.risk === "high" && density >= 50) ||
      (state.filters.risk === "medium" && density >= 20 && density < 50) ||
      (state.filters.risk === "low" && density > 0 && density < 20) ||
      (state.filters.risk === "none" && transitive === 0);
    return matchesSearch && matchesMin && matchesRisk;
  });
}

function renderKpis(rows) {
  const total = rows.length;
  const withTransitive = rows.filter((row) => number(row.true_transitive) > 0).length;
  const inGraph = rows.reduce((sum, row) => sum + number(row.in_graph), 0);
  const trueTransitive = rows.reduce((sum, row) => sum + number(row.true_transitive), 0);
  const medianAge = median(rows.map((row) => number(row.median_vuln_age_days)));
  const avgInertia = rows.reduce((sum, row) => sum + number(row.avg_inertia_tags), 0) / Math.max(rows.length, 1);

  const kpis = [
    ["Repositórios", format(total), "Projetos Go no recorte filtrado"],
    ["Com transitivas", percent(total ? (withTransitive / total) * 100 : 0), `${format(withTransitive)} repositórios afetados`],
    ["Vulns true transitive", percent(inGraph ? (trueTransitive / inGraph) * 100 : 0), `${format(trueTransitive)} de ${format(inGraph)} vulnerabilidades in graph`],
    ["Mediana do débito", `${format(medianAge)} d`, "Dias desde a publicação da OSV"],
    ["Inércia média", format(avgInertia, 1), "Tags lançadas após publicação"]
  ];

  document.getElementById("kpis").innerHTML = kpis
    .map(([label, value, help]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`)
    .join("");
}

function renderTable(rows) {
  const tbody = document.getElementById("repoTable");
  tbody.innerHTML = rows
    .slice()
    .sort((a, b) => number(b.true_transitive) - number(a.true_transitive))
    .slice(0, 25)
    .map(
      (row) => `<tr>
        <td>${row.repo}</td>
        <td>${format(number(row.in_graph))}</td>
        <td>${format(number(row.true_transitive))}</td>
        <td>${percent(number(row.transitive_density_strict_pct))}</td>
        <td>${format(number(row.deps_transitive))}</td>
        <td>${format(number(row.median_vuln_age_days))} d</td>
        <td>${format(number(row.max_depth))}</td>
      </tr>`
    )
    .join("");
}

function render() {
  const rows = filteredRepos();
  const repoNames = new Set(rows.map((row) => row.repo));
  const selectedOsvs = state.osvs.filter((row) => repoNames.has(row.repo));
  renderKpis(rows);

  drawBarChart(
    "depsHistogram",
    bucketDeps(rows).map((bucket) => ({ ...bucket, color: colors.blue, tooltip: `${format(bucket.value)} repositórios` }))
  );

  const explicit = rows.reduce((sum, row) => sum + number(row.explicit_direct), 0);
  const implicit = rows.reduce((sum, row) => sum + number(row.implicit_direct), 0);
  const transitive = rows.reduce((sum, row) => sum + number(row.transitive), 0);
  drawDonut("compositionChart", [
    { label: "Explicit direct", value: explicit, color: colors.blue },
    { label: "Implicit direct", value: implicit, color: colors.amber },
    { label: "Transitive depth >= 2", value: transitive, color: colors.red }
  ]);

  const withTransitive = rows.filter((row) => number(row.true_transitive) > 0).length;
  drawDonut("prevalenceChart", [
    { label: "Com true transitive", value: withTransitive, color: colors.red },
    { label: "Sem true transitive", value: rows.length - withTransitive, color: colors.green }
  ]);

  const topRepos = rows
    .slice()
    .sort((a, b) => number(b.true_transitive) - number(a.true_transitive))
    .slice(0, 10)
    .map((row) => ({
      label: row.repo.length > 24 ? `...${row.repo.slice(-21)}` : row.repo,
      value: number(row.true_transitive),
      color: colors.red,
      tooltip: `${row.repo}<br>${format(number(row.true_transitive))} vulnerabilidades true transitive`
    }));
  drawBarChart("topReposChart", topRepos, { horizontal: true });

  drawBarChart("ageBucketsChart", bucketAges(selectedOsvs));

  const debtRepos = rows
    .slice()
    .filter((row) => number(row.median_vuln_age_days) > 0)
    .sort((a, b) => number(b.median_vuln_age_days) - number(a.median_vuln_age_days))
    .slice(0, 10)
    .map((row) => ({
      label: row.repo.length > 24 ? `...${row.repo.slice(-21)}` : row.repo,
      value: number(row.median_vuln_age_days),
      color: colors.amber,
      tooltip: `${row.repo}<br>Mediana: ${format(number(row.median_vuln_age_days))} dias`
    }));
  drawBarChart("debtReposChart", debtRepos, { horizontal: true });

  drawScatter("scatterChart", rows);
  const pearson = correlation(rows, "deps_transitive", "true_transitive");
  const spearman = correlation(rows, "deps_transitive", "true_transitive", true);
  document.getElementById("corrBadge").textContent = `r ${pearson.toFixed(2)} | rho ${spearman.toFixed(2)}`;

  drawBarChart("depthChart", aggregateDepth(state.depth, repoNames), { horizontal: true });
  renderTable(rows);
}

async function load() {
  document.querySelectorAll(".chart").forEach((el) => {
    el.innerHTML = '<div class="loading">Carregando dados...</div>';
  });

  const [reposText, depthText, findingsText, osvsText] = await Promise.all(
    Object.values(files).map((file) => fetch(file).then((response) => response.text()))
  );

  state.repos = parseCSV(reposText);
  state.depth = parseCSV(depthText);
  state.findings = parseCSV(findingsText);
  state.osvs = parseCSV(osvsText);

  const maxTransitive = Math.max(...state.repos.map((row) => number(row.true_transitive)), 0);
  const slider = document.getElementById("minTransitive");
  slider.max = String(Math.ceil(maxTransitive / 10) * 10);

  document.getElementById("repoSearch").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });

  document.getElementById("riskFilter").addEventListener("change", (event) => {
    state.filters.risk = event.target.value;
    render();
  });

  slider.addEventListener("input", (event) => {
    state.filters.minTransitive = number(event.target.value);
    document.getElementById("minTransitiveLabel").textContent = format(state.filters.minTransitive);
    render();
  });

  render();
}

load().catch((error) => {
  document.body.innerHTML = `<main><div class="panel"><h1>Erro ao carregar dados</h1><p>${error.message}</p><p>Execute um servidor local na pasta do projeto para permitir a leitura dos CSVs.</p></div></main>`;
});
