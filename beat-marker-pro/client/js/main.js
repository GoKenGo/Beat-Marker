/**
 * ════════════════════════════════════════════════════════
 *  BEAT MARKER PRO v2 — CEP Panel Controller
 *  Bridges UI ↔ ExtendScript via CSInterface
 * ════════════════════════════════════════════════════════
 */

// ── CSInterface ──
var csInterface;
var isConnected = false;

try {
  csInterface = new CSInterface();
  isConnected = true;
} catch (e) {
  console.log("Beat Marker Pro: Running in preview mode (no CEP host)");
  csInterface = null;
}

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════

var state = {
  bpm: null,
  subdivision: 4,
  triplet: false,
  timeSigTop: 4,
  timeSigBottom: 4,
  range: "inout",
  offsetFrames: 0,
  namePattern: "{type} {bar}.{beat}",
  metronomeActive: false,
  metronomeInterval: null,
  metronomeBeat: 0,
  tapTimes: [],
  tapTimeout: null,
  audioContext: null,
  audioBuffer: null,
  monoSamples: null,
  vizMode: "waveform",
  analysisResults: null,

  // Last batch tracking for undo
  lastBatchStartTime: 0,
  lastBatchEndTime: 0,
  lastBatchCount: 0,
  lastBatchPrefix: "",

  channels: {
    kick:   { enabled: true,  sensitivity: 0.50, color: 1, results: [] },
    snare:  { enabled: true,  sensitivity: 0.50, color: 3, results: [] },
    hihat:  { enabled: false, sensitivity: 0.50, color: 4, results: [] },
    bass:   { enabled: true,  sensitivity: 0.50, color: 6, results: [] },
    melody: { enabled: false, sensitivity: 0.45, color: 2, results: [] },
    vocal:  { enabled: false, sensitivity: 0.45, color: 0, results: [] },
  },
};

var analyzer = new AudioAnalyzer();

// ══════════════════════════════════════════════════════
//  EXTENDSCRIPT BRIDGE
// ══════════════════════════════════════════════════════

function evalScript(script) {
  return new Promise(function (resolve, reject) {
    if (!csInterface) {
      resolve(null);
      return;
    }
    csInterface.evalScript(script, function (result) {
      if (result === "EvalScript error.") {
        reject(new Error("ExtendScript evaluation error"));
      } else {
        resolve(result);
      }
    });
  });
}

// ══════════════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════════════

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
  document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
  document.querySelector('[data-tab="' + tabId + '"]').classList.add("active");
  document.getElementById("tab-" + tabId).classList.add("active");
}

function toggleSection(header) {
  header.classList.toggle("collapsed");
  header.nextElementSibling.classList.toggle("collapsed");
}

// ══════════════════════════════════════════════════════
//  BPM + TAP TEMPO
// ══════════════════════════════════════════════════════

var bpmInput = document.getElementById("bpmInput");
var bpmDisplay = document.getElementById("bpmDisplay");

bpmInput.addEventListener("input", function () {
  var val = parseFloat(bpmInput.value);
  if (val && val >= 20 && val <= 300) {
    state.bpm = val;
    bpmDisplay.textContent = val.toFixed(1);
  }
});

bpmInput.addEventListener("change", function () {
  var val = parseFloat(bpmInput.value);
  if (val) {
    val = Math.max(20, Math.min(300, val));
    setBPM(val);
  }
});

function setBPM(val) {
  val = Math.round(val * 10) / 10;
  state.bpm = val;
  bpmInput.value = val;
  bpmDisplay.textContent = val.toFixed(1);
}

function tapTempo() {
  var now = performance.now();
  if (state.tapTimes.length > 0 && now - state.tapTimes[state.tapTimes.length - 1] > 2000) {
    state.tapTimes = [];
  }
  state.tapTimes.push(now);
  if (state.tapTimes.length > 8) state.tapTimes.shift();

  if (state.tapTimes.length >= 2) {
    var intervals = [];
    for (var i = 1; i < state.tapTimes.length; i++) {
      intervals.push(state.tapTimes[i] - state.tapTimes[i - 1]);
    }
    var sum = 0;
    for (var j = 0; j < intervals.length; j++) sum += intervals[j];
    var avg = sum / intervals.length;
    setBPM(60000 / avg);
  }

  var tapCountEl = document.getElementById("tapCount");
  tapCountEl.textContent = state.tapTimes.length;
  document.getElementById("tapTempoBtn").classList.add("tapping");
  setTimeout(function () { document.getElementById("tapTempoBtn").classList.remove("tapping"); }, 100);

  clearTimeout(state.tapTimeout);
  state.tapTimeout = setTimeout(function () { tapCountEl.textContent = ""; }, 3000);
}

document.addEventListener("keydown", function (e) {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "KeyT" || e.code === "Space") { e.preventDefault(); tapTempo(); }
});

// ══════════════════════════════════════════════════════
//  CHANNELS
// ══════════════════════════════════════════════════════

function toggleChannel(ch) {
  state.channels[ch].enabled = !state.channels[ch].enabled;
  var toggle = document.querySelector('.channel-toggle[data-ch="' + ch + '"]');
  var row = document.getElementById("ch-" + ch);
  toggle.classList.toggle("active", state.channels[ch].enabled);
  row.classList.toggle("disabled", !state.channels[ch].enabled);
}

function updateSensitivity(ch, val) {
  state.channels[ch].sensitivity = val / 100;
}

function updateChannelColor(ch, val) {
  state.channels[ch].color = parseInt(val);
}

// ══════════════════════════════════════════════════════
//  AUDIO FILE ANALYSIS
// ══════════════════════════════════════════════════════

var audioDropzone = document.getElementById("audioDropzone");
var audioFileInput = document.getElementById("audioFileInput");

audioFileInput.addEventListener("change", function (e) {
  if (e.target.files.length > 0) analyzeAudioFile(e.target.files[0]);
});

audioDropzone.addEventListener("dragover", function (e) {
  e.preventDefault(); audioDropzone.classList.add("dragover");
});
audioDropzone.addEventListener("dragleave", function () { audioDropzone.classList.remove("dragover"); });
audioDropzone.addEventListener("drop", function (e) {
  e.preventDefault(); audioDropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length > 0) analyzeAudioFile(e.dataTransfer.files[0]);
});

function analyzeAudioFile(file) {
  var progressBar = document.getElementById("analysisProgress");
  var progressFill = document.getElementById("analysisProgressFill");

  setStatus("working", "Analyzing: " + file.name + "...");
  audioDropzone.classList.add("analyzing");
  progressBar.classList.add("visible");
  progressFill.style.width = "5%";

  var audioContext = new (window.AudioContext || window.webkitAudioContext)();
  state.audioContext = audioContext;

  var reader = new FileReader();
  reader.onload = function () {
    audioContext.decodeAudioData(reader.result, function (audioBuffer) {
      state.audioBuffer = audioBuffer;
      progressFill.style.width = "15%";

      // Mix to mono for viz
      var left = audioBuffer.getChannelData(0);
      var right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
      state.monoSamples = new Float32Array(left.length);
      for (var i = 0; i < left.length; i++) {
        state.monoSamples[i] = (left[i] + right[i]) * 0.5;
      }

      // Build options
      var options = {};
      for (var ch in state.channels) {
        var capCh = ch.charAt(0).toUpperCase() + ch.slice(1);
        options["detect" + capCh] = state.channels[ch].enabled;
        options["sensitivity" + capCh] = state.channels[ch].sensitivity;
      }

      // Run analysis
      analyzer.analyze(audioBuffer, options, function (pct, msg) {
        progressFill.style.width = pct + "%";
        setStatus("working", msg);
      }).then(function (results) {
        state.analysisResults = results;

        var totalMarkers = 0;
        for (var ch in state.channels) {
          var count = results[ch] ? results[ch].length : 0;
          state.channels[ch].results = results[ch] || [];
          document.querySelector('.channel-count[data-ch="' + ch + '"]').textContent = count;
          if (state.channels[ch].enabled) totalMarkers += count;
        }

        if (results.bpm) setBPM(results.bpm);

        document.getElementById("detectionSummary").style.display = "grid";
        document.getElementById("sumTotal").textContent = totalMarkers;
        document.getElementById("sumBPM").textContent = results.bpm ? results.bpm.toFixed(1) : "—";
        document.getElementById("sumDuration").textContent = formatDuration(audioBuffer.duration);

        document.getElementById("analysisViz").style.display = "block";
        drawVisualization();

        audioDropzone.querySelector(".drop-text").innerHTML =
          "<strong>" + file.name + "</strong><br/><span style='font-size:9px;'>" +
          totalMarkers + " events · " + (results.bpm ? results.bpm.toFixed(1) + " BPM" : "") + "</span>";

        setStatus("ready", "✓ " + totalMarkers + " events detected");
        audioDropzone.classList.remove("analyzing");
        setTimeout(function () {
          progressBar.classList.remove("visible");
          progressFill.style.width = "0%";
        }, 800);
      });
    }, function (err) {
      setStatus("error", "Failed to decode audio: " + err);
      audioDropzone.classList.remove("analyzing");
      progressBar.classList.remove("visible");
    });
  };
  reader.readAsArrayBuffer(file);
}

// ══════════════════════════════════════════════════════
//  VISUALIZATION
// ══════════════════════════════════════════════════════

function setVizMode(mode, btn) {
  state.vizMode = mode;
  document.querySelectorAll(".viz-controls button").forEach(function (b) { b.classList.remove("active"); });
  btn.classList.add("active");
  drawVisualization();
}

function drawVisualization() {
  var canvas = document.getElementById("vizCanvas");
  var ctx = canvas.getContext("2d");
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = 100 * dpr;
  ctx.scale(dpr, dpr);
  var w = rect.width, h = 100;

  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, w, h);

  if (!state.audioBuffer) return;
  var duration = state.audioBuffer.duration;

  if (state.vizMode === "waveform" && state.monoSamples) {
    var samples = state.monoSamples;
    var samplesPerPixel = Math.floor(samples.length / w);
    var mid = h / 2;
    ctx.strokeStyle = "rgba(90,159,212,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x < w; x++) {
      var start = x * samplesPerPixel;
      var mn = 0, mx = 0;
      for (var i = start; i < start + samplesPerPixel && i < samples.length; i++) {
        if (samples[i] < mn) mn = samples[i];
        if (samples[i] > mx) mx = samples[i];
      }
      ctx.moveTo(x, mid + mn * mid);
      ctx.lineTo(x, mid + mx * mid);
    }
    ctx.stroke();
  }

  // Draw onset lines
  var colors = { kick: "#e05555", snare: "#e0a855", hihat: "#ccc855", bass: "#55b8e0", melody: "#a855e0", vocal: "#55e0a8" };
  var heights = { kick: [0, 0.25], snare: [0.15, 0.40], hihat: [0.30, 0.50], bass: [0.50, 0.75], melody: [0.60, 0.85], vocal: [0.75, 1.0] };

  var legendY = 8;
  ctx.font = "8px -apple-system, sans-serif";

  for (var ch in state.channels) {
    var cfg = state.channels[ch];
    if (!cfg.enabled || !cfg.results || cfg.results.length === 0) continue;

    var c = colors[ch] || "#999";
    var ht = heights[ch] || [0, 1];

    ctx.strokeStyle = c;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;

    for (var j = 0; j < cfg.results.length; j++) {
      var ev = cfg.results[j];
      var xPos = (ev.time / duration) * w;
      ctx.beginPath();
      ctx.moveTo(xPos, ht[0] * h);
      ctx.lineTo(xPos, ht[1] * h);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = c;
    ctx.fillRect(4, legendY - 5, 6, 6);
    ctx.fillStyle = "#888";
    ctx.fillText(ch + " (" + cfg.results.length + ")", 14, legendY);
    legendY += 11;
  }
  ctx.globalAlpha = 1;
}

// ══════════════════════════════════════════════════════
//  METRONOME
// ══════════════════════════════════════════════════════

function toggleMetronome() {
  state.metronomeActive = !state.metronomeActive;
  document.getElementById("metronomeToggle").classList.toggle("active", state.metronomeActive);
  if (state.metronomeActive) startMetronome(); else stopMetronome();
}

function startMetronome() {
  stopMetronome();
  if (!state.bpm) { setStatus("error", "Set BPM first"); state.metronomeActive = false; return; }
  state.metronomeBeat = 0;
  updateBeatDots();
  var intervalMs = (60 / state.bpm) * 1000;
  state.metronomeInterval = setInterval(function () {
    var dots = document.querySelectorAll("#beatIndicator .beat-dot");
    dots.forEach(function (d) { d.classList.remove("active"); });
    var current = state.metronomeBeat % state.timeSigTop;
    if (dots[current]) dots[current].classList.add("active");
    playClick(current === 0);
    state.metronomeBeat++;
  }, intervalMs);
}

function stopMetronome() {
  if (state.metronomeInterval) { clearInterval(state.metronomeInterval); state.metronomeInterval = null; }
  document.querySelectorAll("#beatIndicator .beat-dot").forEach(function (d) { d.classList.remove("active"); });
}

function updateBeatDots() {
  var container = document.getElementById("beatIndicator");
  container.innerHTML = "";
  for (var i = 0; i < state.timeSigTop; i++) {
    var dot = document.createElement("div");
    dot.className = "beat-dot" + (i === 0 ? " downbeat" : "");
    container.appendChild(dot);
  }
}

function playClick(isDownbeat) {
  try {
    if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = state.audioContext;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = isDownbeat ? 1200 : 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.05);
  } catch (e) {}
}

// ══════════════════════════════════════════════════════
//  GRID CONTROLS
// ══════════════════════════════════════════════════════

function setSubdivision(btn, value) {
  document.querySelectorAll(".sub-btn").forEach(function (b) { b.classList.remove("active"); });
  btn.classList.add("active");
  state.subdivision = value;
}

function setRange(btn, value) {
  document.querySelectorAll(".range-btn").forEach(function (b) { b.classList.remove("active"); });
  btn.classList.add("active");
  state.range = value;
}

document.getElementById("timeSigTop").addEventListener("change", function (e) {
  state.timeSigTop = parseInt(e.target.value);
  updateBeatDots();
  if (state.metronomeActive) startMetronome();
});

document.getElementById("timeSigBottom").addEventListener("change", function (e) {
  state.timeSigBottom = parseInt(e.target.value);
});

document.getElementById("offsetFrames").addEventListener("change", function (e) {
  state.offsetFrames = parseInt(e.target.value) || 0;
});

// ══════════════════════════════════════════════════════
//  PLACE DETECTED MARKERS (via ExtendScript)
// ══════════════════════════════════════════════════════

function placeDetectedMarkers() {
  // Collect enabled events
  var allEvents = [];
  for (var ch in state.channels) {
    var cfg = state.channels[ch];
    if (!cfg.enabled || !cfg.results) continue;
    for (var i = 0; i < cfg.results.length; i++) {
      var ev = cfg.results[i];
      allEvents.push({
        time: ev.time,
        type: ch,
        strength: ev.strength || 0,
        color: cfg.color,
      });
    }
  }

  if (allEvents.length === 0) {
    setStatus("error", "No detected events — analyze audio first");
    return;
  }

  // Sort by time
  allEvents.sort(function (a, b) { return a.time - b.time; });

  if (!csInterface) {
    setStatus("working", "Simulating...");
    setTimeout(function () {
      setStatus("ready", "Would place " + allEvents.length + " detected markers");
    }, 600);
    return;
  }

  var btn = document.getElementById("placeDetectedBtn");
  btn.disabled = true;
  setStatus("working", "Getting sequence info...");

  evalScript("getInOutRange()").then(function (result) {
    var rangeInfo = JSON.parse(result);
    if (rangeInfo.error) {
      setStatus("error", rangeInfo.error);
      btn.disabled = false;
      return;
    }

    var startSec = 0, endSec = rangeInfo.endTime;
    if (state.range === "inout") {
      startSec = rangeInfo.inPoint;
      endSec = rangeInfo.outPoint;
    } else if (state.range === "playhead") {
      startSec = rangeInfo.playerPosition;
    }

    // Apply offset (assume ~24fps for frame offset if we don't know exact fps)
    var offsetSec = state.offsetFrames / 24;
    startSec += offsetSec;

    // Filter events to range
    var filtered = allEvents.filter(function (ev) {
      return ev.time >= startSec && ev.time <= endSec;
    });

    if (filtered.length === 0) {
      setStatus("error", "No events in selected range");
      btn.disabled = false;
      return;
    }

    // Build marker batch
    var batch = filtered.map(function (ev, idx) {
      var typeName = ev.type.charAt(0).toUpperCase() + ev.type.slice(1);
      var name = state.namePattern
        .replace("{type}", typeName)
        .replace("{bar}", "")
        .replace("{beat}", "")
        .replace("{n}", idx + 1)
        .replace(/\s+/g, " ").trim();
      return {
        time: ev.time,
        name: name,
        comments: typeName + " | " + ev.time.toFixed(3) + "s | str:" + ev.strength.toFixed(2),
        color: ev.color,
      };
    });

    // Track for undo
    state.lastBatchStartTime = batch[0].time;
    state.lastBatchEndTime = batch[batch.length - 1].time;
    state.lastBatchCount = batch.length;

    // Send in chunks of 200 (ExtendScript string limits)
    var CHUNK_SIZE = 200;
    var totalPlaced = 0;
    var chunks = [];
    for (var c = 0; c < batch.length; c += CHUNK_SIZE) {
      chunks.push(batch.slice(c, c + CHUNK_SIZE));
    }

    setStatus("working", "Placing " + batch.length + " markers...");

    function processChunk(index) {
      if (index >= chunks.length) {
        setStatus("ready", "✓ Placed " + totalPlaced + " detected markers");
        btn.disabled = false;
        return;
      }
      var jsonStr = JSON.stringify(chunks[index]).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      evalScript("createMarkerBatch('" + jsonStr + "')").then(function (res) {
        try {
          var r = JSON.parse(res);
          totalPlaced += r.placed || 0;
        } catch (e) {}
        setStatus("working", "Placing markers: " + totalPlaced + "/" + batch.length);
        processChunk(index + 1);
      });
    }

    processChunk(0);
  });
}

// ══════════════════════════════════════════════════════
//  PLACE GRID MARKERS
// ══════════════════════════════════════════════════════

function placeGridMarkers() {
  if (!state.bpm) { setStatus("error", "Set BPM first"); return; }

  if (!csInterface) {
    setStatus("working", "Simulating...");
    setTimeout(function () {
      setStatus("ready", "Would place grid markers at " + state.bpm + " BPM");
    }, 600);
    return;
  }

  var btn = document.getElementById("placeGridBtn");
  btn.disabled = true;
  setStatus("working", "Getting sequence info...");

  evalScript("getInOutRange()").then(function (result) {
    var rangeInfo = JSON.parse(result);
    if (rangeInfo.error) {
      setStatus("error", rangeInfo.error);
      btn.disabled = false;
      return;
    }

    var startSec = 0, endSec = parseFloat(rangeInfo.endTime);
    if (state.range === "inout") {
      startSec = parseFloat(rangeInfo.inPoint);
      endSec = parseFloat(rangeInfo.outPoint);
    } else if (state.range === "playhead") {
      startSec = parseFloat(rangeInfo.playerPosition);
    }

    var offsetSec = state.offsetFrames / 24;
    startSec += offsetSec;

    var beatDurSec = 60 / state.bpm;
    var tripletMult = state.triplet ? 2 / 3 : 1;
    var beatsPerBar = state.timeSigTop;
    var subDuration;

    switch (state.subdivision) {
      case 1: subDuration = beatDurSec * beatsPerBar; break;
      case 2: subDuration = beatDurSec * 2; break;
      case 4: subDuration = beatDurSec; break;
      case 8: subDuration = beatDurSec / 2; break;
      default: subDuration = beatDurSec;
    }
    subDuration *= tripletMult;

    var gridColorDown = parseInt((document.getElementById("gridColorDown") || {}).value || "0");
    var gridColorBeat = parseInt((document.getElementById("gridColorBeat") || {}).value || "6");
    var gridColorSub = parseInt((document.getElementById("gridColorSub") || {}).value || "2");

    var batch = [];
    var t = startSec;
    var bar = 1, beat = 1, sub = 1;
    var subsPerBeat = Math.max(1, state.subdivision / 4);

    while (t < endSec && batch.length < 5000) {
      var isDown = (beat === 1 && sub === 1);
      var isBeat = (sub === 1);
      var colorIdx = isDown ? gridColorDown : isBeat ? gridColorBeat : gridColorSub;

      var name = state.namePattern
        .replace("{type}", isDown ? "↓" : "·")
        .replace("{bar}", bar)
        .replace("{beat}", beat)
        .replace("{sub}", sub)
        .replace("{n}", batch.length + 1);

      batch.push({
        time: t,
        name: name,
        comments: "Bar " + bar + " | Beat " + beat + "." + sub + " | " + state.bpm + " BPM",
        color: colorIdx,
      });

      t += subDuration;
      sub++;
      if (sub > subsPerBeat) { sub = 1; beat++; }
      if (beat > beatsPerBar) { beat = 1; bar++; }
    }

    state.lastBatchStartTime = batch[0].time;
    state.lastBatchEndTime = batch[batch.length - 1].time;
    state.lastBatchCount = batch.length;

    setStatus("working", "Placing " + batch.length + " grid markers...");

    var CHUNK_SIZE = 200;
    var totalPlaced = 0;
    var chunks = [];
    for (var c = 0; c < batch.length; c += CHUNK_SIZE) {
      chunks.push(batch.slice(c, c + CHUNK_SIZE));
    }

    function processChunk(index) {
      if (index >= chunks.length) {
        setStatus("ready", "✓ Placed " + totalPlaced + " grid markers at " + state.bpm + " BPM");
        btn.disabled = false;
        return;
      }
      var jsonStr = JSON.stringify(chunks[index]).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      evalScript("createMarkerBatch('" + jsonStr + "')").then(function (res) {
        try {
          var r = JSON.parse(res);
          totalPlaced += r.placed || 0;
        } catch (e) {}
        setStatus("working", "Grid markers: " + totalPlaced + "/" + batch.length);
        processChunk(index + 1);
      });
    }

    processChunk(0);
  });
}

// ══════════════════════════════════════════════════════
//  CLEAR / UNDO
// ══════════════════════════════════════════════════════

function clearLastBatch() {
  if (!csInterface) { setStatus("ready", "Nothing to undo (preview)"); return; }
  if (state.lastBatchCount === 0) { setStatus("ready", "No batch to undo"); return; }

  setStatus("working", "Removing last batch...");
  // Use a small time buffer around the batch range
  var s = state.lastBatchStartTime - 0.001;
  var e = state.lastBatchEndTime + 0.001;
  evalScript("clearMarkersInRange(" + s + "," + e + ",'')").then(function (res) {
    try {
      var r = JSON.parse(res);
      setStatus("ready", "✓ Removed " + r.removed + " markers");
      state.lastBatchCount = 0;
    } catch (err) {
      setStatus("error", "Undo failed");
    }
  });
}

function clearAllMarkers() {
  if (!csInterface) { setStatus("ready", "No markers (preview)"); return; }
  setStatus("working", "Clearing all markers...");
  evalScript("clearAllMarkers()").then(function (res) {
    try {
      var r = JSON.parse(res);
      setStatus("ready", "✓ Removed " + r.removed + " markers");
    } catch (err) {
      setStatus("error", "Clear failed");
    }
  });
}

// ══════════════════════════════════════════════════════
//  PLAYHEAD OFFSET
// ══════════════════════════════════════════════════════

function usePlayheadAsOffset() {
  if (!csInterface) { setStatus("error", "Not connected"); return; }
  evalScript("getPlayheadFrames(24)").then(function (res) {
    var frames = parseInt(res);
    if (frames >= 0) {
      state.offsetFrames = frames;
      document.getElementById("offsetFrames").value = frames;
      setStatus("ready", "Offset: frame " + frames);
    } else {
      setStatus("error", "Could not read playhead");
    }
  });
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

function setStatus(type, message) {
  document.getElementById("statusDot").className = "status-dot " + type;
  document.getElementById("statusText").textContent = message;
}

function formatDuration(sec) {
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════

function init() {
  updateBeatDots();

  if (csInterface) {
    // Ping Premiere to verify connection
    evalScript("ping()").then(function (res) {
      try {
        var info = JSON.parse(res);
        if (info.hasSequence) {
          setStatus("ready", "Connected — Sequence: " + info.sequenceName);
        } else {
          setStatus("ready", "Connected to Premiere Pro — open a sequence");
        }
      } catch (e) {
        setStatus("ready", "Connected to Premiere Pro");
      }
    });
  } else {
    setStatus("ready", "Preview mode — drop audio to test detection");
  }
}

init();
