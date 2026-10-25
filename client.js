window.__ModuleLoader__.load({
	id: "dsh-rimlight",
	factory(require) {
		"use strict";

		// The loader calls this factory as a plain function: it supplies
		// `require` but no CommonJS `module`/`exports` scope. Declare them here
		// so the CJS-style assignments at the bottom of this file resolve.
		// NEVER remove these two lines: without them the client boot dies on
		// `exports is not defined` and takes the whole DSH start-up with it.
		var module = { exports: {} };
		var exports = module.exports;

		try {
			const React = require("react");
			const { useState, useEffect, useRef } = React;
			const h = React.createElement;
			const NS = "dsh-rimlight";
			const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
			const { SettingsForm, SettingsValueField, settingsNumberField, SettingsFormModel } = primitives;
			const settingsTextField = typeof primitives.settingsTextField === "function" ? primitives.settingsTextField : null;
			const SwitchControl = typeof primitives.Switch === "function" ? primitives.Switch : null;

			// ------------------------------------------------------------------
			// Settings copy, bilingual. The panel follows the client locale;
			// `localeService` is captured in apply() and read through a
			// subscription so switching the language repaints the form at once.
			// ------------------------------------------------------------------
			const UI_TEXT = {
				zh: {
					unavailable: "该插件当前未加载，暂时无法配置。",
					readOnly: "本部署的设置为只读。",
					saveFailed: "本部署没有接受这些值，已保留供你修改。",
					save: "保存",
					saving: "保存中…",
					reset: "重置",
					overridden: "已覆盖",
					invalid: "无效数值",
					trail: "拖尾长度 (px)",
					trailHint: "流星拖尾的可见长度，范围 40–1200 像素",
					thickness: "粗细 (px)",
					thicknessHint: "光带的宽度，范围 2–24 像素，默认 6",
					sweep: "扫掠幅度",
					sweepHint: "边框上一圈之内的速度呼吸幅度：0 为匀速，0.62 为默认（拐角慢、直边快），范围 0–0.95",
					speed: "速度倍率",
					speedHint: "沿边框绕行的快慢：1 为默认，0.5 更慢、2 更快（范围 0.3–3）",
					modelColor: "根据对话使用模型自动选择配色",
					theme: "全局配色",
					unknownTheme: "无法识别时使用的配色",
					edgeGlow: "泛光开关",
				},
				en: {
					unavailable: "This plugin isn't loaded right now, so it can't be configured.",
					readOnly: "Settings are read-only on this deployment.",
					saveFailed: "This deployment rejected these values; they are kept for you to edit.",
					save: "Save",
					saving: "Saving...",
					reset: "Reset",
					overridden: "Overridden",
					invalid: "Invalid value",
					trail: "Trail length (px)",
					trailHint: "Visible length of the comet tail, 40-1200 px",
					thickness: "Thickness (px)",
					thicknessHint: "Width of the band, 2-24 px, default 6",
					sweep: "Sweep amplitude",
					sweepHint: "How much the speed breathes over one lap: 0 is constant speed, 0.62 is the default (slow in the corners, quick along the edges), 0-0.95",
					speed: "Speed multiplier",
					speedHint: "How fast the band circles the frame: 1 is the default, 0.5 slower, 2 faster (0.3-3)",
					modelColor: "Pick colours from the model each conversation uses",
					theme: "Global palette",
					unknownTheme: "Palette when the model is unknown",
					edgeGlow: "Glow",
				},
			};
			let localeService = null;
			function readActiveLocale() {
				try {
					const snap = localeService && typeof localeService.getSnapshot === "function"
						? localeService.getSnapshot()
						: null;
					return (snap && snap.active) || "";
				} catch (e) {
					return "";
				}
			}
			function pickUiLang(active) {
				const tag = String(active || "").toLowerCase();
				if (tag.indexOf("zh") === 0) return "zh";
				if (tag) return "en";
				let device = "";
				try { device = String((typeof navigator !== "undefined" && navigator.language) || ""); } catch (e) { device = ""; }
				return device.toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
			}
			function uiT(lang) {
				const dict = UI_TEXT[lang] || UI_TEXT.en;
				return function (key) {
					if (dict[key] != null) return dict[key];
					if (UI_TEXT.en[key] != null) return UI_TEXT.en[key];
					return key;
				};
			}
			function useUiStrings() {
				const [active, setActive] = useState(readActiveLocale);
				useEffect(function () {
					if (!localeService || typeof localeService.subscribe !== "function") return undefined;
					let off = null;
					try { off = localeService.subscribe(function () { setActive(readActiveLocale()); }); } catch (e) { off = null; }
					setActive(readActiveLocale());
					return function () { try { if (typeof off === "function") off(); } catch (e) { /* noop */ } };
				}, []);
				return uiT(pickUiLang(active));
			}

			const DEFAULT_TRAIL = 320;
			const TRAIL_MIN = 40;
			const TRAIL_MAX = 1200;
			const DEFAULT_THICKNESS = 6;
			const DEFAULT_SPEED = 1.6;
			const SPEED_MIN = 0.3;
			const SPEED_MAX = 3;
			const THICKNESS_MIN = 2;
			const THICKNESS_MAX = 24;
			const ALPHA = 0.95;
			const PULSE_MS = 2400;
			// Amplitude of the periodic speed wave. 0 = constant speed. The speed
			// at p=0 equals the speed at p=1, so the loop never stalls at the
			// seam. Keep strictly below 1 or the comet freezes somewhere on the
			// lap (at 1.0 the derivative hits zero).
			// How much the speed breathes over one lap: 0 is constant speed, 0.62 is
			// the shipped tuning (slow at the corners, quick along an edge). The
			// value is a live setting, so it lives in a module variable rather than
			// a const; the frame loop eases towards it instead of snapping.
			const DEFAULT_SWEEP = 0.62;
			const SWEEP_MIN = 0;
			// At 1.0 the slowest point of the profile is exactly 0px/ms, which would
			// park the band on every corner, so the dial stops just short of it.
			const SWEEP_MAX = 0.95;
			let SWEEP_AMP = DEFAULT_SWEEP;
			let SWEEP_TARGET = DEFAULT_SWEEP;
			function setSweepAmp(value) {
				// Note "value || default": 0 is a meaningful amplitude (no breathing at all)
			// and must survive the clamp, hence the explicit isFinite test.
			const v = Number(value);
			SWEEP_TARGET = Math.max(SWEEP_MIN, Math.min(SWEEP_MAX, isFinite(v) ? v : DEFAULT_SWEEP));
			}
			function stepSweepAmp(dt) {
				const k = Math.min(1, Math.max(0, dt) / 200);
				SWEEP_AMP += (SWEEP_TARGET - SWEEP_AMP) * k;
			}
			// How many points the ribbon is sampled at along its tail.
			const RIBBON_STEPS = 34;
			// One ribbon per concurrently working seat, capped so the frame never
			// turns into a light show.
			const MAX_COMETS = 4;
			// How long a newly spawned ribbon takes to slide from the send button
			// to its own slot on the ring.
			const BIRTH_MS = 1000;
			// A newborn ribbon is thrown from the send button to the tail of a
			// ribbon that was already running, so the two read as one continuous
			// stream. Short hops still get a visible throw, long ones cap out.
			const FLY_MS = 1150;
			const FLY_MAX_MS = 3200;
			const FLY_MIN_MS = 300;
			// After it lands the ribbon sprints to its own slot on the ring; the
			// sprint is eased so it visibly accelerates into place.
			const CATCH_MIN_MS = 420;
			const CATCH_MAX_MS = 4200;
			// Ground rule: every motion is eased, nothing may blink from one state
			// into another. A band that lands with only a short tail grows the rest
			// of it back over this window instead of snapping to full length.
			const GROW_MS = 380;
			// A band that leaves the answer ring eases back onto the frame edge.
			const DOCK_BACK_MS = 420;
			// A band whose slot moved (another band appeared or left) glides there.
			const SLOT_MS = 460;
			// Going idle fades the frozen shapes out instead of blanking them.
			const FADE_OUT_MS = 260;
// Time the tail takes to bend from the flight line onto the frame.
const REDRESS_MS = 460;
			// No transition may move faster than this. The ribbon on the frame
			// runs at about total/lapMs (~1 px/ms); anything well above that reads
			// as a teleport, so every off-track segment is timed from its distance
			// against this ceiling. Motion is always eased, never instantaneous.
			const TRANSIT_CAP = 1.55; // px per ms
			const TRANSIT_REL = 4.0; // release branch: hops in the air are allowed to be quick
// A band may bend its own speed a little, but the re-spacing always finishes
// inside this window. The move is a smoothstep on the *offset*, so it starts and
// ends at zero extra speed: no jerk at either end, and the peak (1.5 / T of the
// remaining gap) is the least speed that can close the gap in time.
const SETTLE_MS = 4000;
// A finished band hangs on the edge for a beat before it leaves; the pause is
// what makes the departure read as deliberate rather than as a snap.
const GHOST_LEAD_MS = 180;
			// A transition may peak at 1.5x the band's own instantaneous speed
			// where it is - never an absolute ceiling.
			// A short overlay blip (switching tasks, opening a panel) must not
			// relaunch the bands: inside this window they resume where they were.
			const RESUME_MS = 1500;
			// How long the whole overlay takes to bloom out of the send button.
			const REVEAL_MS = 720;
			// Leave the frame edge for the answer block, then circle it while the
			// answer streams; spin up and fade once it is complete.
			const ORBIT_IN_MS = 300;
			const SPIN_MS = 560;
			// How long the spin takes to slow down, stop and turn around when a
			// turn starts waiting on the user.
			const REVERSE_MS = 620;
			const HEAD_GLOW_ID = "dsh-marquee-head-glow";
			// The native caption-button strip (Windows 11 titleBarOverlay) is painted
			// above the webview, so nothing we draw there is visible. The mask cuts
			// it out with a short feathered ramp instead of letting the comet
			// disappear into a hard rectangle.
			const MASK_ID = "dsh-marquee-chrome-mask";
			const FEATHER_X_ID = "dsh-marquee-chrome-feather-x";
			const FEATHER_Y_ID = "dsh-marquee-chrome-feather-y";
			// Only the desktop shell paints native caption buttons over the webview;
			// a plain browser tab has none, so cutting that strip there would blank a
			// corner of the frame for no reason. Detect the shell instead of assuming.
			const CHROME_STRIP = (() => {
				try {
					var ua = typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "";
					if (ua.indexOf("Electron/") >= 0) return true;
					var proc = typeof window !== "undefined" ? window.process : void 0;
					var ver = proc && proc.versions ? proc.versions.electron : void 0;
					return typeof ver === "string" && ver.length > 0;
				} catch (error) {
					return false;
				}
			})();
			const CHROME_W = CHROME_STRIP ? 138 : 0;
			const CHROME_H = CHROME_STRIP ? 40 : 0;
			const CHROME_FEATHER = 18;
			// Set to true to draw a live readout of what the overlay resolved in
			// its bottom-left corner (handy when the window layout or the model
			// reporting changes).
			const DEBUG = false;
			// Scripted self-test of the answer-orbit + spin-out, only compiled into
			// DEBUG builds: circle for 2.6s, then spin out, then let go.
			const DEBUG_TEST = false;
			// While DEBUG is on, pin the head to a fixed fraction of the lap so a
			// single screenshot shows a deterministic frame. null = normal loop.
			const DEBUG_P = null;
			// Frame accounting, DEBUG only: how many animation frames the ribbon
			// loop actually produced, and the last exception it hit (a thrown
			// frame dies silently otherwise - the loop simply stops writing).
			const DIAG = { frames: 0, err: "" };

			const CSS = `
.dsh-marquee-root {
	position: fixed;
	inset: 0;
	pointer-events: none;
	z-index: 9999;
	overflow: hidden;
	will-change: opacity;
}
.dsh-marquee-svg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}
.dsh-marquee-glow {
	filter: blur(9px);
	opacity: 0.62;
}
.dsh-marquee-comet {
	animation: dsh-marquee-pulse var(--dsh-marquee-pulse) ease-in-out infinite;
}
@keyframes dsh-marquee-pulse {
	0%, 100% { opacity: calc(var(--dsh-marquee-alpha) * 0.74); }
	50% { opacity: var(--dsh-marquee-alpha); }
}
@media (prefers-reduced-motion: reduce) {
	.dsh-marquee-comet { animation: none; }
}
`;

			// ---------------------------------------------------------------------
			// Model-driven palettes
			//
			// Every palette is a tail -> head ramp inside the comet gradient
			// (offset 0 is the faded tail, 100 is the bright head), plus the solid
			// colour of the head cap and the radial glow around it.
			// `glass` selects the liquid-glass treatment: chromatic dispersion
			// strokes plus a per-frame shape warp.
			// ---------------------------------------------------------------------
			const THEMES = {
				// DeepSeek: the original comet blue, pushed to a much higher
				// contrast ramp so the gradient reads clearly on the dark shell.
				deepseek: {
					key: "deepseek",
					label: "DeepSeek",
					stops: [
						["0%", "rgba(88,138,255,0)"],
						["24%", "rgba(88,138,255,0.30)"],
						["54%", "#2f6bff"],
						["82%", "#5b8dff"],
						["100%", "#eaf2ff"],
					],
					core: "#eef4ff",
					glow: [
						["0%", "rgba(226,238,255,0.95)"],
						["45%", "rgba(88,138,255,0.48)"],
						["100%", "rgba(47,107,255,0)"],
					],
				},
				// Kimi/Moonshot brand is pure monochrome (#040000 on #FFFFFF):
				// a neutral, cold silver with a genuinely dark mid tone, so it
				// never gets confused with the two other grey-ish palettes.
				kimi: {
					key: "kimi",
					label: "Kimi",
					stops: [
						["0%", "rgba(196,202,214,0)"],
						["24%", "rgba(206,212,224,0.28)"],
						["55%", "#8f97a8"],
						["80%", "#e6eaf2"],
						["100%", "#ffffff"],
					],
					core: "#ffffff",
					glow: [
						["0%", "rgba(255,255,255,0.95)"],
						["45%", "rgba(170,178,194,0.44)"],
						["100%", "rgba(143,151,168,0)"],
					],
					// White sparks drifting inside the trail.
					particles: true,
				},
				// OpenAI: black-on-white brand, accented with the old ChatGPT
				// teal #10A37F - a sage/graphite ramp, clearly greener and
				// darker than Kimi's neutral silver.
				openai: {
					key: "openai",
					label: "OpenAI",
					stops: [
						["0%", "rgba(112,158,142,0)"],
						["24%", "rgba(128,178,160,0.26)"],
						["55%", "#6f9b8b"],
						["80%", "#cfe6dd"],
						["100%", "#f4fffa"],
					],
					core: "#f4fffa",
					glow: [
						["0%", "rgba(240,255,250,0.9)"],
						["45%", "rgba(16,163,127,0.44)"],
						["100%", "rgba(16,163,127,0)"],
					],
				},
				// Anthropic clay #D97757, saturated enough to stay warm next to
				// the blue/green palettes.
				claude: {
					key: "claude",
					label: "Claude",
					stops: [
						["0%", "rgba(217,119,87,0)"],
						["24%", "rgba(232,140,100,0.40)"],
						["55%", "#e07a4f"],
						["82%", "#b64f28"],
						["100%", "#ffeada"],
					],
					core: "#fff3e9",
					glow: [
						["0%", "rgba(255,238,226,0.95)"],
						["45%", "rgba(224,122,79,0.48)"],
						["100%", "rgba(182,79,40,0)"],
					],
				},
				// Z.ai / 智谱: the coldest palette of the set - steel blue with
				// a dark slate mid tone, so it is unmistakable beside deepseek
				// (electric blue) and Meta (azure). Labelled GLM because that is
				// the model family users actually see in the picker.
				zhipu: {
					key: "zhipu",
					label: "GLM",
					stops: [
						["0%", "rgba(120,142,182,0)"],
						["24%", "rgba(146,166,204,0.30)"],
						["55%", "#7285ab"],
						["80%", "#bcccE8"],
						["100%", "#f4f8ff"],
					],
					core: "#f6f9ff",
					glow: [
						["0%", "rgba(238,244,255,0.9)"],
						["45%", "rgba(96,120,176,0.46)"],
						["100%", "rgba(60,88,150,0)"],
					],
				},
				// Google four: #4285F4 #34A853 #FBBC05 #EA4335
				gemini: {
					key: "gemini",
					label: "Gemini",
					stops: [
						["0%", "rgba(66,133,244,0)"],
						["16%", "rgba(66,133,244,0.62)"],
						["38%", "#34a853"],
						["58%", "#fbbc05"],
						["78%", "#ea4335"],
						["100%", "#ffffff"],
					],
					core: "#ffffff",
					glow: [
						["0%", "rgba(255,255,255,0.92)"],
						["45%", "rgba(66,133,244,0.44)"],
						["100%", "rgba(234,67,53,0)"],
					],
				},
				// Qwen: a genuinely deep blue ramp (no purple), from the dark
				// cobalt body up to a pale ice head.
				qwen: {
					key: "qwen",
					label: "Qwen",
					stops: [
						["0%", "rgba(18,54,178,0)"],
						["22%", "rgba(24,66,200,0.42)"],
						["54%", "#1d3fd6"],
						["80%", "#3f6bff"],
						["100%", "#dbe6ff"],
					],
					core: "#eaf2ff",
					glow: [
						["0%", "rgba(232,240,255,0.92)"],
						["45%", "rgba(29,63,214,0.48)"],
						["100%", "rgba(29,63,214,0)"],
					],
				},
				// xAI monochrome: near-black body snapping into a white head.
				grok: {
					key: "grok",
					label: "Grok",
					stops: [
						["0%", "rgba(0,0,0,0)"],
						["20%", "rgba(18,18,20,0.58)"],
						["50%", "#141518"],
						["78%", "#c9ccd4"],
						["100%", "#ffffff"],
					],
					core: "#ffffff",
					glow: [
						["0%", "rgba(250,250,252,0.9)"],
						["45%", "rgba(110,114,124,0.42)"],
						["100%", "rgba(16,16,20,0)"],
					],
				},
				// MiniMax pink #EA5EC1 with its #FF3763 accent.
				minimax: {
					key: "minimax",
					label: "MiniMax",
					stops: [
						["0%", "rgba(234,94,193,0)"],
						["24%", "rgba(255,112,192,0.40)"],
						["54%", "#ff5fc0"],
						["80%", "#ff2d63"],
						["100%", "#ffdcec"],
					],
					core: "#fff0f6",
					glow: [
						["0%", "rgba(255,234,244,0.95)"],
						["45%", "rgba(255,95,192,0.48)"],
						["100%", "rgba(255,45,99,0)"],
					],
				},
				// Meta blue #0866FF: azure, brighter and more cyan than DeepSeek.
				meta: {
					key: "meta",
					label: "Meta",
					stops: [
						["0%", "rgba(8,102,255,0)"],
						["22%", "rgba(52,140,255,0.34)"],
						["52%", "#2f7bff"],
						["78%", "#0866ff"],
						["100%", "#e2eeff"],
					],
					core: "#eef5ff",
					glow: [
						["0%", "rgba(236,245,255,0.92)"],
						["45%", "rgba(47,123,255,0.46)"],
						["100%", "rgba(8,102,255,0)"],
					],
				},
				// NVIDIA: the signature optical green (#76B900) into a warm
				// white head.
				nvidia: {
					key: "nvidia",
					label: "NVIDIA",
					stops: [
						["0%", "rgba(118,185,0,0)"],
						["22%", "rgba(140,205,20,0.40)"],
						["54%", "#76b900"],
						["80%", "#a4e01f"],
						["100%", "#f4ffd9"],
					],
					core: "#f8ffe6",
					glow: [
						["0%", "rgba(242,255,214,0.92)"],
						["45%", "rgba(118,185,0,0.48)"],
						["100%", "rgba(94,148,0,0)"],
					],
				},
				// Fallback: liquid glass. Almost transparent, with a bright
				// refracted rim, chromatic dispersion and a shape that keeps
				// deforming while it runs.
				unknown: {
					key: "unknown",
					label: "Prism",
					// Almost clear with a hard specular edge: the body reads as
					// glass because the gradient stays near zero for most of its
					// length and only blooms just behind the head.
					stops: [
						["0%", "rgba(255,255,255,0)"],
						["42%", "rgba(226,240,255,0.05)"],
						["68%", "rgba(240,248,255,0.14)"],
						["88%", "rgba(255,255,255,0.52)"],
						["100%", "rgba(255,255,255,0.92)"],
					],
					core: "rgba(255,255,255,0.95)",
					glow: [
						["0%", "rgba(255,255,255,0.60)"],
						["40%", "rgba(214,236,255,0.26)"],
						["100%", "rgba(198,224,255,0)"],
					],
					glass: true,
				},
			};

			const DISPERSION_COLORS = ["#ff2f6d", "#ffb020", "#35ffb2", "#35d0ff", "#a86bff"];
			const RIM_OPACITY = 0.6;

			// Ordered by specificity: a model name is matched before anything
			// generic. The provider id is only consulted when the model text says
			// nothing at all - the palette must follow the model, not the API.
			const MODEL_KEYWORDS = [
				["deepseek", ["deepseek", "deep-seek", "deepseek-", "deepseek_v", "\u6df1\u5ea6\u6c42\u7d22", "v4.1-flash", "v4-flash", "v3.2", "r1-", "coder-v"]],
				["kimi", ["kimi", "moonshot", "moonshotai", "\u6708\u4e4b\u6697\u9762", "k2-", "k2.5", "kimi-k", "k-series"]],
				["claude", ["claude", "anthropic", "sonnet", "opus", "haiku"]],
				["gemini", ["gemini", "bard", "gemma", "palm-2"]],
				["qwen", ["qwen", "qianwen", "qwq", "\u5343\u95ee", "\u901a\u4e49", "tongyi", "dashscope", "qwen-max", "qwen-plus", "qwen-turbo"]],
				["grok", ["grok", "x-ai", "xai", "x.ai"]],
				["zhipu", ["glm-", "glm4", "glm5", "chatglm", "zhipu", "\u667a\u8c31", "bigmodel", "z.ai"]],
				["minimax", ["minimax", "abab", "\u6d77\u87ba", "hailuo", "mini-max"]],
				["meta", ["llama", "meta-llama", "codellama"]],
				["nvidia", ["nvidia", "nemotron", "cuda", "tegra", "nv-", "\u82f1\u4f1f\u8fbe"]],
				["openai", ["openai", "gpt-", "gpt4", "gpt5", "chatgpt", "codex", "davinci", "o1-", "o1pro", "o3-", "o3mini", "o4-", "o4mini"]],
			];

			function themeKeyForText(text) {
				const s = String(text || "").toLowerCase();
				if (!s) return null;
				for (let i = 0; i < MODEL_KEYWORDS.length; i++) {
					const words = MODEL_KEYWORDS[i][1];
					for (let j = 0; j < words.length; j++) {
						if (s.indexOf(words[j]) !== -1) return MODEL_KEYWORDS[i][0];
					}
				}
				return null;
			}

			/**
			 * Resolve the palette for the model that is currently being called.
			 * Model id / name win; the provider id is a last resort only, so two
			 * providers relaying the same model still paint the same ribbon.
			 */
			/** Resolve a stored palette key. "prism" is the liquid-glass palette. */
			function themeByKey(key) {
				const k = String(key == null ? "" : key).trim().toLowerCase();
				if (!k) return null;
				if (k === "prism" || k === "glass" || k === "unknown") return THEMES.unknown;
				return THEMES[k] || null;
			}

			function themeForModel(info, fallbackKey) {
				const fallback = themeByKey(fallbackKey) || THEMES.unknown;
				if (!info) return fallback;
				const key =
					themeKeyForText(info.modelId) ||
					themeKeyForText(info.modelName) ||
					themeKeyForText(info.domText) ||
					themeKeyForText(info.providerId);
				return THEMES[key] || fallback;
			}

			// Palette order and display names for the settings dropdowns.
			const THEME_ORDER = ["deepseek", "kimi", "openai", "claude", "zhipu", "gemini", "qwen", "grok", "minimax", "meta", "nvidia", "prism"];

			/**
			 * Which model a conversation is actually calling.
			 *
			 * The sessions store owns a `modelSelection` projection per session
			 * (`{next, lastUsed}` holding `{provider, model, reasoningEffort}`), so
			 * the model name is available without reading any DOM - and it is a
			 * model id, not the relay / API provider that happens to serve it
			 * ("openrouter", "siliconflow", ...).
			 *
			 * Flattened to one string on purpose: a store selector must stay
			 * referentially stable, and a fresh array would re-render on every
			 * store tick, or loop outright under `useSyncExternalStore`.
			 */
			const LIVE_SEP = "\u0001";
			function selectLiveModels(state) {
				let out = "";
				try {
					const byId = state && state.byId;
					if (!byId) return "";
					const proj = (state && state.projectionsBySession) || {};
					const ids = Object.keys(byId).sort();
					for (let i = 0; i < ids.length; i++) {
						const id = ids[i];
						const s = byId[id];
						if (!s) continue;
						const vals = (proj[id] && proj[id].values) || null;
						const sel = vals && vals.modelSelection ? (vals.modelSelection.next || vals.modelSelection.lastUsed) : null;
						const running = s.running === true;
						if (!running && !sel) continue;
						const current = ((s.retainedBy && s.retainedBy.mainView) || 0) > 0;
						out += (out ? LIVE_SEP : "") + id + LIVE_SEP +
							(running ? "1" : "0") + LIVE_SEP +
							(current ? "1" : "0") + LIVE_SEP +
							String((sel && sel.model) || "") + LIVE_SEP +
							String((sel && sel.provider) || "") + LIVE_SEP +
							String((vals && vals.title) || "").replace(/[\r\n\t\u0001]/g, " ");
					}
				} catch (e) {
					out = "";
				}
				return out;
			}

			function parseLiveModels(raw) {
				const rows = [];
				if (!raw) return rows;
				const parts = String(raw).split(LIVE_SEP);
				for (let i = 0; i + 5 < parts.length; i += 6) {
					rows.push({
						id: parts[i],
						running: parts[i + 1] === "1",
						current: parts[i + 2] === "1",
						modelId: parts[i + 3],
						providerId: parts[i + 4],
						title: parts[i + 5],
					});
				}
				return rows;
			}

			// Tiny observable shared between the invisible model-seat occupant and
			// the overlay that paints with it.
			const modelState = { info: { providerId: "", modelId: "", modelName: "", domText: "" } };
			const modelListeners = new Set();

			// A scan is a *complete* snapshot: fields the scan could not fill are
			// cleared so a stale model name can never outvote a fresh model id.
			function publishModel(snapshot) {
				if (!snapshot) return;
				const prev = modelState.info;
				const next = {
					providerId: String(snapshot.providerId || ""),
					modelId: String(snapshot.modelId || ""),
					modelName: String(snapshot.modelName || ""),
					domText: String(snapshot.domText || ""),
				};
				if (next.providerId === prev.providerId && next.modelId === prev.modelId &&
					next.modelName === prev.modelName && next.domText === prev.domText) return;
				modelState.info = next;
				modelListeners.forEach((fn) => {
					try { fn(next); } catch (e) { /* noop */ }
				});
			}
			function useModelInfo() {
				const [info, setInfo] = useState(modelState.info);
				useEffect(() => {
					const fn = (next) => setInfo(next);
					modelListeners.add(fn);
					setInfo(modelState.info);
					return () => { modelListeners.delete(fn); };
				}, []);
				return info;
			}

			function countActive(snapshot) {
				let n = 0;
				if (snapshot && typeof snapshot.forEach === "function") {
					snapshot.forEach((status) => {
						if (status && (status.running === true || status.pendingInteraction !== void 0)) n += 1;
					});
				}
				return Math.min(MAX_COMETS, n);
			}

			// The same status store as a stable string of ids that are either
			// working or waiting on the user. Stable because it is a string: a
			// fresh array from a selector would re-render the overlay on every
			// store tick and, under useSyncExternalStore, could loop.
			function selectRunningStatus(snapshot) {
				const ids = [];
				try {
					if (snapshot && typeof snapshot.forEach === "function") {
						snapshot.forEach((status, key) => {
							if (!status) return;
							if (status.running === true || status.pendingInteraction !== void 0) ids.push(String(key));
						});
					}
				} catch (e) { /* noop */ }
				ids.sort();
				return ids.join("|");
			}

			function countSessions(list) {
				if (!list) return 0;
				const arr = Array.isArray(list) ? list : (list.sessions || list.items || []);
				if (!Array.isArray(arr)) return 0;
				let n = 0;
				for (let i = 0; i < arr.length; i++) {
					const s = arr[i];
					if (!s) continue;
					if (s.running === true) { n += 1; continue; }
					if (s.status && (s.status.running === true || s.status.pendingInteraction !== void 0)) { n += 1; continue; }
					if (Array.isArray(s.pendingSubmissions) && s.pendingSubmissions.length > 0) n += 1;
				}
				return Math.min(MAX_COMETS, n);
			}

			/** A turn that stopped to ask the user something mid-flight. */
			function replyCountActive(snapshot) {
				let n = 0;
				if (snapshot && typeof snapshot.forEach === "function") {
					snapshot.forEach((status) => {
						if (status && status.pendingInteraction) n += 1;
					});
				}
				return n;
			}

			function replyCountSessions(list) {
				if (!list) return 0;
				const arr = Array.isArray(list) ? list : (list.sessions || list.items || []);
				if (!Array.isArray(arr)) return 0;
				let n = 0;
				for (let i = 0; i < arr.length; i++) {
					const s = arr[i];
					if (!s) continue;
					if (s.pendingInteraction) { n += 1; continue; }
					if (s.status && s.status.pendingInteraction) n += 1;
				}
				return n;
			}

			function clampNumber(value, min, max, fallback) {
				const n = Number(value);
				if (!Number.isFinite(n)) return fallback;
				return Math.max(min, Math.min(max, n));
			}

			function fieldNumber(name) {
				return function (value) {
					const field = value && value[name];
					if (!field) return null;
					const raw = field.value !== void 0 ? field.value : field.text;
					const n = Number(raw);
					return Number.isFinite(n) ? n : null;
				};
			}

			function fieldBoolean(name) {
				return function (value) {
					const field = value && value[name];
					if (!field) return null;
					const raw = field.text !== void 0 ? field.text : field.value;
					if (raw === true || raw === "true" || raw === "1" || raw === "on") return true;
					if (raw === false || raw === "false" || raw === "0" || raw === "off") return false;
					return null;
				};
			}

			/**
			 * A boolean setting expressed as a text field, so it rides the same
			 * staged config form (and the same Save button) as the numeric rows.
			 */
			function settingsBooleanField(name) {
				return {
					field: name,
					format(value) {
						return value === true ? "true" : value === false ? "false" : "";
					},
					parse(text) {
						const s = String(text == null ? "" : text).trim().toLowerCase();
						if (s === "") return { kind: "clear" };
						if (s === "true" || s === "1" || s === "on") return { kind: "set", value: true };
						if (s === "false" || s === "0" || s === "off") return { kind: "set", value: false };
						return void 0;
					},
				};
			}

			const selectTrail = fieldNumber("trailLength");
			const selectThickness = fieldNumber("thickness");
			const selectSpeed = fieldNumber("speed");
			const selectSweep = fieldNumber("sweep");
			const selectEdgeGlow = fieldBoolean("edgeGlow");
			const selectModelColor = fieldBoolean("modelColor");
			function fieldText(name) {
				return function (value) {
					const field = value && value[name];
					if (!field) return null;
					const raw = field.text !== void 0 ? field.text : field.value;
					return raw == null ? null : String(raw);
				};
			}

			/** A plain text setting (used for the palette keys). */
			function settingsText(name) {
				if (settingsTextField) return settingsTextField(name);
				return {
					field: name,
					format(value) { return value == null ? "" : String(value); },
					parse(text) {
						const t = String(text == null ? "" : text).trim();
						if (t === "") return { kind: "clear" };
						return { kind: "set", value: t };
					},
				};
			}

			/** A boolean setting expressed as text, so it rides the staged form. */
			const selectTheme = fieldText("theme");
			const selectUnknownTheme = fieldText("unknownTheme");

			// Hashed class names from the settings primitives' CSS modules, reused
			// so the boolean rows look exactly like the native value fields.
			const CLS = {
				field: "_field_bjqpo_3",
				head: "_head_bjqpo_14",
				label: "_label_bjqpo_20",
				labelGroup: "_labelGroup_bjqpo_29",
				badges: "_badges_bjqpo_82",
				reset: "_reset_bjqpo_88",
				hint: "_hint_bjqpo_140",
				input: "_input_bjqpo_107",
				invalid: "_invalid_bjqpo_133",
			};

			/**
			 * Sampling of the rounded-rectangle border into a closed polyline.
			 *
			 * `getPointAtLength()` is deliberately NOT used: on a closed path the
			 * tangent near the closing point is browser-defined and came out
			 * wrong, which produced the "comet teleports from the top-right
			 * corner to the bottom-left" jump. Sampling ourselves gives an exact,
			 * continuous position + heading everywhere, including across the
			 * seam.
			 *
			 * `startX` picks the point on the bottom edge where the lap starts,
			 * so the first frame of the reveal emerges from the composer side.
			 */
			function buildTrack(w, hgt, half, startX) {
				const t = Math.max(1, half);
				const r = t;
				// The centreline runs `t` inside the frame, so a band of half-width
				// `t` exactly touches the window edge.
				const left = t;
				const right = Math.max(left + 1, w - t);
				const top = t;
				const bottom = Math.max(top + 1, hgt - t);
				// Arc centres sit one radius further in, which is what keeps the
				// straight runs and the quarter turns joined without a kink.
				const cLeft = left + r;
				const cRight = Math.max(cLeft + 0.5, right - r);
				const cTop = top + r;
				const cBottom = Math.max(cTop + 0.5, bottom - r);
				const sx = Math.max(cLeft, Math.min(cRight, Number.isFinite(startX) ? startX : cRight - 1));

				const pts = [];
				function push(x, y) { pts.push(x, y); }
				function seg(x0, y0, x1, y1, n) {
					for (let i = 1; i <= n; i++) {
						const u = i / n;
						push(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
					}
				}
				function arc(cx, cy, a0, a1, n) {
					for (let i = 1; i <= n; i++) {
						const a = a0 + (a1 - a0) * (i / n);
						push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
					}
				}

				// Start on the bottom edge, run clockwise: bottom -> right -> top ->
				// left -> back to the start point.
				push(sx, bottom);
				seg(sx, bottom, cRight, bottom, 24);
				arc(cRight, cBottom, Math.PI / 2, 0, 12);
				seg(right, cBottom, right, cTop, 24);
				arc(cRight, cTop, 0, -Math.PI / 2, 12);
				seg(cRight, top, cLeft, top, 24);
				arc(cLeft, cTop, -Math.PI / 2, -Math.PI, 12);
				seg(left, cTop, left, cBottom, 24);
				arc(cLeft, cBottom, Math.PI, Math.PI / 2, 12);
				seg(cLeft, bottom, sx, bottom, 24);

				const n = pts.length / 2;
				const cum = new Float64Array(n + 1);
				let total = 0;
				for (let i = 0; i < n; i++) {
					const x0 = pts[i * 2];
					const y0 = pts[i * 2 + 1];
					const x1 = pts[((i + 1) % n) * 2];
					const y1 = pts[((i + 1) % n) * 2 + 1];
					cum[i] = total;
					total += Math.hypot(x1 - x0, y1 - y0);
				}
				cum[n] = total;

				function at(s) {
					if (!(total > 0)) return { x: 0, y: 0, angle: 0 };
					let d = s % total;
					if (d < 0) d += total;
					let lo = 0;
					let hi = n;
					while (lo + 1 < hi) {
						const mid = (lo + hi) >> 1;
						if (cum[mid] <= d) lo = mid; else hi = mid;
					}
					const i = lo % n;
					const j = (i + 1) % n;
					const span = cum[i + 1] - cum[i] || 1;
					const u = Math.max(0, Math.min(1, (d - cum[i]) / span));
					const x0 = pts[i * 2];
					const y0 = pts[i * 2 + 1];
					const x1 = pts[j * 2];
					const y1 = pts[j * 2 + 1];
					const x = x0 + (x1 - x0) * u;
					const y = y0 + (y1 - y0) * u;
					return { x: x, y: y, angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI };
				}

				return { total: total, offset: cum[0] + 0, at: at };
			}

			// Inverse of sweep(): given a warped phase, return the raw phase that
			// produces it. sweep is monotonic on [0,1), so a plain bisection is
			// enough and stays exact to ~1e-6.
			function sweepInv(v) {
				let target = ((v % 1) + 1) % 1;
				let lo = 0;
				let hi = 1;
				for (let k = 0; k < 40; k++) {
					const mid = (lo + hi) / 2;
					if (((sweep(mid) % 1) + 1) % 1 < target) lo = mid; else hi = mid;
				}
				return (lo + hi) / 2;
			}
			function sweep(p) {
				return p - (SWEEP_AMP / (Math.PI * 2)) * Math.sin(Math.PI * 2 * p);
			}

			// sweep() is the pacing curve: the band is genuinely slower at the
			// start/end of a lap and faster through the middle. speedOf gives its
			// instantaneous speed, which every off-track move is budgeted against.
			function sweepSpeed(p) {
				return 1 - SWEEP_AMP * Math.cos(Math.PI * 2 * (((p % 1) + 1) % 1));
			}

			function ringSpeedAt(p, total, lapMs) {
				return (total / Math.max(1, lapMs)) * sweepSpeed(p);
			}

			// What an off-track move is allowed to peak at: 1.5x the speed the
			// band would have right there, never less than 1.5x the ring average,
			// so a slow stretch of the pacing curve cannot starve a transition.
			function transitCap(p, total, lapMs) {
				const avg = total / Math.max(1, lapMs);
				return Math.max(0.15, TRANSIT_REL * Math.max(avg, ringSpeedAt(p, total, lapMs)));
			}

			function taper(u) {
				const k = Math.max(0, Math.min(1, u));
				return Math.pow(1 - k, 0.62);
			}

			/**
			 * The ribbon is sampled along the track instead of being a rigid shape
			 * rotated at the head: a rigid capsule snaps 90 degrees within two
			 * frames on the 3px-radius corners, which read as a visible twitch.
			 *
			 * `wobble` (optional) bends the ribbon around the track so the liquid
			 * glass palette keeps deforming: perpendicular offset plus a breathing
			 * width.
			 */
			// --- output orbit -------------------------------------------------------
			// The current conversation's band leaves the frame edge when the answer
			// starts streaming, circles the answer block, then spins up and fades
			// out when the answer is complete. Manual stop blanks the band instead
			// (the exit ghost takes over and returns it to the composer).
			// The orbit hugs the answer block: a superellipse (squircle) instead of
			// an ellipse, so the band turns with rounded-rectangle corners rather
			// than sweeping a circle. Everything below is arc-length parameterised,
			// so the head keeps a constant pixel speed no matter the shape.
			const RING_SHAPE = 4.6;
			const RING_SAMPLES = 900;
			const RING_TABLES = new Map();

			function ringShapeOf(ring) {
				return ring && ring.n ? ring.n : RING_SHAPE;
			}

			function ringRaw(ring, ang) {
				// |x/rx|^n + |y/ry|^n = 1, solved radially. n > 2 turns the
				// ellipse into a rounded rectangle: flat-ish sides, soft corners.
				const n = ringShapeOf(ring);
				const c = Math.cos(ang);
				const s = Math.sin(ang);
				const ac = Math.abs(c);
				const as = Math.abs(s);
				const den =
					Math.pow(Math.pow(ac, n) + Math.pow(as, n), 1 / n) || 1;
				return { x: ring.cx + (ring.rx * c) / den, y: ring.cy + (ring.ry * s) / den };
			}

			function ringPoint(ring, ang) {
				return ringRaw(ring, ang);
			}

			// Arc-length table: point samples plus cumulative length. Built once
			// per ring geometry, then every angle <-> arc conversion is O(log n).
			function ringTable(ring) {
				const key = [ring.cx, ring.cy, ring.rx, ring.ry, ringShapeOf(ring)].map(function (v) { return Math.round(v * 10) / 10; }).join("|");
				let cached = RING_TABLES.get(key);
				if (cached) return cached;
				const N = RING_SAMPLES;
				const cum = new Float64Array(N + 1);
				const pts = new Array(N + 1);
				let acc = 0;
				let prev = null;
				for (let i = 0; i <= N; i++) {
					const p = ringRaw(ring, (i / N) * Math.PI * 2);
					if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y);
					pts[i] = p;
					cum[i] = acc;
					prev = p;
				}
				cached = { N: N, cum: cum, pts: pts, total: acc };
				if (RING_TABLES.size > 8) RING_TABLES.clear();
				RING_TABLES.set(key, cached);
				return cached;
			}

			function cumAt(tb, i) {
				const j = Math.max(0, Math.min(tb.N - 1, Math.floor(i)));
				const f = i - j;
				return tb.cum[j] + (tb.cum[j + 1] - tb.cum[j]) * f;
			}

			function arcAtAngle(tb, ang) {
				let f = ang / (Math.PI * 2);
				f = f - Math.floor(f);
				return cumAt(tb, f * tb.N);
			}

			function angleFromArc(tb, s) {
				const total = tb.total || 1;
				let v = s - Math.floor(s / total) * total;
				if (v < 0) v += total;
				let lo = 0;
				let hi = tb.N;
				while (hi - lo > 1) {
					const mid = (lo + hi) >> 1;
					if (tb.cum[mid] <= v) lo = mid;
					else hi = mid;
				}
				const span = tb.cum[hi] - tb.cum[lo] || 1;
				const f = (v - tb.cum[lo]) / span;
				return ((lo + f) / tb.N) * Math.PI * 2;
			}

			// Signed angular span worth `arc` pixels, walking from `ang`.
			function arcSpan(ring, ang, sign, arc) {
				const tb = ringTable(ring);
				const a1 = angleFromArc(tb, arcAtAngle(tb, ang) + sign * Math.max(0, arc));
				let span = a1 - ang;
				if (sign > 0 && span < 0) span += Math.PI * 2;
				if (sign < 0 && span > 0) span -= Math.PI * 2;
				return span;
			}

			// |dP/dang| at `ang`: converts a pixel speed into an angle step.
			function ringRate(ring, ang) {
				const e = 0.004;
				const a = ringRaw(ring, ang - e);
				const b = ringRaw(ring, ang + e);
				return Math.hypot(b.x - a.x, b.y - a.y) / (2 * e) || 1;
			}

			// Ring angle nearest to a point (used to enter the ring, and by the
			// exit ghost to pick where its lap starts).
			function nearestAngle(ring, from) {
				const tb = ringTable(ring);
				let bi = 0;
				let bd = Infinity;
				for (let i = 0; i < tb.N; i++) {
					const dx = tb.pts[i].x - from.x;
					const dy = tb.pts[i].y - from.y;
					const d = dx * dx + dy * dy;
					if (d < bd) { bd = d; bi = i; }
				}
				return (bi / tb.N) * Math.PI * 2;
			}

			function stepOrbit(ob, ring, manualStop, now, edgeHead, dirSign, speedPx, dockPt) {
				const capMs = Math.max(0.15, speedPx * TRANSIT_REL);
				if (!ob.mode) ob.mode = "off";
				const sameRing = function (a, b) {
					return !!a && !!b && Math.abs(a.cx - b.cx) < 2 && Math.abs(a.cy - b.cy) < 2 &&
						Math.abs(a.rx - b.rx) < 2 && Math.abs(a.ry - b.ry) < 2;
				};
				if (ring) {
					if (ob.mode === "off") {
						ob.mode = "fly";
						ob.since = now;
						ob.from = { x: edgeHead.x, y: edgeHead.y };
						ob.ring = ring;
						ob.ringAt = now;
						ob.fade = 1;
						ob.ang = nearestAngle(ring, edgeHead);
						const tgt = ringPoint(ring, ob.ang);
						// easeOutCubic peak again: stretch the flight by its own distance
						ob.flyDur = Math.max(ORBIT_IN_MS, Math.min(1100, Math.hypot(tgt.x - ob.from.x, tgt.y - ob.from.y) * 3 / capMs));
					} else if (ob.ring) {
						// The answer box grows while it streams, so the ring changes size
						// on almost every poll. Follow it with a short, smooth catch-up
						// instead of dissolving and re-launching: retargeting on drift was
						// what made the band flicker on and off the frame during output.
						// A real ownership change arrives here as `ring === null`, which
						// is the branch below.
						const dtR = Math.max(1, Math.min(80, now - (ob.ringAt || now)));
						ob.ringAt = now;
						if (!sameRing(ob.ring, ring)) {
							const k = 1 - Math.pow(0.5, dtR / 220);
							ob.ring = {
								cx: ob.ring.cx + (ring.cx - ob.ring.cx) * k,
								cy: ob.ring.cy + (ring.cy - ob.ring.cy) * k,
								rx: ob.ring.rx + (ring.rx - ob.ring.rx) * k,
								ry: ob.ring.ry + (ring.ry - ob.ring.ry) * k
							};
						}
					} else {
						ob.ring = ring;
						ob.ringAt = now;
					}
				} else if (ob.mode === "fly" || ob.mode === "orbit") {
					ob.mode = manualStop ? "off" : "spin";
					ob.since = now;
				}
				if (ob.mode === "off") return null;
				const r = ob.ring;
				if (!r) { ob.mode = "off"; return null; }
				if (ob.mode === "fly") {
					const raw = (now - ob.since) / (ob.flyDur || ORBIT_IN_MS);
					const t = Math.min(1, raw);
					const e = easeOutCubic(t);
					const target = ringPoint(r, ob.ang);
					const x = ob.from.x + (target.x - ob.from.x) * e;
					const y = ob.from.y + (target.y - ob.from.y) * e;
					if (raw >= 1) ob.mode = "orbit";
					return { mode: "fly", x: x, y: y, ang: ob.ang, ring: r, fade: 1, from: ob.from, dirSign: dirSign };
				}
				if (ob.mode === "orbit") {
					ob.ang += ((speedPx * 1.15) / ringRate(r, ob.ang)) * dirSign;
					const p = ringPoint(r, ob.ang);
					return { mode: "orbit", x: p.x, y: p.y, ang: ob.ang, ring: r, fade: 1, dirSign: dirSign };
				}
				// Dock: a band that finished circling must glide back onto the
				// frame edge before it continues - never teleport from the ring.
				if (ob.mode === "dock") {
					const to = dockPt || ob.from;
					if (!ob.dockDur) {
						const dd = Math.hypot(to.x - ob.from.x, to.y - ob.from.y);
						ob.dockDur = Math.max(DOCK_BACK_MS, Math.min(1600, Math.max(dd, dd * 1.5 / capMs)));
					}
					const du = Math.max(0, Math.min(1, (now - ob.since) / ob.dockDur));
					const de = easeInOutCubic(du);
					const dx = ob.from.x + (to.x - ob.from.x) * de;
					const dy = ob.from.y + (to.y - ob.from.y) * de;
					if (du >= 1) ob.mode = "off";
					return { mode: "dock", x: dx, y: dy, ang: ob.ang, ring: r, fade: 1, from: ob.from, dirSign: dirSign };
				}
				// spin: whip up hard, then dissolve fast
				const u = Math.max(0, (now - ob.since) / SPIN_MS);
				const mul = Math.min(1 + 4.2 * Math.min(1, u / 0.34), 2.2);
				ob.ang += ((speedPx * mul) / ringRate(r, ob.ang)) * dirSign;
				const fade = u < 0.26 ? 1 : Math.max(0, 1 - (u - 0.26) / 0.74);
				const p = ringPoint(r, ob.ang);
				if (u >= 1) { ob.mode = "dock"; ob.since = now; ob.from = { x: p.x, y: p.y }; ob.fade = 1; }
				return { mode: "spin", x: p.x, y: p.y, ang: ob.ang, ring: r, fade: fade, dirSign: dirSign };
			}

			// Wrap an arc-length position into the closed track. The tail of a band
			// that runs the other way crosses the seam, so it has to wrap instead
			// of clamping to the start of the lap.
			function wrapArc(track, s) {
				const tot = track.total;
				if (!(tot > 0)) return s;
				let v = (s - track.offset) % tot;
				if (v < 0) v += tot;
				return track.offset + v;
			}

			/** Sampled centre line of a ribbon, head first. */
			function ribbonPoints(track, headS, trail, steps, dir) {
				const n = Math.max(6, steps | 0);
				let dw = dir == null ? 1 : dir;
				if (!isFinite(dw) || Math.abs(dw) < 0.02) dw = dw < 0 ? -0.02 : 0.02;
				const out = [];
				for (let i = 0; i <= n; i++) {
					out.push(track.at(wrapArc(track, headS - dw * (i / n) * trail)));
				}
				return out;
			}

			function ribbonPath(track, headS, trail, half, steps, wobble, dir) {
				const n = Math.max(6, steps | 0);
				// The taper has to trail behind the motion: a band that runs the
				// other way samples towards +s, or its tail points where it is
				// heading and the head reads as walking backwards.
				let dw = dir == null ? 1 : dir;
				if (!isFinite(dw) || Math.abs(dw) < 0.02) dw = dw < 0 ? -0.02 : 0.02;
				const left = [];
				const right = [];
				for (let i = 0; i <= n; i++) {
					const u = i / n;
					const pt = track.at(wrapArc(track, headS - dw * u * trail));
					const a = (pt.angle * Math.PI) / 180;
					// Unit normal of the heading (cos a, sin a) is (-sin a, cos a).
					const nx = -Math.sin(a);
					const ny = Math.cos(a);
					let w = Math.max(0.12, half * taper(u));
					let off = 0;
					if (wobble) {
						off = wobble.amp * Math.sin(u * wobble.freq * Math.PI * 2 + wobble.phase);
						w = Math.max(0.12, w * (1 + 0.4 * Math.sin(u * wobble.freq * 1.7 * Math.PI * 2 + wobble.phase * 0.7)));
					}
					const ww = w + off;
					left.push((pt.x + nx * ww).toFixed(1) + " " + (pt.y + ny * ww).toFixed(1));
					right.push((pt.x - nx * ww).toFixed(1) + " " + (pt.y - ny * ww).toFixed(1));
				}
				return "M" + left.join(" L") + " L" + right.reverse().join(" L") + " Z";
			}

			function easeOutCubic(u) {
				const k = Math.max(0, Math.min(1, u));
				return 1 - Math.pow(1 - k, 3);
			}

			// Slight overshoot at the end, so a freshly spawned ribbon arrives with
			// a non-linear flourish instead of easing into place linearly.
			function easeOutBack(u) {
				const c1 = 1.70158;
				const c3 = c1 + 1;
				const k = Math.max(0, Math.min(1, u));
				return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
			}

			// Symmetric ease, used for the throw from the composer: it leaves the
			// button unhurried, is fastest mid-flight and settles on the edge.
			function easeInOutCubic(u) {
				const k = Math.max(0, Math.min(1, u));
				return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
			}

			// Geometry of one leg+fillet attempt: a straight leg from p0 that ends
			// at A, then an arc of radius t / tan(phi/2) that leaves A and rolls
			// into the edge along `dir` at the target.
			function flightSolve(p0, target, dirX, dirY, t) {
				const vx = target.x - dirX * t - p0.x;
				const vy = target.y - dirY * t - p0.y;
				const vlen = Math.sqrt(vx * vx + vy * vy);
				if (!(vlen > 0.5) || !Number.isFinite(vlen)) return null;
				const ux = vx / vlen;
				const uy = vy / vlen;
				const ax = target.x - dirX * t - ux * t;
				const ay = target.y - dirY * t - uy * t;
				const legLen = Math.sqrt((ax - p0.x) * (ax - p0.x) + (ay - p0.y) * (ay - p0.y));
				const dot = Math.max(-1, Math.min(1, ux * dirX + uy * dirY));
				return { t: t, ux: ux, uy: uy, ax: ax, ay: ay, legLen: legLen, phi: Math.acos(dot) };
			}

			// Straight leg to the slot, then a circular fillet that rounds the last
			// few pixels into the edge tangent, so the merge reads as a turn and
			// not a kink. The corner radius is what gets requested; the tangent
			// length is solved for it, which keeps the rounded part the same size
			// no matter how steeply the ribbon arrives (a fixed tangent length
			// collapsed into a hairpin when the approach was nearly head-on).
			function flightPath(p0, target, dirX, dirY, radius) {
				const dx = target.x - p0.x;
				const dy = target.y - p0.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (!(dist > 2) || !Number.isFinite(dist)) return null;
				const want = Math.max(6, radius);
				let g = flightSolve(p0, target, dirX, dirY, Math.max(8, Math.min(want * 1.2, dist * 0.5)));
				if (!g) return null;
				// t -> radius is monotone here, so a few fixed-point steps settle it.
				for (let it = 0; it < 5; it++) {
					const half = Math.min(1.42, g.phi / 2);
					const t = Math.max(8, Math.min(dist * 0.62, want * Math.tan(half)));
					if (Math.abs(t - g.t) < 0.4) break;
					const next = flightSolve(p0, target, dirX, dirY, t);
					if (!next) break;
					g = next;
				}
				const phi = g.phi;
				if (phi < 0.02) {
					// Head-on: nothing to round, fly the leg straight in.
					const len = Math.max(g.legLen, 1);
					return {
						total: len,
						radius: 0,
						at: function (s) {
							const q = Math.max(0, Math.min(len, s));
							const k = q / len;
							return { x: p0.x + (g.ax - p0.x) * k, y: p0.y + (g.ay - p0.y) * k };
						},
					};
				}
				const R = Math.max(2, g.t / Math.tan(phi / 2));
				const arcLen = R * phi;
				const total = g.legLen + arcLen;
				function build(sgn) {
					const nx = -g.uy * sgn;
					const ny = g.ux * sgn;
					const ox = g.ax + nx * R;
					const oy = g.ay + ny * R;
					const v0x = g.ax - ox;
					const v0y = g.ay - oy;
					return function at(s) {
						const q = Math.max(0, Math.min(total, s));
						if (q <= g.legLen) {
							const k = g.legLen > 0 ? q / g.legLen : 1;
							return { x: p0.x + (g.ax - p0.x) * k, y: p0.y + (g.ay - p0.y) * k };
						}
						const ang = (sgn * (q - g.legLen)) / R;
						const cs = Math.cos(ang);
						const sn = Math.sin(ang);
						return { x: ox + v0x * cs - v0y * sn, y: oy + v0x * sn + v0y * cs };
					};
				}
				// Pick the turning side that actually lands on the target; this is
				// cheaper and safer than reasoning about screen-space direction.
				let best = null;
				let bestErr = Infinity;
				for (let k = 0; k < 2; k++) {
					const sgn = k === 0 ? 1 : -1;
					const at = build(sgn);
					const end = at(total);
					const err = Math.sqrt((end.x - target.x) * (end.x - target.x) + (end.y - target.y) * (end.y - target.y));
					if (err < bestErr) {
						bestErr = err;
						best = at;
					}
				}
				return { total: total, radius: R, at: best };
			}
			// Tapered ribbon through an arbitrary polyline (free space, no track).
			// A throw out of the send button that turns into the frame edge: the head
			// flies on a straight line with its tail behind it, and as it touches down
			// the tail swings onto the edge - the far end of the tail leads, the part
			// right behind the head stays straight, so the ribbon visibly takes the
			// bend into the frame instead of the whole body jumping onto it at once.
			// The throw is a plain straight line: the head flies from the send button
			// to the point on the frame it will own, and the tail trails behind it.
			// The L shape is not drawn here - it cannot be, because the tail is
			// always behind the head and the edge is still ahead. Instead the tail
			// is re-dressed onto the frame right after touch-down (see redressTail),
			// which bends it round the corner in one continuous move.
			function throwPath(org, grab, ft, lenNow, track, slot, lapMs, dirTarget, steps) {
				const n = Math.max(6, steps | 0);
				const f = Math.max(0, Math.min(1, ft));
				const e = easeOutCubic(f);
				const lx = grab.x - org.x;
				const ly = grab.y - org.y;
				const ll = Math.sqrt(lx * lx + ly * ly) || 1;
				const ux = lx / ll;
				const uy = ly / ll;
				const travelled = ll * e;
				const head = { x: org.x + lx * e, y: org.y + ly * e };
				// The tail can only be as long as the distance already covered, so the
				// ribbon unwraps out of the button instead of being drawn full length.
				const tl = Math.max(0, Math.min(lenNow, travelled));
				const pts = [];
				for (let i = 0; i <= n; i++) {
					const dd = (i / n) * tl;
					pts.push({ x: head.x - ux * dd, y: head.y - uy * dd });
				}
				return { pts: pts, head: head, travelled: travelled, total: ll, onEdge: 0, ux: ux, uy: uy };
			}

			// Bend the tail from the flight line onto the frame. Both poses are
			// sampled by "distance behind the head", so mixing them point by point
			// is continuous: at k=0 it is the pose the flight ended with, at k=1 it
			// is the landed ribbon, and in between the corner of the L shows up.
			function redressTail(track, headS, trail, steps, dir, head, ux, uy, k) {
				const n = Math.max(6, steps | 0);
				const pts = [];
				for (let i = 0; i <= n; i++) {
					const dd = (i / n) * trail;
					const base = track.at(wrapArc(track, headS - dir * dd));
					const lineX = head.x - ux * dd;
					const lineY = head.y - uy * dd;
					pts.push({ x: lineX + (base.x - lineX) * k, y: lineY + (base.y - lineY) * k });
				}
				return pts;
			}

			function polyRibbon(pts, half) {
				const n = pts.length;
				if (n < 2) return "";
				const left = [];
				const right = [];
				for (let i = 0; i < n; i++) {
					const p = pts[i];
					const q = pts[Math.min(n - 1, i + 1)];
					const o = pts[Math.max(0, i - 1)];
					let ax = q.x - o.x;
					let ay = q.y - o.y;
					const len = Math.sqrt(ax * ax + ay * ay) || 1;
					ax /= len;
					ay /= len;
					const nx = -ay;
					const ny = ax;
					const ww = Math.max(0.12, half * taper(i / (n - 1)));
					left.push((p.x + nx * ww).toFixed(1) + " " + (p.y + ny * ww).toFixed(1));
					right.push((p.x - nx * ww).toFixed(1) + " " + (p.y - ny * ww).toFixed(1));
				}
				return "M" + left.join(" L") + " L" + right.reverse().join(" L") + " Z";
			}

			function nowMs() {
				if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
					return performance.now();
				}
				return Date.now();
			}

			function senderOrigin() {
				try {
					const nodes = document.querySelectorAll('button[aria-label], [role="button"][aria-label]');
					for (let i = 0; i < nodes.length; i++) {
						const el = nodes[i];
						const label = String(el.getAttribute("aria-label") || "").toLowerCase();
						if (label.indexOf("send") === -1 && label.indexOf("发送") === -1) continue;
						const r = el.getBoundingClientRect();
						if (!(r.width > 4) || !(r.height > 4)) continue;
						return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
					}
				} catch (e) { /* noop */ }
				return null;
			}

			function inViewport(r) {
				if (!r || !(r.width > 4) || !(r.height > 2)) return false;
				const vw = typeof window !== "undefined" ? window.innerWidth : 0;
				const vh = typeof window !== "undefined" ? window.innerHeight : 0;
				return r.left + r.width > 4 && r.top + r.height > 4 && r.left < vw - 4 && r.top < vh - 4;
			}

			function rectToRing(r, pad) {
				if (!r || !(r.width > 6) || !(r.height > 3)) return null;
				const extra = Math.max(2, pad);
				return {
					cx: r.left + r.width / 2,
					cy: r.top + r.height / 2,
					rx: Math.max(10, r.width / 2 + extra),
					ry: Math.max(10, r.height / 2 + extra),
				};
			}

			// The composer is the union of the text box and the send button: both
			// have to sit inside the ring for it to read as "that conversation".
			function composerRect() {
				let box = null;
				try {
					const edits = document.querySelectorAll('[contenteditable="true"]');
					for (let i = 0; i < edits.length; i++) {
						const r = edits[i].getBoundingClientRect();
						if (inViewport(r) && r.width > 120) { box = r; break; }
					}
				} catch (e) { box = null; }
				let btn = null;
				try { btn = senderOrigin(); } catch (e) { btn = null; }
				if (box && btn) {
					const left = Math.min(box.left, btn.x - 16);
					const right = Math.max(box.right, btn.x + 16);
					const top = Math.min(box.top, btn.y - 16);
					const bottom = Math.max(box.bottom, btn.y + 16);
					return { left: left, top: top, width: right - left, height: bottom - top };
				}
				return box;
			}

			// Reading the toggle's own label is the only reliable way to tell a
			// folded sidebar from an expanded one without private shell state.
			function sidebarState() {
				try {
					const nodes = document.querySelectorAll('button[aria-label]');
					for (let i = 0; i < nodes.length; i++) {
						const el = nodes[i];
						const label = String(el.getAttribute("aria-label") || "").toLowerCase();
						const isOpen = label.indexOf("\u6253\u5f00\u4fa7\u8fb9\u680f") >= 0 || label.indexOf("open sidebar") >= 0;
						const isClose = label.indexOf("\u6536\u8d77\u4fa7\u8fb9\u680f") >= 0 || label.indexOf("collapse sidebar") >= 0;
						if (!isOpen && !isClose) continue;
						const r = el.getBoundingClientRect();
						if (!inViewport(r)) continue;
						return { el: el, rect: r, collapsed: isOpen };
					}
				} catch (e) { /* noop */ }
				return null;
			}

			function findSessionRow(sessionId) {
				if (!sessionId) return null;
				try {
					const el = document.querySelector('[data-row-key="session:' + String(sessionId).replace(/["\\]/g, "\\$&") + '"]');
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return inViewport(r) ? r : null;
				} catch (e) { return null; }
			}

			/**
			 * Where a finishing ribbon circles before it fades:
			 * - the conversation on screen -> its composer;
			 * - a background conversation with the sidebar open -> its own row;
			 * - that row scrolled out of view -> the workspace list it lives in;
			 * - the sidebar folded -> the button that re-opens it.
			 */
			// A manual stop must read differently from a normal completion: the band
			// returns to the composer instead of spinning out. The stop control is a
			// button, so a capture-phase pointerdown on the document is enough to
			// remember that the user pulled the plug.
			let lastStopAt = 0;
			function manualStopRecently() {
				return lastStopAt > 0 && (nowMs() - lastStopAt) < 6000;
			}

			// One transcript row. DSH clamps every row to a single line, so the
			// height says nothing; what is stable is the *structure* of the row:
			//   tool   - contains a callRow/toolRow/toolCard block;
			//   think  - carries a think/reason marker, or its first words are the
			//            reasoning label ("思考中", "已深度思考（用时 4s）", "Thinking");
			//   answer - plain markdown prose with neither of the above.
			// Reasoning is streamed text too, so a length test alone inevitably
			// let the band circle a half-finished thought: classify first, then
			// only ever orbit the row classified as the answer.
			const THINK_LABEL = /^[\s\u200b"\'\u201c\u300c]*(?:\u5df2?\u6df1\u5ea6\u601d\u8003|\u6b63\u5728\u6df1\u5ea6\u601d\u8003|\u5df2?\u601d\u8003\u4e2d|\u6b63\u5728\u601d\u8003|\u601d\u8003\u8fc7\u7a0b|\u601d\u8003|\u63a8\u7406\u8fc7\u7a0b|\u6b63\u5728\u63a8\u7406|\u6df1\u5ea6\u63a8\u7406|thinking|thought|reasoning|reasoned|deep\s*think)/i;

			function rowKind(row) {
				try {
					if (!row) return "none";
					if (row.querySelector && row.querySelector('[class*="callRow"], [class*="CallRow"], [class*="toolRow"], [class*="toolCard"]')) return "tool";
					if (row.querySelector && row.querySelector('[class*="think"], [class*="Think"], [class*="reason"], [class*="Reason"], [class*="thought"], [class*="Thought"]')) return "think";
					const txt = String(row.textContent || "").replace(/^[\s\u200b]+/, "");
					if (THINK_LABEL.test(txt)) return "think";
					const body = row.querySelector ? row.querySelector('[class*="v5IAXa_body"]') : null;
					const md = row.querySelector ? row.querySelector('[class*="_markdown_"]') : null;
					if (body && !md && !body.querySelector("p, li, pre, h1, h2, h3, ol, ul, table")) return "think";
					return "answer";
				} catch (e) {
					return "none";
				}
			}

			function answerBlock() {
				try {
					const ce = document.querySelector('[contenteditable="true"]');
					if (!ce) return null;
					let host = ce;
					for (let i = 0; i < 12 && host.parentElement; i++) {
						host = host.parentElement;
						const r = host.getBoundingClientRect();
						if (r.height > 300 && r.width > 300) break;
					}
					const rows = host.querySelectorAll('[class*="flowItem"]');
					if (!rows.length) return null;
					for (let i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
						const row = rows[i];
						const kind = rowKind(row);
						if (kind === "tool") continue;
						const r = row.getBoundingClientRect();
						if (r.width < 40 || r.height < 10) continue;
						if (r.bottom < 8 || r.top > window.innerHeight - 4) continue;
						if (kind !== "answer") return null;
						const len = proseLength(row);
						if (len < 40) return null;
						return { rect: r, row: row, len: len, kind: kind };
					}
					return null;
				} catch (e) {
					return null;
				}
			}

			/**
			 * How much *prose* the row holds. Tool calls, tool output, file diffs
			 * and command logs all live outside the assistant body, so measuring
			 * only the body means an edit/read/tool phase never looks like the
			 * model writing its answer - the orbit is reserved for the final
			 * output, exactly as asked.
			 */
			function proseLength(row) {
				if (!row) return 0;
				try {
					const bodies = row.querySelectorAll('[class*="v5IAXa_body"], [class*="_markdown_"]');
					let n = 0;
					for (let i = 0; i < bodies.length; i++) {
						const el = bodies[i];
						if (el.closest && el.closest('[class*="callRow"], [class*="toolRow"], [class*="toolCard"], [class*="think"], [class*="Think"], [class*="reason"], [class*="Reason"]')) continue;
						n += String(el.textContent || "").length;
					}
					return n;
				} catch (e) {
					return 0;
				}
			}

			function returnRing(sessionId, currentId) {
				const state = sidebarState();
				const folded = !!(state && state.collapsed);
				if (!sessionId || sessionId === currentId) {
					return rectToRing(composerRect(), 12);
				}
				if (folded && state) return rectToRing(state.rect, 9);
				const row = findSessionRow(sessionId);
				if (row) return rectToRing(row, 8);
				try {
					const trees = document.querySelectorAll('[role="tree"]');
					for (let i = 0; i < trees.length; i++) {
						const r = trees[i].getBoundingClientRect();
						if (inViewport(r) && r.height > 40) return rectToRing(r, 10);
					}
				} catch (e) { /* noop */ }
				return rectToRing(composerRect(), 12) || (state ? rectToRing(state.rect, 9) : null);
			}

			// Ramanujan's ellipse perimeter: the ring is a rounded box, not a
			// circle, so a plain 2*pi*r would run the lap at the wrong speed.
			function ellipsePerimeter(rx, ry) {
				const a = Math.max(1, rx);
				const b = Math.max(1, ry);
				const hh = ((a - b) * (a - b)) / ((a + b) * (a + b));
				return Math.PI * (a + b) * (1 + (3 * hh) / (10 + Math.sqrt(4 - 3 * hh)));
			}

			// Straight leg from where the band died to the nearest point of the
			// ring, then exactly one lap around it.
			// An orbit ribbon keeps the same length it has on the frame edge. A small
// answer block would otherwise squeeze the tail (and it would visibly grow and
// shrink while the answer streams in), so the ring is inflated just enough to
// hold the whole tail. The shape stays the same rounded rectangle, only bigger.
function fitRing(ring, need) {
	if (!ring || !need) return ring;
	let per = ellipsePerimeter(ring.rx, ring.ry);
	if (!(per > 1)) return ring;
	const want = need / 0.8;
	if (per >= want) return ring;
	let s = Math.min(2.6, want / per);
	for (let k = 0; k < 2; k++) {
		per = ellipsePerimeter(ring.rx * s, ring.ry * s);
		if (per >= want) break;
		s = Math.min(2.6, s * (want / Math.max(1, per)));
	}
	return { cx: ring.cx, cy: ring.cy, rx: ring.rx * s, ry: ring.ry * s };
}

function returnPath(from, ring) {
				const tb = ringTable(ring);
				const ang0 = nearestAngle(ring, from);
				const s0 = arcAtAngle(tb, ang0);
				const p0 = ringRaw(ring, ang0);
				const leg = Math.sqrt((p0.x - from.x) * (p0.x - from.x) + (p0.y - from.y) * (p0.y - from.y));
				const lap = tb.total;
				const total = leg + lap;
				return {
					total: total,
					leg: leg,
					lap: lap,
					at: function (s) {
						const q = Math.max(0, Math.min(total, s));
						if (q <= leg) {
							const k = leg > 0 ? q / leg : 1;
							return { x: from.x + (p0.x - from.x) * k, y: from.y + (p0.y - from.y) * k };
						}
						return ringPoint(ring, angleFromArc(tb, s0 + (q - leg)));
					},
				};
			}

			/**
			 * The coordinate a newborn band flies to. It is captured once, at the
			 * moment the band appears: the tail of a band that was already running.
			 * Freezing it means the throw aims at where the stream visibly was,
			 * rather than at a slot that slides away during the flight. A lone
			 * band has no neighbour, so it aims at its own slot.
			 */
			// Placement helpers. A newcomer is dropped into the middle of the widest
			// empty stretch of the ring, so it can never displace a band that is
			// already running; offsets are latched at birth and never recomputed
			// from the band count, which is what keeps every band an independent
			// entity instead of a member of a re-spaced group.
			function widestGapCenter(phases) {
				if (!phases || !phases.length) return 0;
				const sorted = phases.slice().sort(function (a, b) { return a - b; });
				let bestAt = 0;
				let bestGap = -1;
				for (let k = 0; k < sorted.length; k++) {
					const a = sorted[k];
					const b = k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + 1;
					const gap = b - a;
					if (gap > bestGap) { bestGap = gap; bestAt = a + gap / 2; }
				}
				return ((bestAt % 1) + 1) % 1;
			}

			// Both mid-points of the widest empty stretch. Either one splits that gap
			// in half, so picking by hand does not change how evenly the bands sit.
			function widestGapCandidates(phases) {
				if (!phases || !phases.length) return [];
				const sorted = phases.slice().sort(function (a, b) { return a - b; });
				let best = -1;
				const out = [];
				for (let k = 0; k < sorted.length; k++) {
					const a = sorted[k];
					const b = k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + 1;
					const gap = b - a;
					const mid = ((a + gap / 2) % 1 + 1) % 1;
					if (gap > best + 0.0001) { best = gap; out.length = 0; out.push(mid); }
					else if (Math.abs(gap - best) <= 0.0001) out.push(mid);
				}
				return out;
			}

			// Pick where a newborn band should sit. Two things matter: how far the
			// head has to fly (short throws look better) and whether it arrives along
			// the direction the edge actually moves. Landing head-on into its own
			// track forced a hairpin; scoring the incoming angle rules that out.
			function chooseOffset(cands, basePh, track, org, dirSign) {
				const scoreOf = function (off) {
					const ph = ((basePh + off) % 1 + 1) % 1;
					const s = track.offset + sweep(ph) * track.total;
					const pt = track.at(s);
					if (!org) return 0;
					const dist = Math.hypot(pt.x - org.x, pt.y - org.y) || 0.001;
					const ahead = track.at(wrapArc(track, s + (dirSign < 0 ? -0.5 : 0.5)));
					const vx = ahead.x - pt.x;
					const vy = ahead.y - pt.y;
					const vl = Math.hypot(vx, vy) || 1;
					const ux = (pt.x - org.x) / dist;
					const uy = (pt.y - org.y) / dist;
					const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / vl));
					return dist + 420 * (Math.acos(cos) / Math.PI);
				};
				if (!cands || !cands.length) {
					// A lone band may sit anywhere: put it where the button is closest to
					// the frame AND the arrival runs with the edge, so it spits out and
					// immediately travels away instead of doubling back.
					let bestOff = 0;
					let bestScore = Infinity;
					for (let k = 0; k < 72; k++) {
						const off = k / 72;
						const sc = scoreOf(off);
						if (sc < bestScore) { bestScore = sc; bestOff = off; }
					}
					return bestOff;
				}
				let best = cands[0];
				let bestScore = Infinity;
				for (let k = 0; k < cands.length; k++) {
					const sc = scoreOf(cands[k]);
					if (sc < bestScore) { bestScore = sc; best = cands[k]; }
				}
				return best;
			}

			function wrapCenter(v) {
				const w = ((v % 1) + 1) % 1;
				return w > 0.5 ? w - 1 : w;
			}

			function entryGrab(track, sweptBase, i, count, trail) {
				const n = Math.max(1, count | 0);
				let srcS = track.offset + ((((sweptBase + i / n) % 1) + 1) % 1) * track.total;
				if (n > 1) {
					const srcPhase = (((sweptBase + ((i + n - 1) % n) / n) % 1) + 1) % 1;
					srcS = track.offset + srcPhase * track.total - trail;
				}
				const s = Math.max(0, srcS);
				const pt = track.at(s);
				return {
					x: pt.x,
					y: pt.y,
					phase: (((((s - track.offset) / track.total) % 1) + 1) % 1),
				};
			}

			// How a freshly landed band sprints onto its own slot. It always runs
			// the way the ring already turns - reversing here is what read as the
			// band retreating along the edge right after it docked. The velocity
			// starts at rest (the throw eased out) and lands exactly on ring speed,
			// so the merge has no visible stutter.
			function catchPlan(grabPhase, slot, total, lapMs, dir) {
				const sign = dir < 0 ? -1 : 1;
				const fwd = (((slot - grabPhase) % 1) + 1) % 1;
				const back = (((grabPhase - slot) % 1) + 1) % 1;
				// Positive: the band sits behind its slot and closes in forwards.
				// Negative: it sits ahead and closes in backwards. Either way it
				// keeps running the way the ring already turns.
				let gap = sign > 0 ? fwd : -back;
				if (Math.abs(gap) > 0.999) gap = 0;
				// The merge must never look like a lunge. Closing the gap rides on
				// top of the ring motion, so the chase may only spend a fraction of
				// the ring speed; smoothstep peaks at 1.5x its average, so the
				// duration follows from the gap itself.
				const baseSpeed = total / Math.max(1, lapMs);
				const chaseCap = Math.max(0.25, baseSpeed * 0.8);
				const dur = Math.max(CATCH_MIN_MS, Math.min(CATCH_MAX_MS, (Math.abs(gap) * total * 1.5) / chaseCap));
				return { gap: gap, dur: dur };
			}

			// The composer chip is the only trustworthy source: the host renders it
			// as a span carrying data-model-id / data-provider-id for the model
			// actually selected in this conversation. Menu rows carry the same
			// attributes, so rows are skipped and the candidate nearest the send
			// button wins - that is the composer of the conversation on screen.
			function readChip(el, origin) {
				if (!el) return null;
				let r = null;
				try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
				if (!r || !(r.width > 2)) return null;
				const modelId = String(el.getAttribute("data-model-id") || "");
				const providerId = String(el.getAttribute("data-provider-id") || "");
				const modelName = String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
				if (!modelId && !modelName) return null;
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				const dist = origin ? Math.sqrt((cx - origin.x) * (cx - origin.x) + (cy - origin.y) * (cy - origin.y)) : r.top;
				return { modelId: modelId, providerId: providerId, modelName: modelName, dist: dist };
			}

			function scanComposerModel() {
				let origin = null;
				try { origin = senderOrigin(); } catch (e) { origin = null; }
				let best = null;
				try {
					const chips = document.querySelectorAll("[data-model-id]");
					for (let i = 0; i < chips.length; i++) {
						const el = chips[i];
						if (el.closest && el.closest('[role="menu"],[role="listbox"]')) continue;
						const hit = readChip(el, origin);
						if (!hit) continue;
						if (!hit.modelId && !themeKeyForText(hit.modelName)) continue;
						if (!best || hit.dist < best.dist) best = hit;
					}
				} catch (e) { /* noop */ }
				if (best) {
					return { modelId: best.modelId, providerId: best.providerId, modelName: best.modelName, domText: best.modelName };
				}
				// No chip at all: read whatever the composer shows for the model.
				try {
					const nodes = document.querySelectorAll("[aria-label]");
					for (let i = 0; i < nodes.length; i++) {
						const el = nodes[i];
						const label = String(el.getAttribute("aria-label") || "");
						if (!/\u6a21\u578b|model/i.test(label)) continue;
						const hit = readChip(el, origin);
						if (!hit) continue;
						if (!themeKeyForText(hit.modelName) && !themeKeyForText(label)) continue;
						hit.domText = hit.modelName + " " + label;
						if (!best || hit.dist < best.dist) best = hit;
					}
				} catch (e) { /* noop */ }
				if (best) {
					return { modelId: "", providerId: "", modelName: best.modelName, domText: best.modelName };
				}
				return null;
			}

			// React 18 always ships `memo`; keep a pass-through fallback so a
			// stripped-down host (or an offline test stub) cannot fail the load.
			const memo = typeof React.memo === "function" ? React.memo : function (fn) { return fn; };

			/**
			 * All ribbons of one frame. They share a track, a palette and a clock;
			 * each one owns a phase slot (i / count) and is born on its own.
			 *
			 * A newly spawned ribbon starts at the send-button start point and
			 * slides to its slot with an overshooting ease, which is the "second
			 * process pops out of the send button and turns up on the opposite
			 * side" behaviour.
			 */
			const CometField = memo(function CometField(props) {
				const w = props.width;
				const hgt = props.height;
				const trail = props.trail;
				const thickness = props.thickness;
				const lapMs = props.lapMs;
				const startX = props.startX;
				const count = Math.max(1, Math.min(MAX_COMETS, props.count | 0));
				const theme = props.theme || THEMES.deepseek;
				// One palette per band: band i belongs to one conversation, and each
				// conversation may be running a different model.
				const bandList = props.themes && props.themes.length ? props.themes : null;
				const themesRef = useRef(bandList);
				themesRef.current = bandList;
				const themeRef = useRef(theme);
				themeRef.current = theme;
				const themeSig = bandList ? bandList.map(function (t) { return t.key; }).join(",") : theme.key;
				function bandTheme(i) {
					const arr = themesRef.current;
					return (arr && arr[i]) || themeRef.current;
				}
				const edgeGlow = props.edgeGlow !== false;
				const active = props.active !== false;
				const direction = props.direction === -1 ? -1 : 1;
				// One band may leave the edge and circle the answer block: the slot
				// of the conversation that is currently writing its reply.
				const orbitIndex = typeof props.orbitIndex === "number" ? props.orbitIndex : -1;
				const orbitRing = props.orbit || null;
				const manualStop = props.manualStop === true;
				// Last head position per band, published for the exit animation.
				// Never cleared on teardown: the exit needs it after we go idle.
				const headsSink = props.headsSink || null;

				const groupRefs = useRef([]);
				const nodeCache = useRef(null);
				const clockRef = useRef(0);
				const birthRef = useRef([]);
				const prevCountRef = useRef(0);
				// State machine of the band that rides the answer block.
				const orbitRef = useRef({});
				const resumeAtRef = useRef(0);
				const orbitRingRef = useRef(orbitRing);
				const stopRef = useRef(manualStop);
				orbitRingRef.current = orbitRing;
				stopRef.current = manualStop;
				// Read through a ref: flipping the spin must not restart the loop
				// (that would re-birth every ribbon and jump the phase).
				const dirTargetRef = useRef(direction);
				// Launch point of a newborn ribbon (the send button), also read
				// through a ref so moving the composer never restarts the loop.
				const originRef = useRef(null);
				const cornerPhRef = useRef(null);
				const shiftRef = useRef({});
				const pendingRef = useRef({});
				// Per band: the coordinate captured at birth (the tail of a band
				// that was already running) and the sprint that follows.
				const grabRef = useRef({});
				const catchRef = useRef({});
				// Trail length and slot offset also travel instead of jumping: the
				// first is how long the tail still has to unroll after docking, the
				// second is where the slot was before the band count changed.
				const lenRef = useRef({});
				// offset[band] is frozen at birth: position is base + offset, so the
				// gaps never change and no band ever corrects toward another.
				const landedRef = useRef({});
				const redressRef = useRef({});
				const phRef = useRef({});
			const settleRef = useRef({});
				const offRef = useRef({});
				if (!nodeCache.current) {
					try { nodeCache.current = new WeakMap(); } catch (e) { nodeCache.current = null; }
				}

				useEffect(() => { dirTargetRef.current = direction; }, [direction]);

				const launch = props.origin || null;
				const launchX = launch ? launch.x : null;
				const launchY = launch ? launch.y : null;
				useEffect(() => {
					originRef.current = launchX === null || launchY === null ? null : { x: launchX, y: launchY };
				}, [launchX, launchY]);

				useEffect(() => {
					if (!active) {
						// Do not wipe the per band state here: switching tasks makes the
						// overlay blink out for a moment, and relaunching every band from the
						// send button on the way back is the "ribbons flying around" effect.
						resumeAtRef.current = nowMs();
						orbitRef.current = {};
						// Fade the frozen shapes out, never blink them: the exit ghost takes
						// over from the last head position, so the hand-over has to overlap.
						try {
							for (let i = 0; i < groupRefs.current.length; i++) {
								const g = groupRefs.current[i];
								if (!g) continue;
								g.style.transition = "opacity " + FADE_OUT_MS + "ms ease-out";
								g.style.opacity = "0";
							}
							const groups = groupRefs.current.slice();
							setTimeout(function () {
								for (let i = 0; i < groups.length; i++) {
									const g = groups[i];
									if (!g) continue;
									const parts = ["ribbon", "edge-a", "edge-b", "disp"];
									for (let k = 0; k < parts.length; k++) {
										const nodes = g.querySelectorAll("[data-r=\"" + parts[k] + "\"]");
										for (let j = 0; j < nodes.length; j++) nodes[j].setAttribute("d", "");
									}
									const head = g.querySelector("[data-r=\"head\"]");
									if (head) { head.setAttribute("cx", "0"); head.setAttribute("cy", "0"); }
									const glow = g.querySelector("[data-r=\"glow\"]");
									if (glow) glow.setAttribute("r", "0");
								}
							}, FADE_OUT_MS + 120);
						} catch (e) { /* noop */ }
						return;
					}
					let track = null;
					try { track = buildTrack(w, hgt, thickness / 2, startX); } catch (e) { track = null; }
					if (!track) return;
					// Where the bottom-left corner sits on the track. A new band waits
					// until its own slot reaches this phase, so it appears exactly on the
					// line-up instead of flying in and needing a catch-up afterwards.
					{
						const half = Math.max(1, thickness / 2);
						const cx = half * 1.6;
						const cy = hgt - half * 1.6;
						let bestPh = 0;
						let bestD = Infinity;
						for (let k = 0; k < 720; k++) {
							const ph = k / 720;
							const pt = track.at(track.offset + ph * track.total);
							const dd = (pt.x - cx) * (pt.x - cx) + (pt.y - cy) * (pt.y - cy);
							if (dd < bestD) { bestD = dd; bestPh = ph; }
						}
						cornerPhRef.current = bestPh;
					}
					for (let i = 0; i < groupRefs.current.length; i++) {
					const g0 = groupRefs.current[i];
					if (g0) { g0.style.transition = ""; g0.style.opacity = ""; }
				}
				const resumeGap = resumeAtRef.current ? nowMs() - resumeAtRef.current : -1;
				if (!(resumeGap >= 0 && resumeGap < RESUME_MS)) {
					birthRef.current = [];
					grabRef.current = {};
					catchRef.current = {};
					lenRef.current = {};
					offRef.current = {};
							phRef.current = {};
				settleRef.current = {};
				}
				resumeAtRef.current = 0;
				const baseHalf = Math.max(0.5, thickness / 2);
				const t0 = nowMs();
					if (!clockRef.current) clockRef.current = t0;
					const prev = prevCountRef.current;
					for (let i = 0; i < count; i++) {
						if (i >= prev || !birthRef.current[i]) {
							birthRef.current[i] = t0;
						pendingRef.current[i] = true;
							delete grabRef.current[i];
							delete catchRef.current[i];
							delete offRef.current[i];
									delete phRef.current[i];
									delete settleRef.current[i];
									delete redressRef.current[i];
									delete landedRef.current[i];
						}
					}
					prevCountRef.current = count;

					function nodesOf(g) {
						if (!g) return null;
						const cache = nodeCache.current;
						if (!cache) return null;
						let n = cache.get(g);
						if (n && n.ribbon && n.ribbon.isConnected !== false) return n;
						n = {
							ribbon: g.querySelector('[data-r="ribbon"]'),
							edgeA: g.querySelector('[data-r="edge-a"]'),
							edgeB: g.querySelector('[data-r="edge-b"]'),
							head: g.querySelector('[data-r="head"]'),
							glow: g.querySelector('[data-r="glow"]'),
							grad: g.querySelector("linearGradient"),
							disp: g.querySelectorAll('[data-r="disp"]'),
							rim: g.querySelector('[data-r="rim"]'),
							dots: g.querySelectorAll('[data-r="dot"]'),
						};
						cache.set(g, n);
						return n;
					}

					let raf = 0;
					// Spin state kept across frames: `base` is the loop phase we
					// integrate ourselves, `dir` eases towards the requested spin so
					// a reversal slows the head down, stops and sends it back the
					// other way instead of teleporting it to the mirrored point.
					const spin = { base: null, from: dirTargetRef.current, to: dirTargetRef.current, dir: dirTargetRef.current, since: 0, t: 0 };
					function frame(now) {
						const elapsed = now - clockRef.current;
						let pp;
						if (DEBUG_P === null) {
							if (spin.base === null) {
								// Start the lap so band 0 sits on the corner: that is where bands
								// are born now, so the first one appears without any waiting.
								spin.base = cornerPhRef.current === null ? (elapsed % lapMs) / lapMs : sweepInv(cornerPhRef.current);
								spin.t = now;
								spin.since = now;
							}
							let dt = now - spin.t;
							spin.t = now;
							if (!(dt > 0)) dt = 16;
							// A dropped frame must not slow the band down, so the clamp is
							// generous (only there to stop a long stall from teleporting
							// it around the frame).
							if (dt > 400) dt = 400;
							DIAG.dt = dt;
							DIAG.lap = lapMs;
							stepSweepAmp(dt);
							const want = dirTargetRef.current;
							if (want !== spin.to) {
								spin.from = spin.dir;
								spin.to = want;
								spin.since = now;
							}
							// Ease the spin over REVERSE_MS so the head decelerates to a
							// standstill and comes back the other way, instead of
							// snapping to the mirrored point of the loop.
							const uu = Math.min(1, Math.max(0, (now - spin.since) / REVERSE_MS));
							const ee = uu >= 1 ? 1 : (uu < 0.5 ? 4 * uu * uu * uu : 1 - Math.pow(-2 * uu + 2, 3) / 2);
							if (ee >= 1) {
								spin.dir = spin.to;
								spin.from = spin.to;
							} else {
								spin.dir = spin.from + (spin.to - spin.from) * ee;
							}
							spin.base = (spin.base + (dt / lapMs) * spin.dir) % 1;
							if (spin.base < 0) spin.base += 1;
							pp = spin.base;
						} else {
							pp = DEBUG_P;
						}
						// Every band sits at base + offset. The base advances by time
						// alone and is shared, so the gaps stay exactly what they were
						// when the band was born; the offset is frozen at birth, at the
						// middle of the widest empty stretch, so a newcomer can never
						// push a band that is already running. No band ever corrects
						// toward another one, which is what used to make them chase.
						// sweep() is applied once to the shared clock, not per band, so every
						// band accelerates and decelerates at the same instant. Each band then
						// sits at an even arc step from the base (base + i / count), which puts
						// two bands exactly opposite each other.
						const warpedBase = ((sweep(pp) % 1) + 1) % 1;
						for (let i = 0; i < count; i++) {
							const g = groupRefs.current[i];
							const nd = nodesOf(g);
							if (!nd || !nd.ribbon) continue;
							const bu = Math.min(1, Math.max(0, (now - (birthRef.current[i] || now)) / BIRTH_MS));
							// The raw phase integrates linearly; sweep() warps it into the
							// non-linear profile (slow at the start of a lap, fast through
							// the middle), which is what keeps the motion from reading as
							// a constant-speed conveyor belt.
							// Each band keeps its own phase and drifts towards the even slot
							// (base + i / count) by bending its speed a little. No position is
							// ever snapped and no band ever chases another, so the gaps settle
							// to an even split and then stay there.
							const targetRaw = (((warpedBase + i / count) % 1) + 1) % 1;
							let phRaw = phRef.current[i];
							if (phRaw === void 0) phRaw = targetRaw;
							// Re-spacing: close the gap this band still owes over SETTLE_MS on a
							// smoothstep (zero extra speed at both ends). The shared warped base
							// keeps the whole line-up in step once the gap is gone.
							let stl = settleRef.current[i];
							if (!stl || stl.count !== count || Math.sign(stl.dir) !== Math.sign(spin.dir)) {
								stl = settleRef.current[i] = {
									count: count,
									dir: spin.dir,
									t0: now,
									gap: wrapCenter(phRaw - targetRaw),
								};
							}
							const su = Math.min(1, Math.max(0, (now - stl.t0) / SETTLE_MS));
							const sk = su * su * (3 - 2 * su);
							phRaw = (((targetRaw + stl.gap * (1 - sk)) % 1) + 1) % 1;
							phRef.current[i] = phRaw;
							const slot = phRaw;
							// Release branch: bands are born at the bottom-left corner of the
							// frame rather than flown in from the send button. A band waits
							// here until its own slot passes that corner, so the moment it
							// appears is already the moment the line-up expects it - nothing
							// has to catch up afterwards.
							if (pendingRef.current[i]) {
								const waitPh = ((((cornerPhRef.current - phRaw) % 1) + 1) % 1);
								// Appear as soon as the slot is within SPAWN_LEAD of the corner,
								// on either side of it. The small remaining distance is closed by
								// a short eased slide, so a band never waits a whole extra lap and
								// still joins the line-up without any catch-up phase.
								const SPAWN_LEAD = 0.16;
								const SPAWN_MS = 260;
								const near = waitPh <= SPAWN_LEAD || waitPh >= 1 - SPAWN_LEAD;
								if (!near) { g.style.opacity = "0"; continue; }
								delete pendingRef.current[i];
								birthRef.current[i] = now;
								lenRef.current[i] = { len: 0, dockAt: now };
								shiftRef.current[i] = { d: waitPh <= 0.5 ? waitPh : -(1 - waitPh), t0: now, ms: SPAWN_MS };
								g.style.opacity = "";
							}
							// The throw target is the point this band will own, projected
							// forward by the throw duration, so the head arrives where its
							// phase already is instead of having to snap afterwards.
							const reach = function (ph) { return track.at(track.offset + ((ph % 1) + 1) % 1 * track.total); };
							const dirSign = dirTargetRef.current < 0 ? -1 : 1;
							let grab = grabRef.current[i];
							if (!grab) {
								// Aim at where this band will be when the throw ends. The flight
								// duration and the aim point depend on each other, so settle them
								// with a few fixed-point rounds: the head then lands exactly on
								// base + offset, and the hand-over needs no correction at all.
								const orgNow = originRef.current;
								let msAim = Math.max(FLY_MIN_MS, Math.min(FLY_MAX_MS, Math.max(140, 3 * 120)));
								let aim = reach(slot);
								let aimPh = slot;
								for (let it = 0; it < 4; it++) {
									aimPh = ((((sweep((((pp + (msAim / Math.max(1, lapMs)) * dirSign) % 1) + 1) % 1) % 1) + 1) % 1) + i / count) % 1;
									aim = reach(aimPh);
									const dd = orgNow ? Math.hypot(aim.x - orgNow.x, aim.y - orgNow.y) : 0;
									const next = Math.max(FLY_MIN_MS, Math.min(FLY_MAX_MS, Math.max(dd * 1.15, dd * 3 / transitCap(aimPh, track.total, lapMs))));
									if (Math.abs(next - msAim) < 1) { msAim = next; break; }
									msAim = next;
								}
								grab = { x: aim.x, y: aim.y, phase: aimPh, ms: msAim };
								grabRef.current[i] = grab;
							}
							// Straight throw to that coordinate; the edge tail joins as the
							// throw lands, and from then on the band is just base + offset.
							const org = null; // release branch: no more throw from the send button
							const age = now - (birthRef.current[i] || now);
							const distLaunch = org ? Math.hypot(grab.x - org.x, grab.y - org.y) : 0;
							const flyMs = Math.max(FLY_MIN_MS, Math.min(FLY_MAX_MS, Math.max(distLaunch * 1.15, distLaunch * 3 / transitCap(slot, track.total, lapMs))));
							const ft = flyMs > 0 ? age / flyMs : 1;
							const flying = !!org && ft < 1;

							let phaseNow = slot;
							{
								const sh = shiftRef.current[i];
								if (sh) {
									const kk = Math.min(1, Math.max(0, (now - sh.t0) / Math.max(1, sh.ms)));
									if (kk >= 1) delete shiftRef.current[i];
									else phaseNow = ((((slot + sh.d * (1 - kk)) % 1) + 1) % 1);
								}
							}
							let dirNow = spin.dir < 0 ? -1 : 1;
							if (!flying) {
								// Position is a pure function of time: the shared base plus
								// this band's frozen offset. Nothing is integrated per band, so
								// a band cannot drift off its gap and nothing can chase.
								phaseNow = phRaw;
							}

							const headS = track.offset + phaseNow * track.total;
							const head = track.at(headS);
							const halfNow = Math.max(0.5, baseHalf * (0.25 + 0.75 * easeOutCubic(Math.min(1, bu * 1.35))));
							// The tail has to arrive with the band: at touchdown it is only as long
							// as the throw, and it unrolls from there instead of snapping to full.
							let lenNow = trail;
							{
								const lst = lenRef.current[i];
								if (flying) {
									const ue = easeOutCubic(Math.max(0, Math.min(1, ft)));
									lenNow = Math.min(trail, distLaunch * ue);
									lenRef.current[i] = { len: lenNow, dockAt: 0 };
								} else if (lst && lst.dockAt) {
									const gu = Math.min(1, Math.max(0, (now - lst.dockAt) / GROW_MS));
									lenNow = lst.len + (trail - lst.len) * easeOutCubic(gu);
								} else {
									if (lst) { lenNow = lst.len; lst.dockAt = now; }
								}
							}

							const bt = bandTheme(i);
							const wobble = bt.glass
								? { amp: baseHalf * 0.9, freq: 1.55, phase: elapsed / 830 + i * 1.7 }
								: null;

							// Per-frame ribbon geometry. The flight leg fills it from
							// the button, the tracked leg from the frame edge.
							let d = "";
							let headPt = head;
							let tailPt = track.at(wrapArc(track, headS - lenNow));
							const dockReady = !flying && (lenRef.current[i] ? now - (lenRef.current[i].dockAt || 0) >= GROW_MS : true);
							const oStore = orbitRef.current;
							const lead = i === orbitIndex && dockReady;
							const oState = oStore[i] || (oStore[i] = { mode: "off" });
							// Only the band that owns the current conversation may start an orbit,
							// but a band already circling keeps its own state until it docks back.
							const orb = null; // release branch: the answer orbit is gone; output just keeps running the edge
							if (orb && (orb.mode === "orbit" || orb.mode === "spin")) {
								// Circle the answer block: the tail walks back along the
								// ellipse by the trail length, so it bends with the ring
								// instead of cutting across it.
								// Same tail length as on the edge: the ring is widened if the answer
								// block is too small to hold it, so the length never breathes.
								// Off the edge the tail is always the full configured length: it must
								// not keep unrolling while the band circles the answer, or the
								// ribbon would look like it grows and shrinks mid-orbit.
								const rfit = fitRing(orb.ring, trail);
								const span = arcSpan(rfit, orb.ang, orb.dirSign, Math.min(trail, ellipsePerimeter(rfit.rx, rfit.ry) * 0.8));
								const pts = [];
								for (let k = 0; k < RIBBON_STEPS; k++) {
									const u = k / (RIBBON_STEPS - 1);
									pts.push(ringPoint(rfit, orb.ang + span * u));
								}
								// Head sits on the fitted ring too, so the ribbon and the head
								// circle stay on the very same curve.
								const hp = ringPoint(rfit, orb.ang);
								headPt = { x: hp.x, y: hp.y };
								tailPt = pts[pts.length - 1];
								d = polyRibbon(pts, halfNow);
								const gg = groupRefs.current[i];
								if (gg) gg.style.opacity = orb.mode === "spin" ? orb.fade.toFixed(3) : "";
							} else if (orb && (orb.mode === "fly" || orb.mode === "dock")) {
								// Straight hop from the edge to the answer block.
								const lx = orb.x - orb.from.x;
								const ly = orb.y - orb.from.y;
								const ll = Math.sqrt(lx * lx + ly * ly) || 1;
								const tl = Math.min(trail, ll);
								const pts = [];
								for (let k = 0; k < RIBBON_STEPS; k++) {
									const u = k / (RIBBON_STEPS - 1);
									pts.push({ x: orb.x - (lx / ll) * tl * u, y: orb.y - (ly / ll) * tl * u });
								}
								headPt = { x: orb.x, y: orb.y };
								tailPt = pts[pts.length - 1];
								d = polyRibbon(pts, halfNow);
								const gg = groupRefs.current[i];
								if (gg) gg.style.opacity = "";
							} else if (flying) {
								const th = throwPath(org, grab, ft, lenNow, track, slot, lapMs, dirTargetRef.current, RIBBON_STEPS - 1);

								headPt = th.head;
								d = polyRibbon(th.pts, halfNow);
								tailPt = th.pts[th.pts.length - 1];
							} else {
								try {
									dirNow = spin.dir < 0 ? -1 : 1;
									// While the ring is reversing, |spin.dir| fades through zero, so
									// the tail collapses and re-grows on the other side instead of
									// pointing the way the head is going.
									const ramp = Math.abs(spin.dir) < 0.02 ? (spin.dir < 0 ? -0.02 : 0.02) : spin.dir;
									// Just after touch-down the tail is still on the flight line. Bend it
									// onto the frame over REDRESS_MS: the two poses are sampled by
									// distance behind the head, so the corner of the L shows up in
									// between and nothing snaps.
									// First frame on the frame after being born: the tail is still on
									// the line the band just flew in on, so remember that direction and
									// re-dress it onto the edge from here.
									if (!redressRef.current[i] && !landedRef.current[i] && org) {
										const dxl = headPt.x - org.x;
										const dyl = headPt.y - org.y;
										const dl = Math.sqrt(dxl * dxl + dyl * dyl) || 1;
										landedRef.current[i] = true;
										redressRef.current[i] = { t0: now, ux: dxl / dl, uy: dyl / dl };
									}
									const rd = redressRef.current[i];
									const rdK = rd ? easeInOutCubic(Math.max(0, Math.min(1, (now - rd.t0) / REDRESS_MS))) : 1;
									if (rdK < 1) {
										d = polyRibbon(redressTail(track, headS, lenNow, RIBBON_STEPS, ramp < 0 ? -1 : 1, headPt, rd.ux, rd.uy, rdK), halfNow);
									} else {
										// Only the re-dress state goes away here. landedRef must stay
										// set: clearing it restarts the re-dress on the very next
										// frame, which draws a straight diagonal across the frame
										// forever instead of a ribbon on the edge.
										if (rd) delete redressRef.current[i];
										d = ribbonPath(track, headS, lenNow, halfNow, RIBBON_STEPS, wobble, ramp);
									}
									tailPt = track.at(wrapArc(track, headS - ramp * lenNow));
								} catch (e) { d = ""; }
							}
							if (!orb) {
							const gg = groupRefs.current[i];
							if (gg) gg.style.opacity = age < FADE_OUT_MS ? (age / FADE_OUT_MS).toFixed(3) : "";
						}
							nd.ribbon.setAttribute("d", d);
							if (nd.edgeA && d) nd.edgeA.setAttribute("d", d);
							if (nd.edgeB && d) nd.edgeB.setAttribute("d", d);

							if (i === 0) { DIAG.b0 = (flying ? "fly" : (orb ? orb.mode : "track")) + " " + w + "x" + hgt + " hd " + Math.round(headPt.x) + "," + Math.round(headPt.y) + " org " + (org ? Math.round(org.x) + "," + Math.round(org.y) : "-"); }
									const hx = headPt.x.toFixed(1);
							const hy = headPt.y.toFixed(1);
							if (nd.head) {
								nd.head.setAttribute("cx", hx);
								nd.head.setAttribute("cy", hy);
								nd.head.setAttribute("r", halfNow.toFixed(2));
							}
							if (nd.glow) {
								nd.glow.setAttribute("cx", hx);
								nd.glow.setAttribute("cy", hy);
								nd.glow.setAttribute("r", (halfNow * 3.6 * (0.55 + 0.45 * bu)).toFixed(2));
							}
							if (nd.grad) {
								nd.grad.setAttribute("x1", tailPt.x.toFixed(1));
								nd.grad.setAttribute("y1", tailPt.y.toFixed(1));
								nd.grad.setAttribute("x2", hx);
								nd.grad.setAttribute("y2", hy);
							}
							if (headsSink) {
								const memo = headsSink.current || (headsSink.current = {});
								memo[i] = { x: headPt.x, y: headPt.y, phase: phaseNow };
							}

							// Liquid glass: every colour channel refracts a little
							// differently, and each one deforms on its own phase, so
							// the body shimmers instead of tinting as one solid band.
							if (bt.glass) {
								const lanes = nd.disp ? nd.disp.length : 0;
								const spread = Math.max(2.1, halfNow * 2);
								const a = (head.angle * Math.PI) / 180;
								const nx = -Math.sin(a);
								const ny = Math.cos(a);
								for (let j = 0; j < lanes; j++) {
									const node = nd.disp[j];
									const t = lanes > 1 ? j / (lanes - 1) - 0.5 : 0;
									const sway = Math.sin(elapsed / 540 + j * 1.3) * spread * 0.35;
									const off = t * spread + sway;
									if (flying) {
										if (d) node.setAttribute("d", d);
									} else {
										let dj = "";
										try {
										dj = ribbonPath(track, headS, lenNow, halfNow, RIBBON_STEPS, {
											amp: baseHalf * (1.15 + 0.35 * t),
											freq: 1.35 + 0.45 * Math.abs(t),
											phase: elapsed / (760 - 90 * Math.abs(t)) + i * 1.7 + j * 0.31,
										}, dirNow);
										} catch (e) { dj = ""; }
										if (!dj) continue;
										node.setAttribute("d", dj);
									}
									node.setAttribute("transform", "translate(" + (nx * off).toFixed(2) + " " + (ny * off).toFixed(2) + ")");
									node.setAttribute("stroke-opacity", String((0.24 + 0.10 * (1 - Math.abs(t) * 2)).toFixed(2)));
								}
								// The rim is the refracting edge of the glass: same
								// ribbon, offset outwards, wobbling on another phase.
								if (nd.rim) {
									let dr = "";
									if (flying) {
										dr = d || "";
									} else {
										try {
										dr = ribbonPath(track, headS, lenNow, halfNow * 0.92, RIBBON_STEPS, {
											amp: baseHalf * 1.55,
											freq: 1.15,
											phase: elapsed / 980 + i * 0.9,
										}, dirNow);
										} catch (e) { dr = ""; }
									}
									nd.rim.setAttribute("d", dr);
									nd.rim.setAttribute("transform", "translate(" + (nx * halfNow * 1.6).toFixed(2) + " " + (ny * halfNow * 1.6).toFixed(2) + ")");
								}
							}

							// Kimi's white sparks drift inside the trail.
							if (nd.dots && nd.dots.length) {
								for (let j = 0; j < nd.dots.length; j++) {
									const u = 0.06 + (j / nd.dots.length) * 0.9;
									const pt = track.at(wrapArc(track, headS - dirNow * u * lenNow));
									const a = (pt.angle * Math.PI) / 180;
									const sway = Math.sin(elapsed / 620 + j * 2.1) * halfNow * 0.85;
									const ca = Math.cos(a);
									const sa = Math.sin(a);
									const node = nd.dots[j];
									node.setAttribute("cx", (pt.x + ca * sway).toFixed(1));
									node.setAttribute("cy", (pt.y + sa * sway).toFixed(1));
									node.setAttribute("r", (0.55 + 0.55 * Math.abs(Math.sin(elapsed / 900 + j * 1.3))).toFixed(2));
									node.setAttribute("opacity", (0.25 + 0.7 * Math.abs(Math.sin(elapsed / 700 + j * 0.9))).toFixed(2));
								}
							}
						}
						}
					// Guarded driver: one thrown frame must not kill the loop, and
					// the reason has to survive where the probe can read it.
					function step(now) {
						DIAG.frames += 1;
						try {
							frame(now);
						} catch (e) {
							DIAG.err = String((e && e.message) || e);
						}
						raf = requestAnimationFrame(step);
					}
					raf = requestAnimationFrame(step);
					return () => cancelAnimationFrame(raf);
				}, [w, hgt, lapMs, thickness, trail, startX, count, themeSig, edgeGlow, active]);

				const half = Math.max(0.5, thickness / 2);
				// The caption buttons are painted over the webview: knock that strip
				// out with a feathered mask instead of letting the comet vanish.
				const chromeX = Math.max(0, w - CHROME_W);
				const chromeW = Math.max(0, w - chromeX);
				const chromeH = Math.min(CHROME_H, hgt);
				const feather = Math.max(0, Math.min(CHROME_FEATHER, chromeX / 2, hgt - chromeH));
				// No native strip (browser tab, or a shell without the overlay): keep
				// the mask fully white and skip the feathered ramps entirely.
				const chromeOn = CHROME_STRIP && chromeW > 0 && chromeH > 0;

				const comets = [];
				for (let i = 0; i < count; i++) {
					const bt = (bandList && bandList[i]) || theme;
					const gradId = "dsh-marquee-grad-" + i;
					const glowId = "dsh-marquee-glow-" + i;
					const kids = [];
					kids.push(h("linearGradient", {
						key: "grad",
						id: gradId,
						gradientUnits: "userSpaceOnUse",
						x1: "0", y1: "0", x2: "1", y2: "0",
					}, bt.stops.map((s, k) => h("stop", { key: k, offset: s[0], stopColor: s[1] }))));
					kids.push(h("radialGradient", {
						key: "glowdef",
						id: glowId,
					}, bt.glow.map((s, k) => h("stop", { key: k, offset: s[0], stopColor: s[1] }))));
					kids.push(h("circle", {
						key: "glow",
						"data-r": "glow",
						className: "dsh-marquee-glow",
						cx: "0", cy: "0", r: String(half * 3.6),
						fill: "url(#" + glowId + ")",
					}));
					kids.push(h("path", {
						key: "ribbon",
						"data-r": "ribbon",
						d: "",
						fill: "url(#" + gradId + ")",
					}));
					if (edgeGlow) {
						kids.push(h("path", {
							key: "edge-b",
							"data-r": "edge-b",
							d: "",
							fill: "none",
							stroke: "#ffffff",
							strokeWidth: String(Math.max(1.4, thickness * 0.75)),
							strokeOpacity: "0.2",
							strokeLinejoin: "round",
							strokeLinecap: "round",
							style: { filter: "blur(3px)" },
						}));
						kids.push(h("path", {
							key: "edge-a",
							"data-r": "edge-a",
							d: "",
							fill: "none",
							stroke: "#ffffff",
							strokeWidth: String(Math.max(0.7, thickness * 0.16)),
							strokeOpacity: "0.85",
							strokeLinejoin: "round",
							strokeLinecap: "round",
							style: { filter: "blur(0.6px)" },
						}));
					}
					if (bt.glass) {
						kids.push(h("path", {
							key: "rim",
							"data-r": "rim",
							d: "",
							fill: "none",
							stroke: "#ffffff",
							strokeWidth: String(Math.max(1.1, thickness * 0.42)),
							strokeOpacity: String(RIM_OPACITY),
							strokeLinejoin: "round",
							strokeLinecap: "round",
							style: { mixBlendMode: "overlay", filter: "blur(0.7px)" },
						}));
						for (let j = 0; j < DISPERSION_COLORS.length; j++) {
							kids.push(h("path", {
								key: "disp-" + j,
								"data-r": "disp",
								d: "",
								fill: "none",
								stroke: DISPERSION_COLORS[j],
								strokeWidth: String(Math.max(1, thickness * 0.34)),
								strokeOpacity: "0.46",
								strokeLinejoin: "round",
								strokeLinecap: "round",
								style: { mixBlendMode: "screen", filter: "blur(1.6px)" },
							}));
						}
					}
					kids.push(h("circle", {
						key: "head",
						"data-r": "head",
						cx: "0", cy: "0", r: String(half),
						fill: bt.core,
					}));
					if (bt.particles) {
						const dots = [];
						for (let j = 0; j < 12; j++) {
							dots.push(h("circle", {
								key: "dot-" + j,
								"data-r": "dot",
								cx: "0", cy: "0", r: "0.9",
								fill: "#ffffff",
								opacity: "0.6",
							}));
						}
						kids.push(h("g", { key: "dots" }, dots));
					}
					comets.push(h("g", {
						key: "comet-" + i,
						ref: (el) => { groupRefs.current[i] = el; },
						className: "dsh-marquee-comet",
						style: { animationDelay: (-i * 0.37).toFixed(2) + "s" },
					}, kids));
				}

				return h(
					"svg",
					{ className: "dsh-marquee-svg", viewBox: "0 0 " + w + " " + hgt, preserveAspectRatio: "none" },
					h("defs", null,
						h("radialGradient", { id: HEAD_GLOW_ID },
							theme.glow.map((s, k) => h("stop", { key: k, offset: s[0], stopColor: s[1] }))
						),
						h("linearGradient", {
							id: FEATHER_X_ID,
							gradientUnits: "userSpaceOnUse",
							x1: String(chromeX - feather), y1: "0",
							x2: String(chromeX), y2: "0",
						},
							h("stop", { offset: "0%", stopColor: "#fff" }),
							h("stop", { offset: "100%", stopColor: "#000" })
						),
						h("linearGradient", {
							id: FEATHER_Y_ID,
							gradientUnits: "userSpaceOnUse",
							x1: "0", y1: String(chromeH),
							x2: "0", y2: String(chromeH + feather),
						},
							h("stop", { offset: "0%", stopColor: "#000" }),
							h("stop", { offset: "100%", stopColor: "#fff" })
						),
						h("mask", {
							id: MASK_ID,
							maskUnits: "userSpaceOnUse",
							x: "0", y: "0", width: String(w), height: String(hgt),
						},
							h("rect", { x: "0", y: "0", width: String(w), height: String(hgt), fill: "#fff" }),
							h("rect", {
								x: String(chromeX), y: "0",
								width: String(chromeW), height: String(chromeH),
								fill: "#000",
							}),
							chromeOn ? h("rect", {
								x: String(chromeX - feather), y: "0",
								width: String(feather), height: String(chromeH),
								fill: "url(#" + FEATHER_X_ID + ")",
							}) : null,
							chromeOn ? h("rect", {
								x: String(chromeX - feather), y: String(chromeH),
								width: String(chromeW + feather), height: String(feather),
								fill: "url(#" + FEATHER_Y_ID + ")",
							}) : null
						)
					),
					h("g", { mask: "url(#" + MASK_ID + ")" }, comets)
				);
			});

			/**
			 * A finishing band: it leaves from wherever the live band was last
			 * seen, flies to its target, circles it exactly once and fades. It
			 * keeps its own clock, so it outlives the live field going idle.
			 *
			 * Glow uses the theme core colour with a blur instead of a radial
			 * gradient: gradient ids must stay unique per document, and this
			 * component renders one gradient per ghost already.
			 */
			const GhostField = memo(function GhostField(props) {
				const w = props.width;
				const hgt = props.height;
				const ghosts = props.ghosts || [];
				const thickness = props.thickness;
				const trail = props.trail;
				const maskUrl = props.maskUrl || MASK_ID;
				const baseHalf = Math.max(0.5, thickness / 2);
				const groupRefs = useRef([]);
				const doneRef = useRef(null);
				doneRef.current = props.onDone || null;

				useEffect(() => {
					if (!ghosts.length) return;
					const lanes = [];
					for (let i = 0; i < ghosts.length; i++) {
						const g = ghosts[i];
						const el = groupRefs.current[i];
						if (!g || !el) continue;
						let path = null;
						try { path = returnPath(g.from, g.target); } catch (e) { path = null; }
						if (!path || !isFinite(path.total) || path.total <= 0) continue;
						// No airspeed cap: the hop is timed from the speed the band carried
						// when it left the edge, and the sine easing peaks at 1.57x its
						// average - so peak speed equals that exit speed exactly.
						const spd = Math.max(0.2, g.speed || props.speed || 0.95);
						const peak = spd;
						lanes.push({
							id: g.id,
							path: path,
							startAt: Math.max(0, g.at || 0),
							dur: Math.max(240, (path.leg + path.lap) / (peak / 1.57)),
							group: el,
							ribbon: el.querySelector('[data-g="ribbon"]'),
							head: el.querySelector('[data-g="head"]'),
							glow: el.querySelector('[data-g="glow"]'),
							grad: el.querySelector("linearGradient"),
						});
					}
					if (!lanes.length) return;
					let raf = 0;
					function frame(now) {
						const finished = [];
						for (let i = 0; i < lanes.length; i++) {
							const lane = lanes[i];
							// The band stays on the edge until its scheduled beat has passed.
							if (now < lane.startAt) { lane.hidden = true; continue; }
							if (lane.hidden) { lane.hidden = false; if (lane.group) lane.group.style.opacity = ""; }
							const u = Math.max(0, Math.min(1, (now - lane.startAt) / lane.dur));
							// sine keeps the peak at 1.57x the average; a cubic would spike to 3x
						const s = (0.5 - 0.5 * Math.cos(Math.PI * u)) * lane.path.total;
							const head = lane.path.at(s);
							const tailLen = Math.min(trail, s);
							const pts = [];
							for (let k = 0; k < RIBBON_STEPS; k++) {
								const uu = k / (RIBBON_STEPS - 1);
								pts.push(lane.path.at(Math.max(0, s - tailLen * uu)));
							}
							const tail = pts[pts.length - 1];
							// hold full strength for most of the trip, fade at the end
							const fade = u < 0.62 ? 1 : Math.max(0, 1 - (u - 0.62) / 0.38);
							if (lane.ribbon) {
								lane.ribbon.setAttribute("d", polyRibbon(pts, baseHalf));
								lane.ribbon.setAttribute("opacity", fade.toFixed(3));
							}
							if (lane.head) {
								lane.head.setAttribute("cx", head.x.toFixed(1));
								lane.head.setAttribute("cy", head.y.toFixed(1));
								lane.head.setAttribute("opacity", fade.toFixed(3));
							}
							if (lane.glow) {
								lane.glow.setAttribute("cx", head.x.toFixed(1));
								lane.glow.setAttribute("cy", head.y.toFixed(1));
								lane.glow.setAttribute("r", (baseHalf * 3.2).toFixed(2));
								lane.glow.setAttribute("opacity", (fade * 0.7).toFixed(3));
							}
							if (lane.grad) {
								lane.grad.setAttribute("x1", tail.x.toFixed(1));
								lane.grad.setAttribute("y1", tail.y.toFixed(1));
								lane.grad.setAttribute("x2", head.x.toFixed(1));
								lane.grad.setAttribute("y2", head.y.toFixed(1));
							}
							if (u >= 1) finished.push(lane.id);
						}
						if (finished.length && doneRef.current) {
							try { doneRef.current(finished); } catch (e) { /* noop */ }
						}
						if (finished.length >= lanes.length) return;
						raf = requestAnimationFrame(frame);
					}
					raf = requestAnimationFrame(frame);
					return function () { cancelAnimationFrame(raf); };
				}, [ghosts, thickness, trail]);

				const groups = [];
				for (let i = 0; i < ghosts.length; i++) {
					const g = ghosts[i];
					const theme = (g && g.theme) || THEMES.deepseek;
					const gradId = "dsh-marquee-gg-" + i;
					groups.push(h("g", {
						key: g.id,
						className: "dsh-marquee-ghost",
						// Invisible until its scheduled departure: it is drawn at (0,0)
						// before the first frame, which would otherwise show a stray dot.
						style: { opacity: 0 },
						ref: (el) => { groupRefs.current[i] = el; },
					},
						h("linearGradient", {
							key: "grad",
							id: gradId,
							gradientUnits: "userSpaceOnUse",
							x1: "0", y1: "0", x2: "1", y2: "0",
						}, theme.stops.map((s, k) => h("stop", { key: k, offset: s[0], stopColor: s[1] }))),
						h("circle", {
							key: "glow",
							"data-g": "glow",
							cx: "0", cy: "0", r: "0",
							fill: theme.core,
							opacity: "0",
							style: { filter: "blur(5px)" },
						}),
						h("path", {
							key: "ribbon",
							"data-g": "ribbon",
							d: "",
							fill: "url(#" + gradId + ")",
							opacity: "0",
						}),
						h("circle", {
							key: "head",
							"data-g": "head",
							cx: "0", cy: "0", r: String(baseHalf),
							fill: theme.core,
							opacity: "0",
						})
					));
				}
				if (!groups.length) return null;
				return h("svg", {
					className: "dsh-marquee-svg dsh-marquee-ghosts",
					viewBox: "0 0 " + w + " " + hgt,
					preserveAspectRatio: "none",
				}, h("g", { mask: "url(#" + maskUrl + ")" }, groups));
			});

			function constantStore(value) {
				const listeners = new Set();
				return {
					subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
					getSnapshot() { return value; },
				};
			}

			function BooleanRow(props) {
				const id = props.id;
				const label = props.label;
				const checked = props.checked === true;
				const disabled = props.disabled === true;
				const onToggle = (next) => {
					try { props.onChange(next === true); } catch (e) { /* noop */ }
				};
				let control = null;
				if (SwitchControl) {
					control = h(SwitchControl, {
						checked: checked,
						disabled: disabled,
						label: label,
						onChange: onToggle,
					});
				} else {
					control = h("button", {
						type: "button",
						disabled: disabled,
						onClick: () => onToggle(!checked),
						style: {
							border: "1px solid rgba(255,255,255,0.24)",
							borderRadius: "6px",
							background: checked ? "rgba(90,150,255,0.35)" : "transparent",
							color: "inherit",
							font: "inherit",
							padding: "3px 10px",
							cursor: disabled ? "default" : "pointer",
						},
					}, checked ? "开" : "关");
				}
				return h("div", { className: CLS.field },
					h("div", { className: CLS.head },
						h("div", { className: CLS.labelGroup },
							h("label", { className: CLS.label, htmlFor: id }, label)
						),
						props.overridden ? h("span", { className: CLS.badges },
							h("button", {
								type: "button",
								className: CLS.reset,
								disabled: disabled,
								onClick: () => { try { props.onReset(); } catch (e) { /* noop */ } },
							}, props.resetLabel || "重置")
						) : null
					),
					control,
					props.hint ? h("p", { className: CLS.hint }, props.hint) : null
				);
			}

			function MarqueeSettings(props) {
				const t = useUiStrings();
				if (props.view === "summary") return null;
				const state = props.useMarqueeForm((value) => value);
				if (!state) return null;
				const disabled = state.writable === false;
				const labels = {
					unavailable: t("unavailable"),
					readOnly: t("readOnly"),
					saveFailed: t("saveFailed"),
					save: t("save"),
					saving: t("saving"),
				};
				const boolRow = (name, label, hint) => {
					const field = state[name] || { text: "", overridden: false };
					const checked = String(field.text === void 0 ? "" : field.text) === "true";
					return h(BooleanRow, {
						key: name,
						id: name,
						label: label,
						hint: hint,
						checked: checked,
						disabled: disabled,
						overridden: field.overridden === true,
						resetLabel: t("reset"),
						onChange: (next) => props.edit(name, next ? "true" : "false"),
						onReset: () => props.resetField(name),
					});
				};
				const themeOptions = THEME_ORDER.map(function (k) {
					const t = themeByKey(k) || {};
					return { value: k, label: t.label || k };
				});
				// A dropdown that rides the same staged form as the numeric rows.
				const selectRow = (name, label) => {
					const field = state[name] || { text: "", overridden: false };
					const current = String(field.text == null ? "" : field.text) || "deepseek";
					return h("div", { key: name, className: CLS.field },
						h("div", { className: CLS.head },
							h("div", { className: CLS.labelGroup },
								h("label", { className: CLS.label, htmlFor: "dsh-marquee-" + name }, label)),
							field.overridden === true ? h("span", { className: CLS.badges },
								h("button", {
									type: "button",
									className: CLS.reset,
									disabled: disabled,
									onClick: () => { try { props.resetField(name); } catch (e) { /* noop */ } },
								}, t("reset"))) : null),
						h("select", {
							id: "dsh-marquee-" + name,
							className: CLS.input,
							value: current,
							disabled: disabled,
							onChange: (e) => { try { props.edit(name, e.target.value); } catch (err) { /* noop */ } },
						}, themeOptions.map((o) => h("option", { key: o.value, value: o.value }, o.label))));
				};
				const modelColorOff = String((state.modelColor || {}).text) === "false";
				return h(
					SettingsForm,
					{ labels: labels, state: state, onSave: props.save, onDiscard: props.discard },
					h(SettingsValueField, {
						id: "trailLength",
						label: t("trail"),
						hint: t("trailHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalid"),
						numeric: true,
						disabled: disabled,
						...state.trailLength,
						onEdit: (text) => props.edit("trailLength", text),
						onReset: () => props.resetField("trailLength"),
					}),
					h(SettingsValueField, {
						id: "thickness",
						label: t("thickness"),
						hint: t("thicknessHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalid"),
						numeric: true,
						disabled: disabled,
						...state.thickness,
						onEdit: (text) => props.edit("thickness", text),
						onReset: () => props.resetField("thickness"),
					}),
					h(SettingsValueField, {
						id: "sweep",
						label: t("sweep"),
						hint: t("sweepHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalid"),
						numeric: true,
						disabled: disabled,
						...state.sweep,
						onEdit: (text) => props.edit("sweep", text),
						onReset: () => props.resetField("sweep"),
					}),
					h(SettingsValueField, {
						id: "speed",
						label: t("speed"),
						hint: t("speedHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalid"),
						numeric: true,
						disabled: disabled,
						...state.speed,
						onEdit: (text) => props.edit("speed", text),
						onReset: () => props.resetField("speed"),
					}),
					boolRow("modelColor", t("modelColor")),
					modelColorOff ? selectRow("theme", t("theme")) : null,
					selectRow("unknownTheme", t("unknownTheme")),
					boolRow("edgeGlow", t("edgeGlow"))
				);
			}

			function RimlightMarquee(props) {
				// Bands are owned by conversations, so the live set has to be a list
				// of ids rather than a number: the exit animation needs to know
				// *which* conversation stopped, and where its row is on screen.
				const statusRunningRaw = props.useSessionStatus
					? String(props.useSessionStatus(selectRunningStatus) || "")
					: "";

				// A turn that is waiting on the user runs the loop the other way, so
				// "needs your input" is legible from the spin alone.
				let replyCount = 0;
				if (props.useSessionStatus) {
					try {
						const n = props.useSessionStatus(replyCountActive);
						if (Number.isFinite(n)) replyCount = Math.max(replyCount, n);
					} catch (e) { /* noop */ }
				}
				if (props.useSessions) {
					try {
						const n = props.useSessions(replyCountSessions);
						if (Number.isFinite(n)) replyCount = Math.max(replyCount, n);
					} catch (e) { /* noop */ }
				}
				// +s runs counter-clockwise around the frame (bottom to the right, right edge
				// upwards); thinking travels clockwise, so it walks -s. Waiting for a
				// reply reverses that.
				const direction = replyCount > 0 ? 1 : -1;

				const useForm = props.useMarqueeForm;
				const trailCfg = useForm ? useForm(selectTrail) : null;
				const thicknessCfg = useForm ? useForm(selectThickness) : null;
				const speedCfg = useForm ? useForm(selectSpeed) : null;
				const sweepCfg = useForm ? useForm(selectSweep) : null;
				const edgeGlowCfg = useForm ? useForm(selectEdgeGlow) : null;
				const modelColorCfg = useForm ? useForm(selectModelColor) : null;
				const themeCfg = useForm ? useForm(selectTheme) : null;
				const unknownThemeCfg = useForm ? useForm(selectUnknownTheme) : null;
				const trail = clampNumber(trailCfg, TRAIL_MIN, TRAIL_MAX, DEFAULT_TRAIL);
				const thickness = clampNumber(thicknessCfg, THICKNESS_MIN, THICKNESS_MAX, DEFAULT_THICKNESS);
				const speedMul = clampNumber(speedCfg, SPEED_MIN, SPEED_MAX, DEFAULT_SPEED);
				// Live setting: the frame loop eases towards this, so changing it never
				// snaps a band to a new position.
				setSweepAmp(clampNumber(sweepCfg, SWEEP_MIN, SWEEP_MAX, DEFAULT_SWEEP));
				const edgeGlow = edgeGlowCfg === null || edgeGlowCfg === void 0 ? true : edgeGlowCfg === true;
				const modelColor = modelColorCfg === null || modelColorCfg === void 0 ? true : modelColorCfg === true;
				// When automatic colouring is off the whole plugin uses one palette the
				// user picked; "unknownTheme" is the fallback for models we cannot name.
				const unknownKey = unknownThemeCfg == null || String(unknownThemeCfg).trim() === "" ? "prism" : String(unknownThemeCfg).trim();
				const manualTheme = themeByKey(themeCfg) || THEMES.deepseek;

				// Model identity, in order of authority:
				//   1. the sessions store's `modelSelection` projection (model id,
				//      never the API provider) - authoritative, works for sessions
				//      that are not on screen;
				//   2. the composer chip scraped from the DOM (fallback for hosts
				//      that do not project it);
				//   3. the palette's own default.
				const liveRaw = props.useSessions ? props.useSessions(selectLiveModels) : "";
				const liveRows = parseLiveModels(liveRaw);
				const modelInfo = useModelInfo();
				// Which conversation should decide the palette: the only one that is
				// thinking, else the one on screen. A single thinking session is the
				// normal case, and the band the user is looking at is its band.
				let runningRows = [];
				let currentRow = null;
				for (let i = 0; i < liveRows.length; i++) {
					const row = liveRows[i];
					if (row.running) {
						runningRows.push(row);
						if (!currentRow && row.current) currentRow = row;
					}
				}
				if (runningRows.length === 1) currentRow = runningRows[0];
				if (!currentRow || (!currentRow.modelId && !currentRow.providerId)) {
					for (let i = 0; i < liveRows.length; i++) {
						const row = liveRows[i];
						if (row.current && (row.modelId || row.providerId)) {
							currentRow = row;
							break;
						}
					}
				}
				const mergedModel = {
					modelId: (currentRow && currentRow.modelId) || modelInfo.modelId || "",
					modelName: "",
					domText: modelInfo.domText || "",
					providerId: (currentRow && currentRow.providerId) || modelInfo.providerId || "",
				};
				const theme = modelColor ? themeForModel(mergedModel, unknownKey) : manualTheme;

				// One band per thinking conversation, in a stable order, so band i
				// and its ghost always name the same session.
				const runningIds = [];
				(function () {
					const seen = {};
					const add = (id) => {
						const key = String(id || "");
						if (!key || seen[key]) return;
						seen[key] = true;
						runningIds.push(key);
					};
					for (let i = 0; i < liveRows.length; i++) {
						if (liveRows[i].running) add(liveRows[i].id);
					}
					const fromStatus = statusRunningRaw.split("|");
					for (let i = 0; i < fromStatus.length; i++) add(fromStatus[i]);
					runningIds.sort();
				})();
				const liveCount = runningIds.length;
				const [stream, setStream] = useState(null);
				// TEMP probe: what does the last flow item look like while writing?
				const [sprobe, setSprobe] = useState("");
				const streamRef = useRef({ len: -1, growAt: 0 });
				const testT0Ref = useRef(0);
				const visibleMain = liveCount > 0;
				// The streaming answer keeps the field alive even when the run has
				// already flipped to idle between steps: the orbit needs a band.
				const visible = visibleMain || stream !== null;
				const count = Math.max(1, Math.min(MAX_COMETS, liveCount || 1));
				// Every band gets the palette of its own conversation: two tasks on
				// different models must not share one colour.
				const bandThemes = [];
				for (let i = 0; i < count; i++) {
					const id = runningIds[i];
					let bt = theme;
					for (let k = 0; k < liveRows.length; k++) {
						const row = liveRows[k];
						if (!row || row.id !== id) continue;
						const own = modelColor
							? themeForModel({ modelId: row.modelId || "", modelName: "", domText: "", providerId: row.providerId || "" }, unknownKey)
							: manualTheme;
						bt = own;
						break;
					}
					bandThemes.push(bt);
				}
				const runningKey = runningIds.join("|");
				// Which band belongs to the conversation on screen: that one is the
				// one that leaves the edge and circles a streaming answer.
				const currentKey = currentRow ? currentRow.id : null;
				// The band that owns the ring is locked while a stream lasts. Deriving
				// it from the running order every render would hand the ring to a
				// different band mid-flight whenever the order shifted, and two bands
				// leaving the frame at once is what looked like the logic breaking down.
				const ownerRef = useRef(-1);
				let orbitIdx = -1;
				if (stream) {
					if (ownerRef.current < 0 || ownerRef.current >= runningIds.length) {
						const idx = currentKey ? runningIds.indexOf(currentKey) : -1;
						ownerRef.current = idx >= 0 ? idx : 0;
					}
					orbitIdx = ownerRef.current;
				} else {
					ownerRef.current = -1;
				}

				// The ring must follow the box this overlay actually occupies rather
				// than the viewport: a shell ancestor can establish a containing
				// block for `position: fixed`, and a track sized from
				// `window.innerWidth` would then push the right/bottom edges outside
				// the overlay and the comet would vanish mid-lap.
				const rootRef = useRef(null);
				const [box, setBox] = useState(null);

				// Exit animation: the head positions the live field published, the
				// running set as of the last render (so a stop can be diffed), and
				// the ghosts currently flying home.
				const headsRef = useRef({});
				const liveSessionsRef = useRef(new Map());
				const [ghosts, setGhosts] = useState([]);
				const currentIdRef = useRef(null);
				currentIdRef.current = currentRow ? currentRow.id : null;
				const launchRef = useRef({ x: 0, y: 0 });

				// Temporary diagnostic: report what the overlay actually put in the
				// DOM, so a band that "should" be visible but is not can be traced
				// to geometry, paint or a duplicated mask reference.
				const [probe, setProbe] = useState("");
				useEffect(() => {
					if (!DEBUG) return;
					let spdPrev = { pos: null, t: 0 };
					let spdTxt = "-";
					const id = setInterval(() => {
						try {
							const root = rootRef.current;
							if (!root) { setProbe("no root"); return; }
							const svg = root.querySelector("svg");
							const rb = svg ? svg.querySelector('[data-r="ribbon"]') : null;
							const heads = svg ? svg.querySelectorAll('[data-r="head"]') : [];
							const head = heads.length ? heads[0] : null;
							const srect = svg ? svg.getBoundingClientRect() : null;
							let bb = null;
							let rbb = null;
							try { bb = svg && svg.getBBox ? svg.getBBox() : null; } catch (e) { bb = null; }
							try { rbb = rb && rb.getBBox ? rb.getBBox() : null; } catch (e) { rbb = null; }
							const cs = svg ? getComputedStyle(svg) : null;
							const rcs = rb ? getComputedStyle(rb) : null;
							const box2 = (b) => (b ? [b.x, b.y, b.width, b.height].map((v) => Math.round(v)).join(",") : "-");
							(function () {
								try {
									const nowT = (typeof performance !== "undefined" ? performance.now() : Date.now());
									const h0 = heads.length ? { x: +heads[0].getAttribute("cx"), y: +heads[0].getAttribute("cy") } : null;
									if (h0 && spdPrev.pos && nowT > spdPrev.t + 1) {
										const dd = Math.sqrt((h0.x - spdPrev.pos.x) * (h0.x - spdPrev.pos.x) + (h0.y - spdPrev.pos.y) * (h0.y - spdPrev.pos.y));
										spdTxt = (dd / (nowT - spdPrev.t)).toFixed(2) + "px/ms";
									}
									spdPrev = { pos: h0, t: nowT };
								} catch (e) { spdTxt = "err"; }
							})();
							setProbe(
								"roots " + document.querySelectorAll(".dsh-marquee-root").length +
								" svgpx " + (srect ? Math.round(srect.width) + "x" + Math.round(srect.height) : "-") +
								"\nsvgbbox " + box2(bb) + " paths " + (svg ? svg.querySelectorAll("path").length : 0) +
								"\nribbon d=" + (rb ? (rb.getAttribute("d") || "").length : "-") + " bb " + box2(rbb) +
								"\nheads " + Array.prototype.map.call(heads, function (n) { return n.getAttribute("cx") + "," + n.getAttribute("cy"); }).join(" | ") +
								"\nsvg " + (cs ? cs.opacity + " " + cs.display + " " + cs.visibility : "-") +
								"\nribfill " + (rcs ? rcs.fill + " op" + rcs.opacity + " " + rcs.display : "-") +
								"\nribfill " + (rcs ? rcs.fill + " op" + rcs.opacity + " " + rcs.display : "-") +
								"\ncomet " + (function(){ try { const cg = svg.querySelector(".dsh-marquee-comet"); if (!cg) return "none"; const c = getComputedStyle(cg); const hp = document.elementFromPoint(Math.round(srect.left+3), Math.round(srect.top+300)); return "op" + c.opacity + " " + c.display + " " + c.visibility + " an" + c.animationName + "/" + c.animationDuration + " top" + (hp ? (hp.className||hp.tagName) : "-"); } catch(e){ return "err"; } })() +
								"\nb0 " + (DIAG.b0 || "-") +
								"\nspd " + spdTxt + " dt " + (DIAG.dt === void 0 ? "-" : DIAG.dt.toFixed(1)) + " lap " + (DIAG.lap || "-") +
								"\nframe " + DIAG.frames + " err " + (DIAG.err || "-") +
								"\ndom " + (function () {
									try {
										const d = scanComposerModel();
										if (!d) return "none";
										return (d.modelId || "-") + "/" + (d.modelName || "-");
									} catch (e) { return "err"; }
								})()
							);
						} catch (e) {
							setProbe("probe error " + e);
						}
					}, 900);
					return () => clearInterval(id);
				}, []);

				useEffect(() => {
					const node = rootRef.current;
					if (!node) return;
					let alive = true;
					function measure() {
						if (!alive) return;
						let r = null;
						try { r = node.getBoundingClientRect(); } catch (e) { r = null; }
						if (!r || !(r.width > 8) || !(r.height > 8)) return;
						setBox((prev) => {
							if (prev &&
								Math.abs(prev.left - r.left) < 0.5 &&
								Math.abs(prev.top - r.top) < 0.5 &&
								Math.abs(prev.width - r.width) < 0.5 &&
								Math.abs(prev.height - r.height) < 0.5) return prev;
							return { left: r.left, top: r.top, width: r.width, height: r.height };
						});
					}
					measure();
					let ro = null;
					try {
						if (typeof ResizeObserver === "function") {
							ro = new ResizeObserver(measure);
							ro.observe(node);
						}
					} catch (e) { ro = null; }
					window.addEventListener("resize", measure);
					return () => {
						alive = false;
						if (ro) { try { ro.disconnect(); } catch (e) { /* noop */ } }
						window.removeEventListener("resize", measure);
					};
				}, []);

				// A band that stops is not simply removed: it flies home, circles the
				// conversation it belonged to and fades. Diffing the running set says
				// which conversation just stopped, and the live heads say where the
				// band was at that moment - which is where the ghost starts.
				useEffect(() => {
					const next = new Map();
					for (let i = 0; i < runningIds.length; i++) {
						const id = runningIds[i];
						let row = null;
						for (let k = 0; k < liveRows.length; k++) {
							if (liveRows[k].id === id) { row = liveRows[k]; break; }
						}
						const palette = modelColor
							? themeForModel({
								modelId: row ? row.modelId : "",
								modelName: "",
								domText: "",
								providerId: row ? row.providerId : "",
							}, unknownKey)
							: manualTheme;
						next.set(id, { index: i, theme: palette });
					}
					const prev = liveSessionsRef.current;
					const fresh = [];
					prev.forEach((info, id) => {
						if (next.has(id)) return;
						const isCurrent = currentIdRef.current != null && id === currentIdRef.current;
						const spunRecently = spunAtRef.current > 0 && nowMs() - spunAtRef.current < 5000;
						const wasOrbiting = orbitSeenRef.current > 0 && nowMs() - orbitSeenRef.current < 2500;
						// The current conversation does not fly home when its answer is
						// complete: it spun out around the block it was circling. A
						// manual stop still returns it to the composer.
						if (isCurrent && (spunRecently || (wasOrbiting && !manualStopRecently()))) {
							if (!spunRecently) {
								spunAtRef.current = nowMs();
								setStream(null);
								setHold(true);
								if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
								holdTimerRef.current = setTimeout(() => setHold(false), SPIN_MS + 260);
							}
							return;
						}
						let ring = null;
						try { ring = returnRing(id, currentIdRef.current); } catch (e) { ring = null; }
						if (!ring) return;
						try {
							const head = headsRef.current[info.index];
							const from = head && isFinite(head.x) && isFinite(head.y)
								? { x: head.x, y: head.y }
								: { x: launchRef.current.x, y: launchRef.current.y };
							// The speed profile is 1 - A*cos(2*pi*p), so its slope (the
							// acceleration) peaks a quarter of a lap away from a corner. Wait for
							// the next of those peaks and let go at exactly that speed: the flight
							// starts already carrying the motion of the edge, and nothing clamps
							// it in the air afterwards.
							const phase = head && isFinite(head.phase) ? head.phase : 0;
							// `dirTargetRef` lives inside CometField; the parent already holds
							// the same decision in `direction` (reply pending => -1), and reading
							// that ref here threw a ReferenceError the moment a session stopped.
							const dirSign = direction < 0 ? -1 : 1;
							let pick = null;
							for (let k = 0; k < 2; k++) {
								const quarter = k === 0 ? 0.25 : 0.75;
								const ahead = (((quarter - phase) * dirSign) % 1 + 1) % 1;
								if (!pick || ahead < pick.ahead) pick = { ahead: ahead, quarter: quarter };
							}
							const waitMs = GHOST_LEAD_MS + (pick ? pick.ahead * lapMs : 0);
							const bandSpeed = perimeter / Math.max(1, lapMs);
							const exitSpeed = Math.max(0.2, bandSpeed * (1 - SWEEP_AMP * Math.cos(2 * Math.PI * (pick ? pick.quarter : 0))));
							fresh.push({
								id: id + ":" + Date.now(),
								theme: info.theme,
								from: from,
								target: ring,
								at: nowMs() + waitMs,
								speed: exitSpeed,
							});
						} catch (error) {
							// A ghost is cosmetic; the bands are not. Never let a bad
							// geometry (or a missing binding) tear down the overlay.
							try { console.warn("[rimlight] ghost skipped:", error); } catch (ignored) {}
						}
					});
					liveSessionsRef.current = next;
					if (fresh.length) setGhosts((list) => list.concat(fresh).slice(-6));
				}, [runningKey]);

				// Where the ring unfolds from: the composer's send button when it can
				// be located, otherwise an estimate of the composer's bottom-right.
				const [origin, setOrigin] = useState(null);
				useEffect(() => {
					if (!visible) return;
					let o = null;
					try { o = senderOrigin(); } catch (e) { o = null; }
					if (o) setOrigin(o);
				}, [visible]);

				// The model seat is single-occupancy and already taken, so the composer is
				// polled instead — only while the marquee is actually on screen.
				useEffect(() => {
					if (!visible) return;
					const tick = () => {
						try {
							const found = scanComposerModel();
							if (found) publishModel(found);
						} catch (e) { /* noop */ }
					};
					tick();
					const id = setInterval(tick, 1500);
					return () => clearInterval(id);
				}, [visible]);

				// The answer block is watched while a turn runs: once its text starts
				// growing, the current conversation's band leaves the frame edge and
				// circles the block until the growth stops.
				const orbitSeenRef = useRef(0);
				const spunAtRef = useRef(0);
				// Task switch: the ring measured in the previous conversation is gone the
				// moment another one is displayed, so no band may still fly towards it.
				useEffect(() => {
					streamRef.current = { len: -1, growAt: 0, hits: 0, row: null };
					setStream(null);
				}, [currentKey]);
				// Keeps the field alive for the spin-out after the last turn ended.
				const [hold, setHold] = useState(false);
				const holdTimerRef = useRef(0);

				useEffect(() => {
					if (!visibleMain) return;
					let alive = true;
					function tick() {
						if (!alive) return;
						try {
							const blk = answerBlock();
							// Deterministic preview of the orbit: fabricate a growing answer
							// for the first few seconds after the overlay mounts.
							if (DEBUG_TEST && blk) {
								const tt = nowMs();
								if (!testT0Ref.current) testT0Ref.current = tt;
								const dt = tt - testT0Ref.current;
								if (dt < 2600) {
									orbitSeenRef.current = tt;
									setStream(rectToRing(blk.rect, 14));
									return;
								}
								if (dt < 3800) {
									setStream(null);
									setHold(true);
									return;
								}
								setHold(false);
							}
							if (DEBUG) {
								const items = document.querySelectorAll('[class*="flowItem"]');
								const last = items.length ? items[items.length - 1] : null;
								let sig = "last=- ";
								if (last) {
									const kids = [];
									for (let i = 0; i < last.children.length && i < 3; i += 1) {
										const k = last.children[i];
										kids.push(String(k.className || k.tagName || "?").slice(0, 20));
									}
									const md = last.querySelector('[class*="_markdown_"]');
									const body = last.querySelector('[class*="v5IAXa_body"]');
									sig = "last=" + kids.join(",") + " md=" + (md ? "y" : "n") + " body=" + (body ? "y" : "n") +
										" len=" + (last.textContent ? last.textContent.length : -1) +
										" plen=" + proseLength(last) + " ";
								}
								setSprobe("rows=" + items.length + " " + sig +
									(blk ? "blk=" + blk.kind + " plen2=" + blk.len + " hits=" + (streamRef.current.hits || 0) : "blk=-"));
							}
				if (!blk || blk.kind !== "answer") { streamRef.current.len = -1; streamRef.current.growAt = 0; streamRef.current.hits = 0; streamRef.current.row = null; setStream(null); return; }
				const st = streamRef.current;
				const t = nowMs();
				// Strict rule: the growth is measured on one answer block. A
				// different row (task switch, new turn) restarts the measurement
				// instead of inheriting the previous streak.
				if (st.row && st.row !== blk.row) { st.len = -1; st.growAt = 0; st.hits = 0; }
				st.row = blk.row;
				if (blk.len !== st.len) {
					st.len = blk.len;
					st.growAt = t;
					st.hits = 1;
				} else if (st.growAt > 0) {
					st.hits = (st.hits || 0) + 1;
				}
				// Three growing polls inside 1.2s (~540ms of steady prose) and a
				// classified answer body: a stray token, a tool result or a
				// half-finished thought never qualifies.
				const growing = st.growAt > 0 && t - st.growAt < 1200 && (st.hits || 0) >= 3 && blk.len > 40;
				if (!growing) { setStream(null); return; }
							const ring = rectToRing(blk.rect, 14);
							orbitSeenRef.current = t;
							setStream((prev) => {
								if (prev && Math.abs(prev.cx - ring.cx) < 1 && Math.abs(prev.cy - ring.cy) < 1 &&
									Math.abs(prev.rx - ring.rx) < 1 && Math.abs(prev.ry - ring.ry) < 1) return prev;
								return ring;
							});
						} catch (e) { /* noop */ }
					}
					tick();
					const id = setInterval(tick, 180);
					return () => { alive = false; clearInterval(id); };
				}, [visibleMain]);

				useEffect(() => {
					if (!visible) return;
					function onDown(ev) {
						try {
							const tgt = ev.target;
							const btn = tgt && tgt.closest ? tgt.closest('button[aria-label], [role="button"][aria-label]') : null;
							if (!btn) return;
							const label = String(btn.getAttribute("aria-label") || "").toLowerCase();
							if (label.indexOf("stop") >= 0 || label.indexOf("interrupt") >= 0 ||
								label.indexOf("cancel") >= 0 || label.indexOf("\u505c\u6b62") >= 0 ||
								label.indexOf("\u4e2d\u6b62") >= 0 || label.indexOf("\u53d6\u6d88") >= 0) {
								lastStopAt = nowMs();
							}
						} catch (e) { /* noop */ }
					}
					document.addEventListener("pointerdown", onDown, true);
					return () => { document.removeEventListener("pointerdown", onDown, true); };
				}, [visible]);

				// While ghosts are still flying home the overlay has to stay on screen and
				// unfolded, even though nothing is running any more.
				const anyShowing = visible || hold || ghosts.length > 0;

				// Circle reveal out of the send button, driven frame by frame: a CSS
				// clip-path transition was getting dropped by the webview, which is
				// why the pop-out looked like it never happened.
				const [reveal, setReveal] = useState(0);
				const revealRef = useRef({ value: 0, target: 0, raf: 0 });
				useEffect(() => {
					const state = revealRef.current;
					state.target = anyShowing ? 1 : 0;
					if (state.raf) return;
					let last = 0;
					function tick(now) {
						const s = revealRef.current;
						if (!last) last = now;
						const dt = Math.min(64, Math.max(8, now - last));
						last = now;
						// Critically-damped approach: a fixed fraction per frame gives
						// the fast-then-slow curve without a spring overshoot.
						const k = 1 - Math.pow(0.06, dt / REVEAL_MS);
						s.value += (s.target - s.value) * Math.max(0.02, Math.min(0.6, k));
						if (Math.abs(s.target - s.value) < 0.004) {
							s.value = s.target;
							s.raf = 0;
							setReveal(s.value);
							return;
						}
						setReveal(s.value);
						s.raf = requestAnimationFrame(tick);
					}
					last = 0;
					state.raf = requestAnimationFrame(tick);
				}, [anyShowing]);


				const fallbackW = typeof window !== "undefined" ? window.innerWidth : 1200;
				const fallbackH = typeof window !== "undefined" ? window.innerHeight : 800;
				const boxLeft = box ? box.left : 0;
				const boxTop = box ? box.top : 0;
				const boxW = box ? box.width : fallbackW;
				const boxH = box ? box.height : fallbackH;

				// viewport coords -> overlay-local coords (the SVG is inset:0 in it)
				const oxV = Math.round(origin ? origin.x : fallbackW * 0.72);
				const oyV = Math.round(origin ? origin.y : fallbackH * 0.955);
				const ox = Math.round(oxV - boxLeft);
				const oy = Math.round(oyV - boxTop);
				launchRef.current = { x: ox, y: oy };
				const radius = Math.round(Math.hypot(boxW, boxH) * 1.2) + 4;
				const revealR = Math.max(0, Math.round(radius * reveal * 1.02));

				const perimeter = 2 * (boxW + boxH) - 8 * thickness;
				// The lap keeps the speed this plugin has always had: one trip around
				// the frame in ~0.95x its perimeter in milliseconds. Timings for the
				// off-track moves are derived from the band's own local ring speed
				// (TRANSIT_REL), so a faster lap scales those up with it instead of
				// being throttled by an absolute ceiling.
				const lapMs = Math.max(1600, Math.min(13000, (perimeter * 0.95) / Math.max(SPEED_MIN, speedMul)));

				const clip = "circle(" + revealR + "px at " + ox + "px " + oy + "px)";
				const style = {
					"--dsh-marquee-alpha": String(ALPHA),
					"--dsh-marquee-pulse": PULSE_MS + "ms",
					clipPath: clip,
					WebkitClipPath: clip,
					opacity: anyShowing || reveal > 0.001 ? Math.max(anyShowing ? 1 : 0, Math.min(1, reveal)) : 0,
					transition: "opacity 200ms ease",
				};

				const debug = DEBUG ? h("div", {
					style: {
						position: "absolute",
						left: "50%",
						top: "50%",
						transform: "translate(-50%, -50%)",
						font: "11px ui-monospace, monospace",
						color: "#9dc6ff",
						background: "rgba(0,0,0,0.75)",
						padding: "3px 6px",
						borderRadius: "3px",
						whiteSpace: "pre",
					},
				}, "win " + fallbackW + "x" + fallbackH +
					"  box L" + Math.round(boxLeft) + " T" + Math.round(boxTop) +
					" " + Math.round(boxW) + "x" + Math.round(boxH) +
					"  t=" + thickness + " trail=" + trail +
					"  n=" + liveCount + " reveal=" + reveal.toFixed(2) +
					"  dir=" + (direction > 0 ? "cw" : "ccw") + " reply=" + replyCount +
					"  glow=" + edgeGlow + " modelColor=" + modelColor +
					"  band=" + bandThemes.map(function (t) { return t.key; }).join(",") +
					"\ntheme=" + theme.key + "  provider=" + (mergedModel.providerId || "-") +
					"  model=" + (mergedModel.modelId || "-") +
					"  src=" + (currentRow ? "proj" : "dom") +
					"  sessions=" + liveRows.length +
					"  ghosts=" + ghosts.length +
					"  stream=" + (stream ? Math.round(stream.cx) + "," + Math.round(stream.cy) + " r" + Math.round(stream.rx) + "x" + Math.round(stream.ry) : "-") +
					"  orbit=" + orbitIdx + " hold=" + hold +
					"\n" + sprobe + "\n" + probe
				) : null;

				return h(
					React.Fragment,
					null,
					h("style", { dangerouslySetInnerHTML: { __html: CSS } }),
					h("div", { ref: rootRef, className: "dsh-marquee-root", style: style },
						h(CometField, {
							width: boxW,
							height: boxH,
							trail: trail,
							thickness: thickness,
							lapMs: lapMs,
							startX: ox,
							origin: { x: ox, y: oy },
							count: count,
							theme: theme,
							themes: bandThemes,
							edgeGlow: edgeGlow,
							direction: direction,
							active: visible || hold,
							headsSink: headsRef,
							orbit: stream,
							orbitIndex: orbitIdx,
						}),
						// Drawn above the live field: the ghosts are the last thing
						// the user sees of a finished turn.
						h(GhostField, {
							width: boxW,
							height: boxH,
							ghosts: ghosts,
							thickness: thickness,
							trail: trail,
							speed: Math.max(0.2, (2 * (boxW + boxH)) / Math.max(1, lapMs)),
							maskUrl: MASK_ID,
							onDone: (ids) => {
								setGhosts((list) => list.filter((g) => ids.indexOf(g.id) === -1));
							},
						}),
						debug
					)
				);
			}

			function apply(ctx) {
				let formStore = constantStore(null);
				// The settings panel is bilingual: keep the locale service and
				// register both dictionaries so switching the client language
				// repaints the form without a reload.
				try {
					const locale = typeof ctx.get === "function" ? ctx.get("locale") : ctx.locale;
					if (locale && typeof locale.getSnapshot === "function") {
						localeService = locale;
						try { localeService.register(NS, "zh-CN", UI_TEXT.zh); } catch (e) { /* already registered */ }
						try { localeService.register(NS, "en-US", UI_TEXT.en); } catch (e) { /* already registered */ }
					}
				} catch (e) {
					localeService = null;
				}

				let form = null;
				try {
					const scope = ctx.configForms.get("rimlight");
					if (scope && SettingsFormModel) {
						form = new SettingsFormModel(scope, [
							settingsNumberField("trailLength"),
							settingsNumberField("thickness"),
							settingsNumberField("speed"),
				settingsNumberField("sweep"),
							settingsBooleanField("edgeGlow"),
							settingsBooleanField("modelColor"),
							settingsText("theme"),
							settingsText("unknownTheme"),
						]);
						formStore = form.bind(() => ({
							...form.shell(),
							trailLength: form.field("trailLength"),
							thickness: form.field("thickness"),
							speed: form.field("speed"),
							sweep: form.field("sweep"),
							edgeGlow: form.field("edgeGlow"),
							modelColor: form.field("modelColor"),
							theme: form.field("theme"),
							unknownTheme: form.field("unknownTheme"),
						}));
						if (typeof ctx.effect === "function") {
							ctx.effect(() => () => { try { form.dispose(); } catch (e) { /* noop */ } });
						}
					}
				} catch (e) {
					form = null;
					formStore = constantStore(null);
					console.error("[rimlight] settings form unavailable", e);
				}

				try {
					ctx.slots.inject("shell.overlay", () =>
						ctx.slots.register(
							{
								name: "shell.overlay",
								id: "rimlight",
								order: 900,
								label: () => "Rimlight",
								locale: NS,
								inject: () => ({
									hooks: {
										marqueeForm: formStore,
									},
								}),
							},
							RimlightMarquee
						)
					);
				} catch (e) {
					console.error("[rimlight] overlay registration failed", e);
				}

				if (form) {
					try {
						ctx.slots.inject("plugins.bundle.config", () =>
							ctx.slots.register(
								{
									name: "plugins.bundle.config",
									key: "dsh-rimlight",
									locale: NS,
									inject: () => ({
										hooks: {
											marqueeForm: formStore,
										},
										...form.actions(),
									}),
								},
								MarqueeSettings
							)
						);
					} catch (e) {
						console.error("[rimlight] settings registration failed", e);
					}
				}
			}

			const inject = ["slots", "locale", "configForms"];

			exports.apply = apply;
			exports.inject = inject;
			// Pure geometry helpers, exposed for offline verification only.
			exports.__debug = {
				UI_TEXT: UI_TEXT,
				pickUiLang: pickUiLang,
				uiT: uiT,
				MarqueeSettings: MarqueeSettings,
				useLocaleService: function (svc) { localeService = svc || null; },
				// Sweep amplitude: the setting only moves the target, the running value
				// is eased per frame, so both are exported for the offline checks.
				getSweepAmp: () => SWEEP_AMP, getSweepTarget: () => SWEEP_TARGET,
				setSweepAmp: setSweepAmp, stepSweepAmp: stepSweepAmp, sweepSpeed: sweepSpeed,
				DEFAULT_SWEEP: DEFAULT_SWEEP, SWEEP_MAX: SWEEP_MAX, SWEEP_MIN: SWEEP_MIN,
								chooseOffset: chooseOffset,
				widestGapCandidates: widestGapCandidates,
buildTrack: buildTrack,
				sweep: sweep,
				setSweepAmp: setSweepAmp,
				getSweepAmp: function () { return SWEEP_AMP; },
				sweepInv: sweepInv,
				sweepSpeed: sweepSpeed,
				ringSpeedAt: ringSpeedAt,
				TRANSIT_REL: TRANSIT_REL,
				transitCap: transitCap,
				ribbonPath: ribbonPath,
				taper: taper,
				themeForModel: themeForModel,
				THEMES: THEMES,
				flightPath: flightPath,
				polyRibbon: polyRibbon,
			throwPath: throwPath, redressTail: redressTail,
			ribbonPoints: ribbonPoints,
			TRANSIT_CAP: TRANSIT_CAP,
			wrapArc: wrapArc,
			catchPlan: catchPlan,
			stepOrbit: stepOrbit,
				easeInOutCubic: easeInOutCubic,
				FLY_MS: FLY_MS,
				FLY_MAX_MS: FLY_MAX_MS,
				entryGrab: entryGrab,
				catchPlan: catchPlan,
				returnPath: returnPath,
				returnRing: returnRing,
				ellipsePerimeter: ellipsePerimeter, fitRing: fitRing,
				easeOutCubic: easeOutCubic,
				stepOrbit: stepOrbit,
				ringTable: ringTable,
				nearestAngle: nearestAngle,
				ringPoint: ringPoint,
				arcSpan: arcSpan,
				themeKeyForText: themeKeyForText,
				rectToRing: rectToRing,
				MASK_ID: MASK_ID,
				CHROME_W: CHROME_W,
				CHROME_H: CHROME_H,
				CHROME_FEATHER: CHROME_FEATHER,
							wrapCenter: wrapCenter,
};
		} catch (err) {
			// Degrade to an inert plugin instead of taking the client boot down.
			console.error("[rimlight] init failed", err);
			exports.apply = function () {};
			exports.inject = [];
		}

		return module.exports;
	} });
