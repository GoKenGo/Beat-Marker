/**
 * ════════════════════════════════════════════════════════
 *  BEAT MARKER PRO — ExtendScript Host (Premiere Pro)
 *  Handles marker creation, sequence info, playhead access
 * ════════════════════════════════════════════════════════
 *
 *  Called from the CEP panel via csInterface.evalScript()
 *  ExtendScript runs in Premiere's scripting engine (ES3)
 */

// ══════════════════════════════════════════════════════
//  SEQUENCE INFO
// ══════════════════════════════════════════════════════

function getSequenceInfo() {
  var seq = app.project.activeSequence;
  if (!seq) return JSON.stringify({ error: "No active sequence" });

  var fps = 23.976;
  try {
    // Get frame rate from sequence settings
    var timebase = seq.videoDisplayFormat;
    // Try to extract from the sequence's time display
    var seqEnd = seq.end;
    if (seqEnd && parseFloat(seqEnd) > 0) {
      fps = seq.getSettings().videoFrameRate
        ? parseFloat(seq.getSettings().videoFrameRate)
        : 23.976;
    }
  } catch (e) {
    fps = 23.976;
  }

  // Try getting framerate from timebase
  try {
    var ticks = seq.getPlayerPosition().ticks;
    fps = seq.getSettings().videoFrameRate
      ? parseFloat(seq.getSettings().videoFrameRate)
      : 23.976;
  } catch (e2) {}

  var info = {
    name: seq.name,
    id: seq.sequenceID,
    inPoint: seq.getInPointAsTime().seconds,
    outPoint: seq.getOutPointAsTime().seconds,
    endTime: seq.end,
    playerPosition: seq.getPlayerPosition().seconds,
    fps: fps,
    numMarkers: seq.markers.numMarkers,
    numVideoTracks: seq.videoTracks.numTracks,
    numAudioTracks: seq.audioTracks.numTracks,
  };

  return JSON.stringify(info);
}

// ══════════════════════════════════════════════════════
//  GET PLAYHEAD POSITION
// ══════════════════════════════════════════════════════

function getPlayheadSeconds() {
  var seq = app.project.activeSequence;
  if (!seq) return "-1";
  return String(seq.getPlayerPosition().seconds);
}

function getPlayheadFrames(fps) {
  var seq = app.project.activeSequence;
  if (!seq) return "-1";
  var secs = parseFloat(seq.getPlayerPosition().seconds);
  return String(Math.round(secs * fps));
}

// ══════════════════════════════════════════════════════
//  GET RANGE (IN/OUT)
// ══════════════════════════════════════════════════════

function getInOutRange() {
  var seq = app.project.activeSequence;
  if (!seq) return JSON.stringify({ error: "No active sequence" });

  var fps = 24;
  try {
    var seqFps = parseFloat(seq.getSettings().videoFrameRate);
    if (seqFps && seqFps > 0) fps = seqFps;
  } catch (e) {}

  var result = {
    inPoint: parseFloat(seq.getInPointAsTime().seconds),
    outPoint: parseFloat(seq.getOutPointAsTime().seconds),
    endTime: parseFloat(seq.end),
    playerPosition: parseFloat(seq.getPlayerPosition().seconds),
    fps: fps,
  };

  return JSON.stringify(result);
}

// ══════════════════════════════════════════════════════
//  CREATE A SINGLE MARKER
// ══════════════════════════════════════════════════════

/**
 * Creates a single sequence marker at the given time.
 *
 * @param {number} timeSeconds — position in seconds
 * @param {string} name — marker name
 * @param {string} comments — marker comment
 * @param {number} colorIndex — Premiere marker color (0-7)
 *   0=Green, 1=Red, 2=Purple, 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan
 *
 * @returns {string} "ok" or error message
 */
function createMarker(timeSeconds, name, comments, colorIndex) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "error:No active sequence";

    var markers = seq.markers;
    var newMarker = markers.createMarker(parseFloat(timeSeconds));

    if (newMarker) {
      newMarker.name = name || "";
      newMarker.comments = comments || "";

      // Set marker color
      // Premiere Pro marker colors: 0=Green, 1=Red, 2=Purple,
      // 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan
      try {
        newMarker.setColorByIndex(parseInt(colorIndex) || 0);
      } catch (colorErr) {
        // setColorByIndex may not be available in older versions
        // Fall back silently
      }

      return "ok";
    }
    return "error:Marker creation returned null";
  } catch (e) {
    return "error:" + e.toString();
  }
}

// ══════════════════════════════════════════════════════
//  BATCH CREATE MARKERS
// ══════════════════════════════════════════════════════

/**
 * Creates multiple markers from a JSON array.
 * Each element: { time: seconds, name: string, comments: string, color: int }
 *
 * We batch these to minimize evalScript round-trips.
 *
 * @param {string} jsonStr — JSON array of marker objects
 * @returns {string} — JSON result with count and errors
 */
function createMarkerBatch(jsonStr) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "No active sequence", placed: 0 });

    var markers = seq.markers;
    var batch = JSON.parse(jsonStr);
    var placed = 0;
    var errors = 0;

    for (var i = 0; i < batch.length; i++) {
      try {
        var item = batch[i];
        var m = markers.createMarker(parseFloat(item.time));
        if (m) {
          m.name = item.name || "";
          m.comments = item.comments || "";
          try {
            m.setColorByIndex(parseInt(item.color) || 0);
          } catch (ce) {}
          placed++;
        } else {
          errors++;
        }
      } catch (itemErr) {
        errors++;
      }
    }

    return JSON.stringify({ placed: placed, errors: errors, total: batch.length });
  } catch (e) {
    return JSON.stringify({ error: e.toString(), placed: 0 });
  }
}

// ══════════════════════════════════════════════════════
//  CLEAR MARKERS
// ══════════════════════════════════════════════════════

/**
 * Removes all sequence markers.
 */
function clearAllMarkers() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "error:No active sequence";

    var markers = seq.markers;
    var firstMarker = markers.getFirstMarker();
    var count = 0;

    while (firstMarker) {
      markers.deleteMarker(firstMarker);
      count++;
      firstMarker = markers.getFirstMarker();
      // Safety
      if (count > 10000) break;
    }

    return JSON.stringify({ removed: count });
  } catch (e) {
    return "error:" + e.toString();
  }
}

/**
 * Removes markers within a time range (for undo-last-batch).
 * We store the time range of the last batch on the panel side.
 */
function clearMarkersInRange(startSec, endSec, namePrefix) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return "error:No active sequence";

    var markers = seq.markers;
    var marker = markers.getFirstMarker();
    var toDelete = [];
    var count = 0;

    // Collect markers to delete (can't modify while iterating)
    while (marker) {
      var mTime = parseFloat(marker.start.seconds);
      var mName = marker.name || "";

      if (mTime >= parseFloat(startSec) && mTime <= parseFloat(endSec)) {
        // If namePrefix provided, only delete matching markers
        if (!namePrefix || mName.indexOf(namePrefix) === 0) {
          toDelete.push(marker);
        }
      }

      marker = markers.getNextMarker(marker);
      count++;
      if (count > 50000) break; // Safety
    }

    // Delete collected markers
    for (var i = 0; i < toDelete.length; i++) {
      try {
        markers.deleteMarker(toDelete[i]);
      } catch (de) {}
    }

    return JSON.stringify({ removed: toDelete.length });
  } catch (e) {
    return "error:" + e.toString();
  }
}

// ══════════════════════════════════════════════════════
//  LIST EXISTING MARKERS
// ══════════════════════════════════════════════════════

function listMarkers(maxCount) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    var markers = seq.markers;
    var result = [];
    var marker = markers.getFirstMarker();
    var limit = parseInt(maxCount) || 500;
    var i = 0;

    while (marker && i < limit) {
      result.push({
        time: parseFloat(marker.start.seconds),
        name: marker.name || "",
        comments: marker.comments || "",
      });
      marker = markers.getNextMarker(marker);
      i++;
    }

    return JSON.stringify({ markers: result, total: i });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// ══════════════════════════════════════════════════════
//  GET SELECTED CLIP SOURCE PATH (for Timeline Analysis)
// ══════════════════════════════════════════════════════

/**
 * Returns the source file path and timing info for the currently selected
 * clip in the timeline. Checks both audio and video tracks.
 *
 * @returns {string} JSON: { path, name, startTime, endTime, inPoint, outPoint }
 *                   or   { error: "message" }
 */
function getSelectedClipSourcePath() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "No active sequence" });

    // Check audio tracks first
    var audioTracks = seq.audioTracks;
    for (var at = 0; at < audioTracks.numTracks; at++) {
      var atrack = audioTracks[at];
      var aclips = atrack.clips;
      for (var ac = 0; ac < aclips.numItems; ac++) {
        var aclip = aclips[ac];
        if (aclip.isSelected()) {
          try {
            var apath = aclip.projectItem.getMediaPath();
            return JSON.stringify({
              path: apath,
              name: aclip.projectItem.name || aclip.name,
              startTime: parseFloat(aclip.start.seconds),
              endTime: parseFloat(aclip.end.seconds),
              inPoint: parseFloat(aclip.inPoint.seconds),
              outPoint: parseFloat(aclip.outPoint.seconds),
            });
          } catch (ae) {
            return JSON.stringify({ error: "Cannot access audio clip media: " + ae.toString() });
          }
        }
      }
    }

    // Fall back to video tracks (clips with linked audio)
    var videoTracks = seq.videoTracks;
    for (var vt = 0; vt < videoTracks.numTracks; vt++) {
      var vtrack = videoTracks[vt];
      var vclips = vtrack.clips;
      for (var vc = 0; vc < vclips.numItems; vc++) {
        var vclip = vclips[vc];
        if (vclip.isSelected()) {
          try {
            var vpath = vclip.projectItem.getMediaPath();
            return JSON.stringify({
              path: vpath,
              name: vclip.projectItem.name || vclip.name,
              startTime: parseFloat(vclip.start.seconds),
              endTime: parseFloat(vclip.end.seconds),
              inPoint: parseFloat(vclip.inPoint.seconds),
              outPoint: parseFloat(vclip.outPoint.seconds),
            });
          } catch (ve) {}
        }
      }
    }

    return JSON.stringify({ error: "No clip selected — click a clip in the timeline first" });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

// ══════════════════════════════════════════════════════
//  CLEAR MARKERS BY COMMENT PREFIX
// ══════════════════════════════════════════════════════

/**
 * Removes markers in a time range whose comments start with a given prefix.
 * Used for deduplication: detected markers are tagged with "[DETECT]",
 * so re-running Place Detected Markers can clear only its own previous markers.
 *
 * @param {number} startSec      range start (seconds)
 * @param {number} endSec        range end (seconds)
 * @param {string} commentPrefix only delete markers whose comments start with this
 * @returns {string} JSON { removed: N }
 */
function clearMarkersByCommentPrefix(startSec, endSec, commentPrefix) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "No active sequence", removed: 0 });

    var markers = seq.markers;
    var marker = markers.getFirstMarker();
    var toDelete = [];
    var count = 0;

    while (marker) {
      var mTime = parseFloat(marker.start.seconds);
      var mComment = marker.comments || "";

      if (mTime >= parseFloat(startSec) && mTime <= parseFloat(endSec)) {
        // Delete if no prefix filter, or if comment starts with the prefix
        if (!commentPrefix || mComment.indexOf(commentPrefix) === 0) {
          toDelete.push(marker);
        }
      }

      marker = markers.getNextMarker(marker);
      count++;
      if (count > 50000) break; // Safety
    }

    for (var i = 0; i < toDelete.length; i++) {
      try { markers.deleteMarker(toDelete[i]); } catch (de) {}
    }

    return JSON.stringify({ removed: toDelete.length });
  } catch (e) {
    return JSON.stringify({ error: e.toString(), removed: 0 });
  }
}

// ══════════════════════════════════════════════════════
//  UTILITY: CHECK CONNECTION
// ══════════════════════════════════════════════════════

function ping() {
  try {
    var seq = app.project.activeSequence;
    return JSON.stringify({
      status: "connected",
      hasSequence: !!seq,
      sequenceName: seq ? seq.name : "",
      ppVersion: app.version,
    });
  } catch (e) {
    return JSON.stringify({ status: "error", error: e.toString() });
  }
}
