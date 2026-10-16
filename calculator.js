(() => {
  const ITERATIONS = 100000;
  const PASTELS = ["#CBD5E1", "#C7D2FE", "#A5F3FC", "#DDD6FE", "#FDE68A", "#A7F3D0", "#FBCFE8", "#BFDBFE", "#99F6E4", "#FED7AA"];
  let variants = [];

  const $ = (selector) => document.querySelector(selector);
  const id = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const defaults = () => [
    { id: id(), name: "Control", samples: 8500, conversions: 1410, isControl: true },
    { id: id(), name: "Variant A", samples: 8500, conversions: 1500, isControl: false }
  ];
  const percent = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;
  const xml = (value) => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

  function renderVariants() {
    $("#variants").innerHTML = variants.map(variant => `
      <div class="variant-row" data-id="${variant.id}">
        <label>Variant
          <input data-field="name" type="text" value="${xml(variant.name)}" ${variant.isControl ? "disabled" : ""}>
        </label>
        <label>Samples
          <input data-field="samples" type="number" min="0" step="1" value="${variant.samples}">
        </label>
        <label>Conversions
          <input data-field="conversions" type="number" min="0" step="1" value="${variant.conversions}">
        </label>
        <button class="remove" type="button" ${variant.isControl ? "disabled" : ""} aria-label="Remove ${xml(variant.name)}">Remove</button>
      </div>`).join("");
  }

  function readInputs() {
    document.querySelectorAll(".variant-row").forEach(row => {
      const variant = variants.find(item => item.id === row.dataset.id);
      row.querySelectorAll("input").forEach(input => {
        variant[input.dataset.field] = input.dataset.field === "name" ? input.value.trim() : Number(input.value);
      });
    });
  }

  function normalSample() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function gammaSample(shape) {
    if (shape < 1) return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do { x = normalSample(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  function betaSample(alpha, beta) {
    const x = gammaSample(alpha);
    const y = gammaSample(beta);
    return x / (x + y);
  }

  function calculateBayesianResults() {
    const controlIndex = variants.findIndex(variant => variant.isControl);
    const wins = variants.map(() => 0);
    const beatsControl = variants.map(() => 0);
    const losses = variants.map(() => 0);
    const upliftSamples = variants.map(() => []);

    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const rates = variants.map(variant => betaSample(variant.conversions + 1, variant.samples - variant.conversions + 1));
      const controlRate = rates[controlIndex];
      let bestIndex = 0;
      for (let index = 1; index < rates.length; index++) if (rates[index] > rates[bestIndex]) bestIndex = index;
      wins[bestIndex]++;
      const bestRate = rates[bestIndex];
      rates.forEach((rate, index) => {
        if (index === controlIndex || rate > controlRate) beatsControl[index]++;
        losses[index] += bestRate > 0 ? (bestRate - rate) / bestRate : 0;
        if (index !== controlIndex && controlRate > 0) upliftSamples[index].push((rate - controlRate) / controlRate);
      });
    }

    return variants.map((variant, index) => {
      const sorted = upliftSamples[index].sort((a, b) => a - b);
      return {
        ...variant,
        conversionRate: variant.conversions / variant.samples,
        probabilityBest: wins[index] / ITERATIONS,
        probabilityBeatControl: beatsControl[index] / ITERATIONS,
        expectedLoss: losses[index] / ITERATIONS,
        upliftInterval: sorted.length ? [sorted[Math.floor(sorted.length * .025)], sorted[Math.floor(sorted.length * .975)]] : [0, 0]
      };
    });
  }

  function validate() {
    if (variants.length < 2) return "Add at least one variant alongside the control.";
    for (const variant of variants) {
      if (!variant.name) return "Every variant needs a name.";
      if (!Number.isInteger(variant.samples) || !Number.isInteger(variant.conversions)) return "Samples and conversions must be whole numbers.";
      if (variant.samples <= 0) return `${variant.name} must have at least one sample.`;
      if (variant.conversions < 0 || variant.conversions > variant.samples) return `${variant.name} cannot have more conversions than samples.`;
    }
    return "";
  }

  function niceTicks(max, count = 5) {
    if (max <= 0) return [0, 1];
    const raw = max / count;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const fraction = raw / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    const step = nice * power;
    const ceiling = Math.ceil(max / step) * step;
    return Array.from({length: Math.round(ceiling / step) + 1}, (_, i) => i * step);
  }

  function horizontalChart({ title, subtitle, data, valueKey, maxValue, reference, colours = true, interval = false }) {
    const width = 1000, height = 170, left = 125, right = 38, top = 13, bottom = 30;
    const plotWidth = width - left - right;
    const rowHeight = (height - top - bottom) / Math.max(data.length, 1);
    const values = interval ? data.flatMap(item => [item.low, item.high]) : data.map(item => item[valueKey]);
    let min = interval ? Math.min(0, ...values) : 0;
    let max = maxValue ?? Math.max(...values, 1);
    if (interval) {
      const padding = Math.max((max - min) * .08, .5);
      min -= padding; max += padding;
    }
    const x = value => left + ((value - min) / (max - min || 1)) * plotWidth;
    const ticks = interval ? Array.from({length: 6}, (_, i) => min + (max - min) * i / 5) : niceTicks(max);
    const grid = ticks.map(tick => `<line class="grid-line" x1="${x(tick)}" y1="${top}" x2="${x(tick)}" y2="${height-bottom}"/><text class="axis-label" x="${x(tick)}" y="${height-8}" text-anchor="middle">${tick.toFixed(tick < 10 ? 1 : 0)}%</text>`).join("");
    const refLine = reference === undefined ? "" : `<line class="reference-line" x1="${x(reference)}" y1="${top}" x2="${x(reference)}" y2="${height-bottom}"/><text class="axis-label" x="${x(reference)-4}" y="${top+10}" text-anchor="end">${reference.toFixed(1)}%</text>`;
    const zeroLine = interval ? `<line class="zero-line" x1="${x(0)}" y1="${top}" x2="${x(0)}" y2="${height-bottom}"/>` : "";
    const bars = data.map((item, index) => {
      const cy = top + rowHeight * index + rowHeight / 2;
      const barHeight = Math.min(18, rowHeight * .42);
      const start = interval ? x(item.low) : x(0);
      const end = interval ? x(item.high) : x(item[valueKey]);
      const colour = interval ? "#DDD6FE" : colours ? PASTELS[index % PASTELS.length] : "#A5F3FC";
      const valueText = interval ? `${item.low.toFixed(2)}% to ${item.high.toFixed(2)}%` : `${item[valueKey].toFixed(2)}%`;
      return `<text class="bar-label" x="${left-10}" y="${cy+4}" text-anchor="end">${xml(item.name)}</text><rect x="${Math.min(start,end)}" y="${cy-barHeight/2}" width="${Math.max(Math.abs(end-start),1)}" height="${barHeight}" rx="6" fill="${colour}"><title>${xml(item.name)}: ${valueText}</title></rect><text class="value-label" x="${Math.max(start,end)+7}" y="${cy+4}">${valueText}</text>`;
    }).join("");
    return `<article class="chart-card"><h3>${title}</h3><p>${subtitle}</p><div class="chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${title}">${grid}${refLine}${zeroLine}${bars}</svg></div></article>`;
  }

  function renderResults(results) {
    const threshold = Number($("#threshold").value) / 100;
    const winner = results.reduce((best, row) => row.probabilityBest > best.probabilityBest ? row : best);
    const conclusive = winner.probabilityBest >= threshold;
    $("#decisionSummary").className = `decision-summary ${conclusive ? "success" : "warning"}`;
    $("#decisionSummary").innerHTML = `<strong>${conclusive ? `${xml(winner.name)} is the current winner` : "No conclusive winner yet"}</strong><span>${xml(winner.name)} has a ${percent(winner.probabilityBest)} probability of being best. Decision threshold: ${(threshold * 100).toFixed(1)}%.</span>`;

    const graphData = results.map(row => ({
      name: row.name,
      conversionRate: row.conversionRate * 100,
      probabilityBest: row.probabilityBest * 100,
      probabilityBeatControl: row.probabilityBeatControl * 100
    }));
    const upliftData = results.filter(row => !row.isControl).map(row => ({ name: row.name, low: row.upliftInterval[0] * 100, high: row.upliftInterval[1] * 100 }));

    $("#charts").innerHTML = [
      horizontalChart({ title: "Conversion rate", subtitle: "Observed conversion rate for each experience.", data: graphData, valueKey: "conversionRate" }),
      horizontalChart({ title: "Probability to be best", subtitle: "Share of posterior simulations in which each variant wins.", data: graphData, valueKey: "probabilityBest", maxValue: 100, reference: threshold * 100 }),
      horizontalChart({ title: "Probability of beating control", subtitle: "Direct posterior comparison with the control experience.", data: graphData.filter((_, index) => index !== results.findIndex(row => row.isControl)), valueKey: "probabilityBeatControl", maxValue: 100, reference: threshold * 100, colours: false }),
      horizontalChart({ title: "95% credible interval for uplift", subtitle: "Relative conversion-rate uplift versus control. Bars entirely to the right of 0% indicate stronger posterior evidence of positive uplift.", data: upliftData, interval: true })
    ].join("");

    $("#resultRows").innerHTML = results.map(row => `<tr><td><strong>${xml(row.name)}${row.isControl ? " (control)" : ""}</strong></td><td>${row.samples.toLocaleString("en-GB")}</td><td>${row.conversions.toLocaleString("en-GB")}</td><td>${percent(row.conversionRate,3)}</td><td>${percent(row.probabilityBest)}</td><td>${row.isControl ? "Reference" : percent(row.probabilityBeatControl)}</td><td>${percent(row.expectedLoss,3)}</td><td>${row.isControl ? "Reference" : `${percent(row.upliftInterval[0])} to ${percent(row.upliftInterval[1])}`}</td></tr>`).join("");
    $("#results").classList.remove("hidden");
  }

  $("#variants").addEventListener("click", event => {
    if (!event.target.classList.contains("remove")) return;
    readInputs();
    variants = variants.filter(variant => variant.id !== event.target.closest(".variant-row").dataset.id);
    renderVariants();
    $("#results").classList.add("hidden");
  });

  $("#addVariant").addEventListener("click", () => {
    readInputs();
    if (variants.length >= 10) return;
    variants.push({ id: id(), name: `Variant ${String.fromCharCode(64 + variants.length)}`, samples: 0, conversions: 0, isControl: false });
    renderVariants();
    $("#results").classList.add("hidden");
  });

  $("#calculate").addEventListener("click", () => {
    readInputs();
    const error = validate();
    $("#error").textContent = error;
    $("#error").style.display = error ? "block" : "none";
    if (error) return;
    const button = $("#calculate");
    button.disabled = true;
    button.textContent = "Calculating…";
    setTimeout(() => {
      renderResults(calculateBayesianResults());
      button.disabled = false;
      button.textContent = "Calculate";
    }, 20);
  });

  $("#reset").addEventListener("click", () => {
    variants = defaults();
    $("#threshold").value = 95;
    $("#error").style.display = "none";
    $("#results").classList.add("hidden");
    renderVariants();
  });

  variants = defaults();
  renderVariants();
})();
