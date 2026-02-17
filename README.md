# Beat Marker Pro v2 — Premiere Pro UXP Plugin

Automatically detect beats, drums, bass, and melody in audio and place color-coded markers on your Premiere Pro timeline for music video editing. Two modes: **audio-reactive detection** (analyzes actual music) and **BPM grid** (evenly-spaced markers).

## Features

### 🎯 Audio Detection (NEW in v2)
- **Multi-band spectral analysis** — FFT-based frequency separation into 6 bands (20Hz–20kHz)
- **Kick drum detection** — Sub-bass + bass energy peaks (20–300 Hz)
- **Snare detection** — Mid-range transients with spectral broadness analysis (300–6kHz)
- **Hi-hat / cymbal detection** — High-frequency content weighting (6–20kHz)
- **Bass line detection** — Low-frequency spectral flux for note changes
- **Melody detection** — Spectral centroid flux tracking for pitch/note changes
- **Vocal onset detection** — Vocal-range phrase boundary detection (300–4kHz)
- **Per-channel sensitivity sliders** — Dial in detection for each instrument
- **Per-channel marker colors** — Instant visual differentiation on the timeline
- **Waveform + onset visualization** — See detected events overlaid on audio

### 🎵 BPM Grid Mode
- **Manual BPM input** — Type any BPM from 20–300
- **Tap Tempo** — Press `T` / `Space` to detect tempo by feel
- **Auto BPM detection** — Estimated from audio via autocorrelation
- **Subdivision control** — Whole, half, quarter, eighth note grids
- **Triplet mode** — Swing / shuffle feels
- **Time signature** — 2/4, 3/4, 4/4, 5/4, 6/4, 7/4
- **Metronome preview** — Audio click to verify BPM

### 📍 Placement
- **Flexible range** — In/Out points, from playhead, or full sequence
- **Frame-accurate offset** — Align to actual first beat
- **Custom naming** — `{type}`, `{bar}`, `{beat}`, `{sub}`, `{n}` tokens
- **Undo last batch** or clear all markers

## Installation

### Method 1: UXP Developer Tool (Recommended for development)

1. Download and install the [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/installation/)
2. Open the UXP Developer Tool
3. Click "Add Plugin" and select the `manifest.json` file from this folder
4. Click "Load" to load the plugin into Premiere Pro
5. The "Beat Marker Pro" panel will appear in Premiere Pro

### Method 2: Manual Install (Production)

1. Copy the entire `beat-marker-pro` folder to your Premiere Pro plugins directory:
   - **macOS:** `~/Library/Application Support/Adobe/UXP/Plugins/External/`  
   - **Windows:** `%APPDATA%\Adobe\UXP\Plugins\External\`
2. Create the `External` folder if it doesn't exist
3. Restart Premiere Pro
4. Find the panel under **Window → Extensions → Beat Marker Pro**

### Method 3: Package as .ccx (Distribution)

Use the UXP Developer Tool to package the plugin as a `.ccx` file for distribution through the Adobe Exchange or direct install.

## Usage

### Quick Start

1. Open a sequence with music in Premiere Pro
2. Open **Beat Marker Pro** from the Extensions menu
3. Set your BPM:
   - Type it in manually
   - Use **Tap Tempo** (press `T` key repeatedly on the beat)
   - Drop an audio file for automatic detection
4. Set your **In/Out points** on the timeline (or choose a different range)
5. Click **▶ Place Beat Markers**

### Marker Naming

Use these tokens in the name pattern:

| Token    | Description              | Example |
|----------|--------------------------|---------|
| `{bar}`  | Current bar number       | 1, 2, 3 |
| `{beat}` | Beat within the bar      | 1, 2, 3, 4 |
| `{sub}`  | Subdivision within beat  | 1, 2 |
| `{n}`    | Sequential beat number   | 1, 2, 3... |

Default pattern: `Beat {bar}.{beat}` → "Beat 1.1", "Beat 1.2", etc.

### Keyboard Shortcuts

| Key         | Action     |
|-------------|------------|
| `T`         | Tap Tempo  |
| `Space`     | Tap Tempo  |

### Tips

- **For music videos:** Use quarter notes (♩) for cuts on every beat, eighth notes (♪) for faster cuts
- **For slow songs:** Half notes work great for more relaxed pacing
- **Use the offset** to align the first marker with the actual first beat in your audio
- **Try the metronome preview** to verify your BPM matches the music before placing markers
- **Color coding** makes it easy to see bar starts vs regular beats on the timeline

## How the Audio Detection Works

The plugin uses **Short-Time Fourier Transform (STFT)** to convert audio into a spectrogram, then separates it into 6 frequency bands:

| Band | Range | Detects |
|------|-------|---------|
| Sub Bass | 20–80 Hz | Kick fundamental |
| Bass | 80–300 Hz | Bass guitar, synth bass |
| Low Mid | 300–2000 Hz | Snare body, vocals, guitar |
| High Mid | 2000–6000 Hz | Melody clarity, snare crack |
| Presence | 6000–12000 Hz | Hi-hats, cymbals |
| Brilliance | 12000–20000 Hz | Shimmer, air |

Each detection channel combines relevant bands with specialized analysis:
- **Kick**: Energy peaks in sub-bass + bass
- **Snare**: Transients in low/high mid + spectral broadness (noise-like = snare)
- **Hi-hat**: High-frequency content (HFC) weighting
- **Bass**: Spectral flux in low bands (note changes, not just energy)
- **Melody**: Spectral centroid flux (pitch movement tracking)
- **Vocal**: Vocal-range spectral flux (300–4kHz)

Onset detection uses **adaptive thresholding** with peak picking and minimum interval constraints. Sensitivity sliders control the threshold multiplier per channel.

## Technical Notes

- Premiere Pro uses **ticks** internally (254,016,000,000 ticks/second)
- FFT size: 2048 samples, hop: 512 (≈23ms resolution at 44.1kHz)
- Analysis runs in the browser's AudioContext — no external dependencies
- Maximum 5,000 markers per batch (safety limit)
- Requires Premiere Pro 2025 (v25.0+) for UXP support

## File Structure

```
beat-marker-pro/
├── manifest.json       # UXP plugin manifest
├── index.html          # Panel UI (3-tab layout)
├── index.js            # Controller (UI, PPro API, placement)
├── audio-analyzer.js   # DSP engine (FFT, band separation, onset detection)
├── icons/              # Plugin icons (create 24x24 PNG)
└── README.md
```

## License

Free to use and modify. Built for the editing community.
