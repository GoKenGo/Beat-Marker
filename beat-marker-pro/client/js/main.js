/**
 * ════════════════════════════════════════════════════════════
 *  BEAT MARKER PRO v2 — CEP Panel Controller
 *  Bridges UI ↔ ExtendScript via CSInterface
 * ════════════════════════════════════════════════════════════
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
//  GENRE PRESETS
// ══════════════════════════════════════════════════════

var GENRE_PRESETS = {
  rock: {
    label: "Rock",
    hint: "Strong kick and snare transients with hi-hat detail.",
    channels: {
      kick:   { enabled: true,  sensitivity: 65 },
      snare:  { enabled: true,  sensitivity: 70 },
      hihat:  { enabled: true,  sensitivity: 55 },
      bass:   { enabled: false, sensitivity: 50 },
      melody: { enabled: false, sensitivity: 45 },
      vocal:  { enabled: false, sensitivity: 45 },
    },
  },
  edm: {
    label: "EDM",
    hint: "Boosted kick and bass sensitivity for electronic music. Try the 'EDM' preset.",
    channels: {
      kick:   { enabled: true,  sensitivity: 75 },
      snare:  { enabled: true,  sensitivity: 60 },
      hihat:  { enabled: true,  sensitivity: 65 },
      bass:   { enabled: true,  sensitivity: 72 },
      melody: { enabled: false, sensitivity: 45 },
      vocal:  { enabled: false, sensitivity: 45 },
    },
  },
  hiphop: {
    label: "Hip-Hop",
    hint: "Heavy bass and kick with snare/hi-hat detail for hip-hop production.",
    channels: {
      kick:   { enabled: true,  sensitivity: 70 },
      snare:  { enabled: true,  sensitivity: 65 },
      hihat:  { enabled: true,  sensitivity: 60 },
      bass:   { enabled: true,  sensitivity: 65 },
      melody: { enabled: false, sensitivity: 45 },
      vocal:  { enabled: false, sensitivity: 45 },
    },
  },
  classical: {
    label: "Classical",
    hint: "Focused on melodic phrasing and bass movement. Percussion detection lowered.",
    channels: {
      kick:   { enabled: false, sensitivity: 40 },
      snare:  { enabled: false, sensitivity: 40 },
      hihat:  { enabled: false, sensitivity: 40 },
      bass:   { enabled: true,  sensitivity: 45 },
      melody: { enabled: true,  sensitivity: 62 },
      vocal:  { enabled: false, sensitivity: 45 },
    },
  },
  acoustic: {
    label: "Acoustic",
    hint: "Natural transients with melodic detection. Lower bass/percussion thresholds.",
    channels: {
      kick:   { enabled: true,  sensitivity: 45 },
      snare:  { enabled: true,  sensitivity: 50 },
      hihat:  { enabled: false, sensitivity: 40 },
      bass:   { enabled: false, sensitivity: 40 },
      melody: { enabled: true,  sensitivity: 58 },
      vocal:  { enabled: false, sensitivity: 45 },
    },
  },
  podcast: {
    label: "Podcast / Vocals",
    hint: "Optimized for speech and vocal phrase detection. All percussion disabled.",
    channels: {
      kick:   { enabled: false, sensitivity: 40 },
      snare:  { enabled: false, sensitivity: 40 },
      hihat:  { enabled: false, sensitivity: 40 },
      bass:   { enabled: false, sensitivity: 40 },
      melody: { enabled: false, sensitivity: 45 },
      vocal:  { enabled: true,  sensitivity: 65 },
    },
  },
};

// Scoring weights used by suggestPreset()
// Each value is the expected normalized event count (0–1) per channel for that genre
var PRESET_EXPECTATIONS = {
  rock:      { kick: 0.75, snare: 0.85, hihat: 0.65, bass: 0.20, melody: 0.10, vocal: 0.05 },
  edm:       { kick: 0.90, snare: 0.50, hihat: 0.75, bass: 0.85, melody: 0.10, vocal: 0.05 },
  hiphop:    { kick: 0.80, snare: 0.70, hihat: 0.70, bass: 0.70, melody: 0.10, vocal: 0.10 },
  classical: { kick: 0.00, snare: 0.00, hihat: 0.05, bass: 0.40, melody: 0.85, vocal: 0.20 },
  acoustic:  { kick: 0.40, snare: 0.40, hihat: 0.20, bass: 0.30, melody: 0.65, vocal: 0.10 },
  podcast:   { kick: 0.00, snare: 0.00, hihat: 0.00, bass: 0.00, melody: 0.10, vocal: 0.90 },
};

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
  currentPreset: "",

  // Cancellation token for in-progress analysis
  currentCancelToken: null,

  // Last batch tracking for undo (most recent placement of either type)
  lastBatchStartTime: 0,
  lastBatchEndTime: 0,
  lastBatchCount: 0,
  lastBatchPrefix: "",

  // Separate tracking for detected marker batch (for deduplication on re-run)
  lastDetectedBatchStart: null,
  lastDetectedBatchEnd: null,
  lastDetectedBatchCount: 0,

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
//  GENRE PRESETS
// ══════════════════════════════════════════════════════

function applyGenrePreset(presetKey) {
  if (!presetKey || !GENRE_PRESETS[presetKey]) {
    document.getElementById("presetHint").classList.remove("visible");
    state.currentPreset = "";
    return;
  }

  var preset = GENRE_PRESETS[presetKey];
  state.currentPreset = presetKey;

  for (var ch in preset.channels) {
    var cfg = preset.channels[ch];

    // Update state
    state.channels[ch].enabled = cfg.enabled;
    state.channels[ch].sensitivity = cfg.sensitivity / 100;

    // Update toggle UI
    var toggle = document.querySelector('.channel-toggle[data-ch="' + ch + '"]');
    var row = document.getElementById("ch-" + ch);
    if (toggle) toggle.classList.toggle("active", cfg.enabled);
    if (row) row.classList.toggle("disabled", !cfg.enabled);

    // Update sensitivity slider
    var slider = document.querySelector('input[type="range"][data-ch="' + ch + '"]');
    if (slider) slider.value = cfg.sensitivity;
  }

  // Show hint
  var hintEl = document.getElementById("presetHint");
  hintEl.textContent = preset.hint;
  hintEl.classList.add("visible");
}

/**
 * Analyzes the spectral profile of detected results (or the loaded audio's
 * first few seconds if no results yet) and applies the best-matching preset.
 */
function suggestPreset() {
  var channelNames = ["kick", "snare", "hihat", "bass", "melody", "vocal"];

  // Need audio loaded to suggest
  if (!state.monoSamples && !state.analysisResults) {
    setStatus("error", "Load audio first — then Suggest will analyze and recommend a preset");
    return;
  }

  // Run a quick all-channels analysis if we don't have results yet
  if (!state.analysisResults || !hasAnyResults()) {
    setStatus("working", "Running quick analysis to suggest preset...");
    var btn = document.getElementById("suggestPresetBtn");
    btn.disabled = true;

    // Run with all channels enabled at medium sensitivity to get a spectral profile
    var quickOptions = {};
    channelNames.forEach(function (ch) {
      var capCh = ch.charAt(0).toUpperCase() + ch.slice(1);
      quickOptions["detect" + capCh] = true;
      quickOptions["sensitivity" + capCh] = 0.5;
    });

    var cancelToken = { cancelled: false };
    state.currentCancelToken = cancelToken;
    showProgress();

    analyzer.analyze(state.audioBuffer, quickOptions, function (pct, msg) {
      document.getElementById("analysisProgressFill").style.width = pct + "%";
    }, cancelToken).then(function (results) {
      hideProgress();
      btn.disabled = false;
      if (!results) { setStatus("ready", "Analysis cancelled"); return; }
      // Store results and suggest
      state.analysisResults = results;
      channelNames.forEach(function (ch) {
        state.channels[ch].results = results[ch] || [];
        document.querySelector('.channel-count[data-ch="' + ch + '"]').textContent =
          state.channels[ch].results.length;
      });
      _applySuggestionFromResults(results);
    });
    return;
  }

  _applySuggestionFromResults(state.analysisResults);
}

function hasAnyResults() {
  var channelNames = ["kick", "snare", "hihat", "bass", "melody", "vocal"];
  for (var i = 0; i < channelNames.length; i++) {
    if (state.channels[channelNames[i]].results.length > 0) return true;
  }
  return false;
}

function _applySuggestionFromResults(results) {
  var channelNames = ["kick", "snare", "hihat", "bass", "melody", "vocal"];

  // Build normalized event count profile using all-channel results
  var profile = {};
  var maxCount = 0;

  channelNames.forEach(function (ch) {
    var evts = results[ch] || [];
    var count = evts.length;
    var avgStrength = 0;
    if (count > 0) {
      var total = 0;
      evts.forEach(function (ev) { total += ev.strength || 0; });
      avgStrength = total / count;
    }
    profile[ch] = { count: count, strength: avgStrength };
    if (count > maxCount) maxCount = count;
  });

  // Normalize counts
  if (maxCount > 0) {
    channelNames.forEach(function (ch) {
      profile[ch].normCount = profile[ch].count / maxCount;
    });
  }

  // Score each preset
  var scores = {};
  for (var presetKey in PRESET_EXPECTATIONS) {
    var expected = PRESET_EXPECTATIONS[presetKey];
    var score = 0;
    channelNames.forEach(function (ch) {
      var norm = profile[ch].normCount || 0;
      var exp = expected[ch] || 0;
      score -= (norm - exp) * (norm - exp); // negative squared error
    });
    scores[presetKey] = score;
  }

  // Find best match
  var bestPreset = null;
  var bestScore = -Infinity;
  for (var pk in scores) {
    if (scores[pk] > bestScore) {
      bestScore = scores[pk];
      bestPreset = pk;
    }
  }

  if (bestPreset) {
    var preset = GENRE_PRESETS[bestPreset];
    document.getElementById("genrePreset").value = bestPreset;
    applyGenrePreset(bestPreset);

    // Compose a descriptive suggestion message
    var dominant = channelNames.filter(function (ch) {
      return (profile[ch].normCount || 0) > 0.4;
    }).map(function (ch) { return ch; });

    var desc = dominant.length > 0
      ? "Strong " + dominant.slice(0, 2).join(" and ") + " detected. "
      : "Sparse transient content. ";

    setStatus("ready", desc + 'Try the \'' + preset.label + '\' preset — ' + preset.hint);
  }
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
  // Custom configuration — clear preset selection
  document.getElementById("genrePreset").value = "";
  document.getElementById("presetHint").classList.remove("visible");
}

function updateSensitivity(ch, val) {
  state.channels[ch].sensitivity = val / 100;
}

function updateChannelColor(ch, val) {
  state.channels[ch].color = parseInt(val);
}

// ══════════════════════════════════════════════════════
//  PROGRESS BAR HELPERS
// ══════════════════════════════════════════════════════

function showProgress() {
  document.getElementById("progressContainer").classList.add("visible");
  document.getElementById("analysisProgressFill").style.width = "0%";
}

function hideProgress() {
  setTimeout(function () {
    document.getElementById("progressContainer").classList.remove("visible");
    document.getElementById("analysisProgressFill").style.width = "0%";
  }, 800);
}

// ══════════════════════════════════════════════════════
//  CANCEL ANALYSIS
// ══════════════════════════════════════════════════════

function cancelCurrentAnalysis() {
  if (state.currentCancelToken) {
    state.currentCancelToken.cancelled = true;
    state.currentCancelToken = null;
  }
  document.getElementById("audioDropzone").classList.remove("analyzing");
  hideProgress();
  setStatus("ready", "Analysis cancelled");
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
  // Cancel any in-flight analysis
  if (state.currentCancelToken) {
    state.currentCancelToken.cancelled = true;
  }

  var cancelToken = { cancelled: false };
  state.currentCancelToken = cancelToken;

  setStatus("working", "Analyzing: " + file.name + "...");
  audioDropzone.classList.add("analyzing");
  showProgress();
  document.getElementById("analysisProgressFill").style.width = "5%";

  var audioContext = new (window.AudioContext || window.webkitAudioContext)();
  state.audioContext = audioContext;

  var reader = new FileReader();
  reader.onload = function () {
    if (cancelToken.cancelled) return;

    audioContext.decodeAudioData(reader.result, function (audioBuffer) {
      if (cancelToken.cancelled) {
        audioDropzone.classList.remove("analyzing");
        hideProgress();
        return;
      }

      state.audioBuffer = audioBuffer;
      document.getElementById("analysisProgressFill").style.width = "15%";

      // Mix to mono
      var left = audioBuffer.getChannelData(0);
      var right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
      state.monoSamples = new Float32Array(left.length);
      for (var i = 0; i < left.length; i++) {
        state.monoSamples[i] = (left[i] + right[i]) * 0.5;
      }

      // Show live waveform preview immediately (before analysis)
      document.getElementById("analysisViz").style.display = "block";
      drawVisualization();

      // Update dropzone text to show file name
      audioDropzone.querySelector(".drop-text").innerHTML =
        "<strong>" + file.name + "</strong><br/><span style='font-size:9px;color:var(--text-muted);'>Analyzing...</span>";

      // Build analysis options
      var options = {};
      for (var ch in state.channels) {
        var capCh = ch.charAt(0).toUpperCase() + ch.slice(1);
        options["detect" + capCh] = state.channels[ch].enabled;
        options["sensitivity" + capCh] = state.channels[ch].sensitivity;
      }

      // Run analysis with cancellation support
      analyzer.analyze(audioBuffer, options, function (pct, msg) {
        if (cancelToken.cancelled) return;
        document.getElementById("analysisProgressFill").style.width = pct + "%";
        setStatus("working", msg);
      }, cancelToken).then(function (results) {
        if (cancelToken.cancelled || !results) {
          // Cancelled
          audioDropzone.classList.remove("analyzing");
          hideProgress();
          if (!cancelToken.cancelled) {
            // Results were null for other reason
            setStatus("error", "Analysis returned no results");
          }
          return;
        }

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

        drawVisualization();

        audioDropzone.querySelector(".drop-text").innerHTML =
          "<strong>" + file.name + "</strong><br/><span style='font-size:9px;'>" +
          totalMarkers + " events · " + (results.bpm ? results.bpm.toFixed(1) + " BPM" : "") + "</span>";

        setStatus("ready", "✓ " + totalMarkers + " events detected");
        audioDropzone.classList.remove("analyzing");
        hideProgress();

        // Enable suggest button
        document.getElementById("suggestPresetBtn").disabled = false;
      });
    }, function (err) {
      setStatus("error", "Failed to decode audio: " + err);
      audioDropzone.classList.remove("analyzing");
      hideProgress();
    });
  };
  reader.readAsArrayBuffer(file);
}

// ══════════════════════════════════════════════════════
//  ANALYZE CLIP FROM TIMELINE
// ══════════════════════════════════════════════════════

/**
 * Retrieves the source file of the selected timeline clip via ExtendScript,
 * then loads and analyzes it using the same pipeline as a dropped file.
 */
function analyzeClipFromTimeline() {
  if (!csInterface) {
    setStatus("error", "Not connected to Premiere Pro — cannot read timeline clips");
    return;
  }

  setStatus("working", "Getting selected clip from timeline...");
  var btn = document.getElementById("analyzeClipBtn");
  btn.disabled = true;

  evalScript("getSelectedClipSourcePath()").then(function (result) {
    btn.disabled = false;
    if (!result) { setStatus("error", "No response from Premiere Pro"); return; }

    var info;
    try { info = JSON.parse(result); } catch (e) {
      setStatus("error", "Could not parse clip info"); return;
    }

    if (info.error) {
      setStatus("error", info.error);
      return;
    }

    setStatus("working", "Loading: " + info.name + "...");

    // Convert OS path to file:// URL (handles Windows backslashes)
    var url = "file://" + info.path.replace(/\\/g, "/");
    if (url.indexOf("file:///") === -1 && url.indexOf("file://") === 0) {
      // Windows absolute path like C:/... → file:///C:/...
      if (info.path.match(/^[A-Za-z]:/)) {
        url = "file:///" + info.path.replace(/\\/g, "/");
      }
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function () {
      if (xhr.status === 0 || xhr.status === 200) {
        var blob = new Blob([xhr.response]);
        var file = new File([blob], info.name);
        analyzeAudioFile(file);
      } else {
        setStatus("error", "Could not load clip file (HTTP " + xhr.status + ")");
      }
    };
    xhr.onerror = function () {
      setStatus("error", "Failed to read clip from disk — check file permissions");
    };
    xhr.send();
  }).catch(function (err) {
    btn.disabled = false;
    setStatus("error", "Timeline clip error: " + err.message);
  });
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

  // ── Waveform background ──
  if (state.monoSamples) {
    var samples = state.monoSamples;
    var samplesPerPixel = Math.floor(samples.length / w);
    var mid = h / 2;

    ctx.strokeStyle = "rgba(90,159,212,0.35)";
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

  // If no results yet (preview mode), just show the waveform
  if (!state.analysisResults) return;

  var colors = { kick: "#e05555", snare: "#e0a855", hihat: "#ccc855", bass: "#55b8e0", melody: "#a855e0", vocal: "#55e0a8" };
  var heights = { kick: [0, 0.25], snare: [0.15, 0.40], hihat: [0.30, 0.50], bass: [0.50, 0.75], melody: [0.60, 0.85], vocal: [0.75, 1.0] };

  // ── Onset / Confidence display ──
  if (state.vizMode === "waveform" || state.vizMode === "onsets") {
    for (var ch in state.channels) {
      var cfg = state.channels[ch];
      if (!cfg.enabled || !cfg.results || cfg.results.length === 0) continue;

      var c = colors[ch] || "#999";
      var ht = heights[ch] || [0, 1];

      // Normalize strengths for confidence visualization
      var maxStrength = 0;
      cfg.results.forEach(function (ev) { if ((ev.strength || 0) > maxStrength) maxStrength = ev.strength; });
      if (maxStrength === 0) maxStrength = 1;

      for (var j = 0; j < cfg.results.length; j++) {
        var ev = cfg.results[j];
        var xPos = (ev.time / duration) * w;
        var confidence = (ev.strength || 0.5) / maxStrength; // 0–1

        // Opacity and line width scale with confidence
        ctx.globalAlpha = 0.35 + confidence * 0.65;
        ctx.lineWidth = state.vizMode === "onsets" ? (1 + confidence * 2) : 1;
        ctx.strokeStyle = c;

        ctx.beginPath();
        ctx.moveTo(xPos, ht[0] * h);
        ctx.lineTo(xPos, ht[1] * h);
        ctx.stroke();

        // In "onsets" mode draw a confidence dot at the top of the line
        if (state.vizMode === "onsets") {
          var dotRadius = 2 + confidence * 3;
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.5 + confidence * 0.5;
          ctx.beginPath();
          ctx.arc(xPos, ht[0] * h + dotRadius, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
    }
  }

  // ── Spectrum mode ──
  if (state.vizMode === "spectrum" && state.monoSamples) {
    // Simple energy bars per channel based on detected event counts
    var channelList = ["kick", "snare", "hihat", "bass", "melody", "vocal"];
    var barW = w / channelList.length;
    var maxCount = 0;
    channelList.forEach(function (ch) {
      var cnt = state.channels[ch].results.length;
      if (cnt > maxCount) maxCount = cnt;
    });
    if (maxCount === 0) maxCount = 1;

    channelList.forEach(function (ch, idx) {
      var cfg = state.channels[ch];
      var cnt = cfg.results.length;
      var barH = (cnt / maxCount) * (h - 20);
      var x = idx * barW + 2;
      ctx.fillStyle = colors[ch] || "#999";
      ctx.globalAlpha = cfg.enabled ? 0.8 : 0.25;
      ctx.fillRect(x, h - barH - 10, barW - 4, barH);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#888";
      ctx.font = "7px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ch, x + (barW - 4) / 2, h - 2);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;
    });
    return;
  }

  // ── Legend ──
  var legendY = 8;
  ctx.font = "8px -apple-system, sans-serif";
  ctx.globalAlpha = 1;
  for (var lch in state.channels) {
    var lcfg = state.channels[lch];
    if (!lcfg.enabled || !lcfg.results || lcfg.results.length === 0) continue;
    var lc = colors[lch] || "#999";
    ctx.fillStyle = lc;
    ctx.fillRect(4, legendY - 5, 6, 6);
    ctx.fillStyle = "#888";
    ctx.fillText(lch + " (" + lcfg.results.length + ")", 14, legendY);
    legendY += 11;
  }
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

document.getElementById("namePattern").addEventListener("input", function (e) {
  state.namePattern = e.target.value || "{type} {bar}.{beat}";
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

    // Apply offset using actual sequence fps
    var offsetSec = state.offsetFrames / (rangeInfo.fps || 24);
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

    // ── Deduplication: clear previous detected batch in same range ──
    // This prevents duplicate markers when re-running Place Detected Markers.
    function doPlaceBatch() {
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
          // Tag comments with [DETECT] so we can identify these markers later
          comments: "[DETECT] " + typeName + " | " + ev.time.toFixed(3) + "s | str:" + ev.strength.toFixed(2),
          color: ev.color,
        };
      });

      // Track for undo (both general undo and detected-specific deduplication)
      state.lastBatchStartTime = batch[0].time;
      state.lastBatchEndTime = batch[batch.length - 1].time;
      state.lastBatchCount = batch.length;

      state.lastDetectedBatchStart = batch[0].time;
      state.lastDetectedBatchEnd = batch[batch.length - 1].time;
      state.lastDetectedBatchCount = batch.length;

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
    }

    // If a previous detected batch exists, remove it first to prevent duplication
    if (state.lastDetectedBatchCount > 0 && state.lastDetectedBatchStart !== null) {
      setStatus("working", "Replacing previous detected markers...");
      var clearStart = state.lastDetectedBatchStart - 0.001;
      var clearEnd = state.lastDetectedBatchEnd + 0.001;
      // Clear only [DETECT]-tagged markers in the previous range
      evalScript("clearMarkersByCommentPrefix(" + clearStart + "," + clearEnd + ",'[DETECT]')").then(function () {
        state.lastDetectedBatchCount = 0;
        doPlaceBatch();
      }).catch(function () {
        // Fallback: proceed without clearing if the function isn't available
        doPlaceBatch();
      });
    } else {
      doPlaceBatch();
    }
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

    var offsetSec = state.offsetFrames / (rangeInfo.fps || 24);
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
        comments: "[GRID] Bar " + bar + " | Beat " + beat + "." + sub + " | " + state.bpm + " BPM",
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
      state.lastDetectedBatchCount = 0;
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
      state.lastBatchCount = 0;
      state.lastDetectedBatchCount = 0;
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
  evalScript("getInOutRange()").then(function (rangeRes) {
    var fps = 24;
    try {
      var rangeInfo = JSON.parse(rangeRes);
      if (rangeInfo.fps && rangeInfo.fps > 0) fps = rangeInfo.fps;
    } catch (e) {}
    evalScript("getPlayheadFrames(" + fps + ")").then(function (res) {
      var frames = parseInt(res);
      if (frames >= 0) {
        state.offsetFrames = frames;
        document.getElementById("offsetFrames").value = frames;
        setStatus("ready", "Offset: frame " + frames);
      } else {
        setStatus("error", "Could not read playhead");
      }
    });
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
