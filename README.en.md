<h1 align="center">Rimlight</h1>

<p align="center"><img src="docs/icon-256.png" width="112" alt="Rimlight icon"></p>

<p align="center">A lightweight cosmetic plugin for DeepSeek Harness: a comet-like light band that flows along the window edge while a session is thinking.</p>

<p align="center">
  <a href="https://polang233.github.io/dsh-plugin-index/zh/plugins/dsh-rimlight/"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2Fdsh-rimlight.json&amp;style=flat-square" alt="Open Plugin Market" height="20"></a>
  <a href="https://www.npmjs.com/package/dsh-rimlight"><img src="https://img.shields.io/npm/v/dsh-rimlight?style=flat-square&amp;label=npm" alt="npm version" height="20"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/dsh-rimlight?style=flat-square" alt="license" height="20"></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <strong>English</strong>
</p>

<p align="center">
  <a href="https://xn--de-gj5f71e.luxe">Live preview</a> ·
  <a href="#installation">Install</a> ·
  <a href="#settings">Settings</a>
</p>

## Effect

![Comet-like light band flowing along the window edge while thinking](docs/effect-edge.png)

*The lab has a dark / light switch in its top-right corner, dark by default.*

<sub>Captured from the lab page, which renders a replica of the client window in the dark theme.</sub>

## How it works

Once a session enters the thinking state, a comet-like light band appears on the rounded frame of the client window and travels around it. Every session that is thinking at the same time gets its own band — up to four — colored by the model that session is using and evenly spaced along the same loop. When a session finishes, its band flies to the matching spot in the interface, makes one lap around it, and fades out.

## Features

| Behavior | Description |
| --- | --- |
| **Flow while thinking** | While a session runs, the band travels clockwise along the rounded frame: the head is the brightest, the tail trails off in a gradient, and the band bends along the rounded corners of the track. |
| **Multiple sessions** | Up to four bands, one per session. When a new band joins, all bands adjust their speed together and settle on evenly spaced positions within 4 seconds. |
| **Reverse while waiting** | When a session waits for user input, the direction flips to counter-clockwise; it returns to clockwise after the reply. Direction changes are eased. |
| **Model-based colors** | Each band takes its color from the model of its own session. Twelve presets ship with the plugin (see below); a single global palette can be pinned in the settings. |
| **Edge glow** | A white highlight and a soft halo are layered around the band. Can be turned off in the settings. |
| **Exit path** | When a session ends, its band flies to the matching target and fades out after one lap: current conversation → input box; background session → its row in the sidebar; row not visible → workspace area; sidebar collapsed → the expand button. |
| **Render isolation** | Drawn on a separate overlay. No host code is modified, no pointer events are captured, and all DOM and geometry access is guarded, so a plugin failure cannot break client rendering. |

| Evenly spaced bands | Reverse flow while waiting |
| --- | --- |
| ![Three bands](docs/effect-three.png) | ![Reverse flow](docs/effect-reverse.png) |

![Bend detail at a corner](docs/detail-corner.png)

## Colors

Gradients run from tail to head. The table lists the solid stops; the tail starts and ends with the same color at low opacity, so the first fully opaque stop is used as the starting point:

| key | Name | Gradient (tail → head) | Notes |
| --- | --- | --- | --- |
| `deepseek` | DeepSeek | `#2f6bff` → `#5b8dff` → `#eaf2ff` | — |
| `kimi` | Kimi | `#8f97a8` → `#e6eaf2` → `#ffffff` | Floating particles in the tail |
| `openai` | OpenAI | `#6f9b8b` → `#cfe6dd` → `#f4fffa` | — |
| `claude` | Claude | `#e07a4f` → `#b64f28` → `#ffeada` | — |
| `zhipu` | GLM | `#7285ab` → `#bccce8` → `#f4f8ff` | — |
| `gemini` | Gemini | `#34a853` → `#fbbc05` → `#ea4335` → `#ffffff` | Google's four colors |
| `qwen` | Qwen | `#1d3fd6` → `#3f6bff` → `#dbe6ff` | — |
| `grok` | Grok | `#141518` → `#c9ccd4` → `#ffffff` | Black to white |
| `minimax` | MiniMax | `#ff5fc0` → `#ff2d63` → `#ffdcec` | — |
| `meta` | Meta | `#2f7bff` → `#0866ff` → `#e2eeff` | — |
| `nvidia` | NVIDIA | `#76b900` → `#a4e01f` → `#f4ffd9` | — |
| `unknown` | Prism | Layered translucent whites | Liquid glass: dispersion and edge deformation |

Model detection uses the model id and name first, and the provider only as a fallback. When nothing matches, **Prism** is used; a different palette can be chosen in the settings.

## Installation

Requirement: **DeepSeek Harness**. The plugin is a standard DSH bundle package (`cordis.patch.yml` plus a client module) and can be installed into any profile.

### Option 1: From the plugins page (recommended)

1. Get this directory (`dsh-rimlight/`).
2. Open the **Plugins** page, choose to install a local plugin, and point it at that directory.
3. A successful install returns `application: applied` and takes effect immediately. If the UI does not update, restart the client once.

### Option 2: Command line

`dsh` ships with the client (next to `DeepSeek Harness.exe`, at `runtime/cli/bin/dsh.cmd`; the installer usually adds it to `PATH`, otherwise call it by full path). It forwards its arguments to the pnpm of the target profile:

```bash
# Link the plugin directory into a profile (desktop is an example; substitute the actual profile name)
dsh plugin --profile desktop add "link:/absolute/path/to/dsh-rimlight"
```

The `link:` prefix links the local directory instead of pulling from a registry. The client writes the package into the profile's `dependencies` and merges it into `dsh.profile.bundles` according to the `dsh.bundle.patch` declared in the package. The plugin becomes active after the client restarts.

### Option 3: From npm

Once published to npm, the package name alone is enough:

```bash
dsh plugin --profile desktop add dsh-rimlight
```

pnpm fetches the prebuilt artifact. The plugin has no install-time build step, so no `allowBuilds` approval is needed.

### Option 4: From GitHub

Installing straight from the repository also works:

```bash
dsh plugin --profile desktop add "github:<owner>/<repo>"
```

Replace `<owner>/<repo>` with the repository, for example `github:someone/dsh-rimlight`. A branch or tag can be appended as `github:<owner>/<repo>#<ref>`.

### Uninstall

```bash
dsh plugin --profile desktop remove dsh-rimlight
```

This removes the entry from both `dependencies` and `dsh.profile.bundles`. The plugin can also be removed from the **Plugins** page.

## Settings

Found under **Plugins → Rimlight → Settings**.

| Setting | Default | Range | Description |
| --- | --- | --- | --- |
| Trail length `trailLength` | 320 | 40–1200 | Visible tail length (px) |
| Thickness `thickness` | 6 | 2–24 | Band width (px) |
| Speed multiplier `speed` | 1.6 | 0.3–3 | How fast the band travels one lap |
| Sweep amplitude `sweep` | 0.62 | 0–0.95 | Speed variation within one lap: `0` is constant speed; larger values slow the band down in corners and speed it up on straight edges. Changes are eased in over 200 ms |
| Edge glow `edgeGlow` | On | — | White highlight and soft halo around the band |
| Auto color by conversation model `modelColor` | On | — | When off, the global palette is used |
| Global palette `theme` | — | 12 presets | Shown only when auto coloring is off |
| Palette for unknown models `unknownTheme` | Prism | 12 presets | Used when the model name cannot be recognized |

The settings panel follows the client language and is available in Simplified Chinese and English.

## Lab

`lab/rimlight-lab.html` and `lab/rimlight-lab.js` form a standalone interactive lab. It loads this plugin's `client.js` directly and reuses the same track geometry and animation code to render the effect inside a replica of the client window. Parameters can be adjusted live, palettes switched, and states such as multiple sessions, waiting for a reply, output finished, and manual interruption simulated.

Run it locally from the repository root:

```bash
python -m http.server 8733 --bind 127.0.0.1
# then open http://127.0.0.1:8733/lab/rimlight-lab.html
```

Common URL parameters (useful for scripted screenshots or sharing a specific state):

| Parameter | Description |
| --- | --- |
| `mode=thinking` \| `streaming` \| `done` \| `stop` | Initial state |
| `n=1..4` | Number of concurrent bands |
| `trail=320` / `t=6` | Trail length / thickness |
| `theme=kimi` | Force a specific palette |
| `multi=1` | Give each band its own palette |
| `reply=1` | Waiting for a reply (reverse flow) |
| `sweep=0` | Sweep amplitude (`0` is constant speed) |
| `warm=1600` | Pre-run N milliseconds to capture a specific phase in a single frame |
| `click=reset,think&after=900` | Click panel buttons in order, then pre-run |

## Project layout

```
dsh-rimlight/
├── client.js          # Client half: overlay rendering, track geometry, animation, settings panel, i18n
├── index.js           # Host half: config schema (schemastery)
├── cordis.patch.yml   # Bundle patch: inserts the plugin into a profile
├── package.json
├── icon.svg
├── locale/
│   ├── zh.json
│   └── en.json
├── lab/               # Standalone lab
│   ├── rimlight-lab.html
│   └── rimlight-lab.js
├── docs/              # Images used by this README
├── screenshots.json   # Screenshot list for the plugin marketplace page
└── LICENSE
```

## Compatibility

- Runs in the client rendering layer of DSH and loads with the client once installed into a profile.
- A native caption-button strip would paint over the drawing, so the plugin cuts that area out with a feathered ramp; since 1.0.1 the cut is decided at runtime, so environments without such a strip (a plain browser tab, for example) no longer blank it.
- Depends on public modules provided by the host (`react`, `@deepseek-ai/dsh-client-ui-*`, `@deepseek-ai/schemastery`). These modules are neither bundled nor redistributed.
- The band is drawn on a separate overlay: it does not participate in layout and does not capture pointer events.
- Detecting the "final answer" relies on the DOM structure of the host UI. If a host upgrade renames internal class names, that detection can stop working; the plugin then degrades to always running along the frame, without affecting client stability.

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE) (MPL-2.0).
