// Marquee Lab — drives the real geometry out of client.js.
//
// The plugin itself only runs inside DSH, and the animation it draws is hard to
// trigger on demand there (it needs a turn that actually streams an answer).
// This page imports the very same buildTrack / sweep / ribbonPath / stepOrbit /
// returnPath code through the module loader shim in rimlight-lab.html, draws it
// over a mock window, and lets every stage of the animation be fired from the
// panel: entry throw, edge lap, orbit around the answer, spin-out, manual stop
// and the return ghost.
(function () {
	"use strict";

	var M = window.__MARQUEE__ && window.__MARQUEE__.__debug;
	var out = document.getElementById("readout");
	// Any stray throw (a click handler, a rebuild) has to be visible, otherwise a
	// headless screenshot just shows a blank stage and says nothing.
	window.addEventListener("error", function (ev) {
		try { out.textContent = "error: " + ev.message + " @line " + (ev.lineno || "?"); } catch (e) {}
	});
	if (!M) {
		out.textContent = "client.js 加载失败：\n" + (window.__MARQUEE_ERR__ || "unknown");
		return;
	}

	var frame = document.getElementById("frame");
	var overlay = document.getElementById("overlay");
	var send = document.getElementById("send");
	var answer = document.getElementById("answer");

	var SVGNS = "http://www.w3.org/2000/svg";
	function el(name, attrs) {
		var n = document.createElementNS(SVGNS, name);
		if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
		return n;
	}

	// ---------------------------------------------------------------- scene
	var svg = el("svg", { width: "100%", height: "100%", style: "position:absolute;inset:0" });
	var defs = el("defs");
	var mask = el("mask", { id: M.MASK_ID, maskUnits: "userSpaceOnUse", x: "0", y: "0", maskContentUnits: "userSpaceOnUse" });
	svg.appendChild(defs);
	overlay.appendChild(svg);

	var ghostSvg = el("svg", { width: "100%", height: "100%", style: "position:absolute;inset:0" });
	overlay.appendChild(ghostSvg);
	// One persistent host for return-ghosts: it must survive buildBands(), so a
	// ghost is never detached from the document while flying.
	var ghostHost = el("g", {});
	ghostSvg.appendChild(ghostHost);

	var cornerOverride = null;
	var W = 0;
	var H = 0;
	var track = null;
	var lapMs = 4200;
	var labSpeed = 1.6;
	var lastPerimeter = 0;
	function styleProbe() {
		try {
			var out = [];
			var panel = document.getElementById("panel");
			var frame = document.getElementById("frame");
			var btn = document.getElementById("btn-think");
			var ro = document.getElementById("readout");
			var cs = function (el) { return el ? getComputedStyle(el) : null; };
			var p1 = cs(panel), p2 = cs(frame), p3 = cs(btn), p4 = cs(ro);
			out.push("panel.blur=" + (p1 ? (p1.backdropFilter || p1.webkitBackdropFilter || "none") : "?"));
			out.push("panel.bg=" + (p1 ? (p1.backgroundImage || "none").slice(0, 42) : "?"));
			out.push("frame.blur=" + (p2 ? (p2.backdropFilter || p2.webkitBackdropFilter || "none") : "?"));
			out.push("frame.radius=" + (p2 ? p2.borderRadius : "?"));
			out.push("btn.shadow=" + (p3 ? (p3.boxShadow || "none").slice(0, 34) : "?"));
			out.push("readout.bg=" + (p4 ? (p4.backgroundColor || "none") : "?"));
			return "css=" + out.join(" | ");
		} catch (e) { return "css=probe-failed:" + e; }
	}

	function recalcLap() {
		if (!lastPerimeter) return;
		lapMs = Math.max(1600, Math.min(13000, (lastPerimeter * 0.95) / labSpeed));
	}

	function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
	function easeOutCubic(u) { return 1 - Math.pow(1 - u, 3); }
	function easeInOutCubic(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }

	// ---------------------------------------------------------------- state
	var themeKeys = Object.keys(M.THEMES);
	var themeKey = "deepseek";
	var state = {
		mode: "idle",          // idle | thinking | streaming | done
		count: 1,
		trail: 320,
		thickness: 6,
		glow: true,
		birth: 0,
		answerGrowAt: 0,
		manualStop: false,
		p: 0,
		reply: false,          // waiting for the user -> the band turns back
		dirNow: -1,            // eased direction, never a hard flip (-1 = clockwise, like the plugin)
	};
	var orbit = { mode: "off" };
	var pendingGhost = 0;
	// Diagnostics: how many ghosts were spawned and where the first one is in
	// its hop. Without these the readout cannot tell "never spawned" from
	// "already finished".
	var ghostSpawns = 0;
	var bandNodes = [];
	var ghosts = [];
	// Entry animation state, mirroring the plugin: every band remembers when it
	// was born, where the send button is (its launch point), which point on the
	// track it grabbed and how it has to sprint to catch its slot.
	var births = [];
	var grabs = [];
	var lenState = [];
var settles = {};
	var catches = [];
	var phases = {};
			var masterPh = null;
	var offsets = {};
	var lastSend = { x: 0, y: 0 };
	// Release branch: a band is born on the bottom-left corner of the frame and
	// its tail grows from zero. `pending` holds the bands that have not appeared
	// yet, `shifts` closes the last few percent of a lap with a short slide.
	var pending = {};
	var lastLen = {};
	var waitDbg = {};
	var wantStyleCheck = false;
	var slotDbg = {};
	var headDbg = {};
	var shifts = {};
	var cornerPh = 0;
	var SPAWN_LEAD = 0.16;
	var SPAWN_MS = 260;
	var GROW_MS_LAB = 380;

	function theme() { return M.THEMES[themeKey] || M.THEMES.deepseek; }
	// "one band per task, each with its own colour": the lab can paint every band
	// from a different vendor palette, exactly like the plugin does per session.
	var bandOrder = ["deepseek", "kimi", "nvidia", "qwen"];
	var multi = false;
	function bandTheme(i) {
		if (!multi) return theme();
		return M.THEMES[bandOrder[i % bandOrder.length]] || theme();
	}

	function wrap1(v) { return ((v % 1) + 1) % 1; }
	function wrapCenter(v) { var w = wrap1(v); return w > 0.5 ? w - 1 : w; }
	function widestSeed(list) {
		if (!list.length) return 0;
		var sorted = list.slice().sort(function (a, b) { return a - b; });
		var bestAt = 0, bestGap = -1;
		for (var k = 0; k < sorted.length; k++) {
			var a = sorted[k], b = k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + 1;
			if (b - a > bestGap) { bestGap = b - a; bestAt = a + (b - a) / 2; }
		}
		return wrap1(bestAt);
	}

	function bornAll(atMs) {
		var n = clamp(state.count, 1, 4);
		births = [];
		grabs = [];
		catches = [];
		// Put the clock on the corner first: band 0 is the master, so it appears at
		// the corner at once instead of waiting up to a whole lap for its slot.
		if (cornerPh !== null && M.sweepInv) state.p = wrap1(M.sweepInv(cornerPh));
		pending = {};
		settles = {};
		// Seed each band on the slot it is going to own, so its settle gap starts
		// at zero and band 0 is already sitting on the corner this very frame.
		var wb0 = wrap1(M.sweep(wrap1(state.p)));
		for (var i = 0; i < n; i++) {
			births[i] = atMs;
			pending[i] = true;
			phases[i] = wrap1(wb0 + i / n);
		}
	}

	function bornOne(i) {
		var now = clock;
		while (births.length <= i) births.push(now);
		births[i] = now;
		pending[i] = true;
		delete shifts[i];
		delete grabs[i];
		delete catches[i];
	}

	// Wipe every band off the screen (no leftover stripe while idle).
	function blankBands() {
		for (var i = 0; i < bandNodes.length; i++) {
			var nd = bandNodes[i];
			if (nd.path) nd.path.setAttribute("d", "");
			if (nd.edge) nd.edge.setAttribute("d", "");
			if (nd.head) { nd.head.setAttribute("cx", "0"); nd.head.setAttribute("cy", "0"); }
			if (nd.glow) nd.glow.setAttribute("r", "0");
			if (nd.g) nd.g.style.opacity = "0";
		}
		grabs = [];
		catches = [];
		births = [];
		pending = {};
		shifts = {};
	}
	function half() { return Math.max(1, state.thickness / 2); }

	function buildScene() {
		var r = frame.getBoundingClientRect();
		W = Math.round(r.width);
		H = Math.round(r.height);
		svg.setAttribute("viewBox", "0 0 " + W + " " + H);
		ghostSvg.setAttribute("viewBox", "0 0 " + W + " " + H);
		var h = half();
		var sendRect = send.getBoundingClientRect();
		var startX = clamp(sendRect.left + sendRect.width / 2 - r.left, 40, W - 40);
		lastSend = { x: startX, y: H - h };
		// The mock window is drawn with a 22px corner, so the band has to turn
		// with that same corner instead of cutting across it.
		var rad = 0;
		try { rad = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0; } catch (e) { rad = 0; }
		if (cornerOverride !== null) rad = cornerOverride;
		track = M.buildTrack(W, H, h, startX, rad);
		var perimeter = 2 * (W + H) - 8 * h;
		// Same default the plugin ships: speed 1.6 (a lap is about 2.6s on a
		// 1065x1160 frame), which is also what nobody has to configure.
		lastPerimeter = perimeter;
		lapMs = Math.max(1600, Math.min(13000, (perimeter * 0.95) / labSpeed));
		// Phase of the bottom-left corner: that is where bands are born now.
		var cxL = h * 1.6, cyL = H - h * 1.6, bestPh = 0, bestCorner = Infinity;
		for (var ck = 0; ck < 720; ck++) {
			var phL = ck / 720;
			var ptL = track.at(track.offset + phL * track.total);
			var ddL = (ptL.x - cxL) * (ptL.x - cxL) + (ptL.y - cyL) * (ptL.y - cyL);
			if (ddL < bestCorner) { bestCorner = ddL; bestPh = phL; }
		}
		cornerPh = bestPh;
		buildDefs();
		buildBands();
		buildMask();
		if (!births.length) bornAll(clock);
	}

	function stopOffset(v) {
		// Theme stops already carry their own "0%"-style offset; the fallback
		// palettes use plain fractions. Accept both.
		if (typeof v === "string") return v.indexOf("%") >= 0 ? v : (parseFloat(v) * 100) + "%";
		return (Number(v) * 100) + "%";
	}

	function buildDefs() {
		while (defs.firstChild) defs.removeChild(defs.firstChild);
		defs.appendChild(mask);
		for (var gi = 0; gi < 4; gi++) {
			var gt = bandTheme(gi);
			var glow = el("radialGradient", { id: "lab-glow-" + gi });
			(gt.glow || [[0, "rgba(255,255,255,0.9)"], [1, "rgba(255,255,255,0)"]]).forEach(function (s) {
				glow.appendChild(el("stop", { offset: stopOffset(s[0]), "stop-color": s[1] }));
			});
			defs.appendChild(glow);
		}
		var glow = null;
		for (var i = 0; i < 4; i++) {
			var g = el("linearGradient", { id: "lab-grad-" + i, gradientUnits: "userSpaceOnUse" });
			bandTheme(i).stops.forEach(function (s) {
				g.appendChild(el("stop", { offset: stopOffset(s[0]), "stop-color": s[1] }));
			});
			defs.appendChild(g);
		}
	}

	function buildMask() {
		while (mask.firstChild) mask.removeChild(mask.firstChild);
		mask.appendChild(el("rect", { x: "0", y: "0", width: W, height: H, fill: "#fff" }));
		// The native caption buttons sit above the webview: nothing drawn there
		// is visible, so the mask cuts the strip out with a short ramp.
		var cw = M.CHROME_W;
		var ch = M.CHROME_H;
		var f = M.CHROME_FEATHER;
		mask.appendChild(el("rect", { x: W - cw, y: "0", width: cw, height: ch, fill: "#000" }));
		var gx = el("linearGradient", { id: "lab-feather-x", x1: "0", y1: "0", x2: "1", y2: "0" });
		gx.appendChild(el("stop", { offset: "0", "stop-color": "#fff" }));
		gx.appendChild(el("stop", { offset: "1", "stop-color": "#000" }));
		defs.appendChild(gx);
		mask.appendChild(el("rect", { x: W - cw - f, y: "0", width: f, height: ch, fill: "url(#lab-feather-x)" }));
	}

	function buildBands() {
		while (svg.lastChild && svg.lastChild !== defs) svg.removeChild(svg.lastChild);
		bandNodes = [];
	settles = {};
		var n = clamp(state.count, 1, 4);
		var group = el("g", { mask: "url(#" + M.MASK_ID + ")" });
		svg.appendChild(group);
		for (var i = 0; i < n; i++) {
			var g = el("g", {});
			var t = bandTheme(i);
			var glow = el("circle", { cx: "0", cy: "0", r: "0", fill: "url(#lab-glow-" + i + ")", style: "filter:blur(6px);opacity:0.55" });
			var path = el("path", { d: "", fill: "url(#lab-grad-" + i + ")", opacity: "0.95" });
			var head = el("circle", { cx: "0", cy: "0", r: half(), fill: t.core });
			var edge = null;
			if (state.glow) {
				edge = el("path", { d: "", fill: "none", stroke: "#ffffff", "stroke-width": Math.max(1.4, state.thickness * 0.75), "stroke-opacity": "0.2", style: "filter:blur(3px)" });
				g.appendChild(edge);
			}
			g.appendChild(glow);
			g.appendChild(path);
			var rim = null;
			var lanes = [];
			if (t.glass) {
				rim = el("path", { d: "", fill: "none", stroke: "#ffffff", "stroke-width": Math.max(1.1, state.thickness * 0.42), "stroke-opacity": "0.6", style: "mix-blend-mode:overlay;filter:blur(0.7px)" });
				g.appendChild(rim);
				for (var q = 0; q < 5; q++) {
					var ln = el("path", { d: "", fill: "none", stroke: ["#ff2f6d", "#ffb020", "#35ffb2", "#35d0ff", "#a86bff"][q], "stroke-width": Math.max(1, state.thickness * 0.34), "stroke-opacity": "0.26", style: "mix-blend-mode:screen;filter:blur(1.6px)" });
					g.appendChild(ln);
					lanes.push(ln);
				}
			}
			g.appendChild(head);
			group.appendChild(g);
			bandNodes.push({ g: g, path: path, edge: edge, head: head, glow: glow, rim: rim, lanes: lanes, grad: defs.querySelector("#lab-grad-" + i) });
		}
	}

	// ---------------------------------------------------------------- controls
	var countEl = document.getElementById("count");
	var trailEl = document.getElementById("trail");
	var thickEl = document.getElementById("thick");
	var glowEl = document.getElementById("glow");
	var multiEl = document.getElementById("multi");
	var replyEl = document.getElementById("reply");
	var themeEl = document.getElementById("theme");
	// Same order and the same names the plugin's own settings panel shows, so the
	// lab cannot disagree with the app about which palette is which.
	var themeOrder = ["deepseek", "kimi", "openai", "claude", "zhipu", "gemini", "qwen", "grok", "minimax", "meta", "nvidia", "unknown"];
	themeKeys = themeOrder.filter(function (k) { return !!M.THEMES[k]; })
		.concat(themeKeys.filter(function (k) { return themeOrder.indexOf(k) < 0; }));
	themeKeys.forEach(function (k) {
		var o = document.createElement("option");
		o.value = k;
		o.textContent = M.THEMES[k].label || k;
		themeEl.appendChild(o);
	});
	themeEl.value = themeKey;
	syncThemeEnabled();

	function softRebuild() {
		buildDefs();
		buildBands();
	}

	countEl.addEventListener("input", function () {
		state.count = +countEl.value;
		document.getElementById("v-count").textContent = state.count;
		softRebuild();
	});
	trailEl.addEventListener("input", function () {
		state.trail = +trailEl.value;
		document.getElementById("v-trail").textContent = state.trail;
	});
	thickEl.addEventListener("input", function () {
		state.thickness = +thickEl.value;
		document.getElementById("v-thick").textContent = state.thickness;
		buildScene();
	});
	glowEl.addEventListener("change", function () { state.glow = glowEl.checked; softRebuild(); });
	// With "one colour per band" on, the single-palette select has no say: say so
	// instead of leaving a control that visibly does nothing.
	function syncThemeEnabled() {
		try {
			themeEl.disabled = false;
			themeEl.title = multi
				? "每条光带各自配色开启时，单色选择不生效"
				: "";
		} catch (e) { /* noop */ }
	}

	multiEl.addEventListener("change", function () {
		multi = multiEl.checked;
		syncThemeEnabled();
		buildDefs();
		buildBands();
	});
	replyEl.addEventListener("change", function () {
		// Waiting for the user: the band turns the other way. The ramp lives in
		// advance(), so the tail slides around instead of snapping.
		state.reply = replyEl.checked;
	});
	themeEl.addEventListener("change", function () {
		// Picking one palette is an explicit request for that colour, so it turns
		// off "one colour per band" instead of silently doing nothing.
		if (multi) {
			multi = false;
			multiEl.checked = false;
		}
		themeKey = themeEl.value;
		syncThemeEnabled();
		softRebuild();
	});

	document.getElementById("btn-think").addEventListener("click", function () {
		state.mode = "thinking";
		state.manualStop = false;
		state.birth = performance.now();
		orbit = { mode: "off" };
		clearGhosts();
		answer.innerHTML = '<div class="ln" style="width:62%"></div>';
		// Re-create every band from the corner. Reset wipes births/pending, and
		// flipping the mode alone therefore left the frame empty.
		bornAll(clock);
	});
	document.getElementById("btn-finish").addEventListener("click", function () {
		state.mode = "done";
		state.answerGrowAt = 0;
		// The band stays on the edge while the answer lands, then leaves for the
		// dialogue box - the same hand-off the plugin performs on its own. The
		// deadline is a clock value rather than a timer, so a warm-up loop and a
		// headless capture both see it fire at the same point.
		state.finishAt = clock + 640;
	});
	document.getElementById("btn-stop").addEventListener("click", function () {
		state.manualStop = true;
		state.mode = "idle";
		state.answerGrowAt = 0;
		spawnGhost();
	});
	document.getElementById("btn-bg").addEventListener("click", function () {
		// A background conversation finished: its band leaves the edge and runs
		// one lap around that conversation's row before fading out.
		spawnGhost(true);
	});
	document.getElementById("btn-entry").addEventListener("click", function () {
		// Replay the birth: every band restarts from the bottom-left corner with a
		// tail that grows out of nothing (no throw from the send button anymore).
		state.mode = "thinking";
		state.manualStop = false;
		state.answerGrowAt = 0;
		orbit = { mode: "off" };
		clearGhosts();
		answer.innerHTML = '<div class="ln" style="width:62%"></div>';
		bornAll(clock);
	});
	document.getElementById("btn-more").addEventListener("click", function () {
		// One more conversation starts thinking: a new band is born, the others
		// keep their phase, and the spacing stays exactly lap / count.
		var n = clamp(state.count, 1, 4);
		if (n >= 4) return;
		state.count = n + 1;
		countEl.value = String(state.count);
		document.getElementById("v-count").textContent = String(state.count);
		if (state.mode === "idle") state.mode = "thinking";
		buildBands();
		bornOne(n);
	});
	document.getElementById("btn-reset").addEventListener("click", function () {
		// Full restore, not just a wiped canvas: every control goes back to its
		// default and the state object is rebuilt from those defaults, so a reset
		// really means "as if the page had just loaded". Resetting only the picture
		// left the sliders and switches where they were, and the next click then
		// resumed with the old values.
		resetAll();
	});

	function resetAll() {
		// Defaults mirror the markup, so there is one place to keep them honest.
		var d = { count: 1, trail: 320, thickness: 6, speed: 1.6, sweep: 0.62, glow: true, multi: false, reply: false, theme: "deepseek" };
		state.count = d.count;
		state.trail = d.trail;
		state.thickness = d.thickness;
		state.glow = d.glow;
		// state.p is a *raw* phase; the corner offset is a warped one, so it has to
		// go back through sweepInv or band 0 lands somewhere else entirely.
		state.p = cornerPh === null ? 0 : (M.sweepInv ? wrap1(M.sweepInv(cornerPh)) : cornerPh);
		state.reply = d.reply;
		state.dirNow = -1;
		state.mode = "idle";
		state.manualStop = false;
		state.answerGrowAt = 0;
		state.birth = performance.now();
		multi = d.multi;
		themeKey = d.theme;

		countEl.value = String(d.count);
		trailEl.value = String(d.trail);
		thickEl.value = String(d.thickness);
		themeEl.value = d.theme;
		glowEl.checked = d.glow;
		multiEl.checked = d.multi;
		syncThemeEnabled();
		replyEl.checked = d.reply;
		var speedElR = document.getElementById("speed");
		if (speedElR) {
			speedElR.value = String(d.speed);
			document.getElementById("v-speed").textContent = d.speed.toFixed(2);
			labSpeed = d.speed;
			recalcLap();
		}
		var sweepElR = document.getElementById("sweep");
		if (sweepElR) {
			sweepElR.value = String(d.sweep);
			document.getElementById("v-sweep").textContent = d.sweep.toFixed(2);
			if (M.setSweepAmp) M.setSweepAmp(d.sweep);
		}
		["count", "trail", "thick"].forEach(function (name) {
			var v = document.getElementById("v-" + name);
			if (v) v.textContent = String(state[name === "count" ? "count" : (name === "trail" ? "trail" : "thickness")]);
		});

		orbit = { mode: "off" };
		clearGhosts();
		blankBands();
		// Rebuild after the state is coherent so the new geometry uses the
		// restored thickness and trail length.
		buildScene();
		blankBands();
		answer.innerHTML = '<div class="ln" style="width:62%"></div>';
	}

	// ------------------------------------------------- DeepSeek 峰谷时段彩蛋
	// 官方定价脚注：高峰只发生在北京时间周一至周五、且不是中国法定节假日的
	// 09:00-12:00 与 14:00-18:00；午休、夜间、整段周末与整段法定节假日都是空闲
	// 时段，空闲价为高峰的一半。调休补班的周六/周日仍按周末算，即空闲。
	var PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
	// 中国法定节假日（2026 年放假安排；次年请按国务院日历替换这张表）。
	var HOLIDAYS = {
		2026: [
			"01-01", "01-02", "01-03",
			"02-15", "02-16", "02-17", "02-18", "02-19", "02-20", "02-21", "02-22",
			"04-04", "04-05", "04-06",
			"05-01", "05-02", "05-03", "05-04", "05-05",
			"06-19", "06-20", "06-21",
			"10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "10-07", "10-08",
		],
	};

	function beijingFields(date) {
		// Shift the instant by +8h and read the UTC fields: that yields Beijing
		// wall-clock values without depending on the machine's own time zone.
		var s = new Date(date.getTime() + 8 * 3600 * 1000);
		return {
			y: s.getUTCFullYear(),
			mo: s.getUTCMonth() + 1,
			d: s.getUTCDate(),
			dow: s.getUTCDay(),
			mins: s.getUTCHours() * 60 + s.getUTCMinutes(),
		};
	}

	function isPeakMoment(date) {
		var f = beijingFields(date || new Date());
		if (f.dow === 0 || f.dow === 6) return false;
		var md = ("0" + f.mo).slice(-2) + "-" + ("0" + f.d).slice(-2);
		var list = HOLIDAYS[f.y] || [];
		if (list.indexOf(md) >= 0) return false;
		for (var i = 0; i < PEAK_WINDOWS.length; i++) {
			if (f.mins >= PEAK_WINDOWS[i][0] && f.mins < PEAK_WINDOWS[i][1]) return true;
		}
		return false;
	}

	var EGG_QUESTION = "现在是什么时段？";
	var EGG_COOLDOWN_MS = 45000;
	var eggLastAt = -1e9;

	function convoEl() { return document.querySelector("#frame .convo"); }

	function pushBubble(node) {
		var box = convoEl();
		if (!box) return;
		box.appendChild(node);
	}

	function eggAnswer(date) {
		var peak = isPeakMoment(date);
		var bubble = document.createElement("div");
		bubble.className = "bubble";
		bubble.appendChild(document.createTextNode("现在是"));
		var word = document.createElement("span");
		word.className = "glass-word " + (peak ? "warm" : "cool");
		word.textContent = peak ? "梁文峰" : "梁文谷";
		bubble.appendChild(word);
		// Only the two names are a glass badge; "时段" is ordinary text. The
		// tabular space keeps the words from touching the badge's glow.
		bubble.appendChild(document.createTextNode("时段。"));
		return bubble;
	}

	function resetConvo() {
		// Wipe the demo exchange and hand back a fresh, still-detached #answer:
		// the streaming animation keeps drawing its lines into it, and without it
		// the band would have nothing to orbit. It is attached after the question
		// bubble (see sendAsk) so the empty card never floats above the chat, and
		// the `:empty` rule keeps it invisible until a line arrives.
		var box = convoEl();
		if (!box) return;
		box.innerHTML = "";
		var fresh = document.createElement("div");
		fresh.id = "answer";
		answer = fresh;
		return fresh;
	}

	// The page opens on the easter-egg exchange, which lives in the markup; this
	// only keeps the badge in step with the local time and makes sure a detached
	// #answer exists so the streaming demo still has something to draw into.
	function initEggConversation(when) {
		var date = (when instanceof Date && !isNaN(when.getTime())) ? when : new Date();
		var word = document.getElementById("egg-word");
		if (word) {
			var peak = isPeakMoment(date);
			word.className = "glass-word " + (peak ? "warm" : "cool");
			word.textContent = peak ? "梁文峰" : "梁文谷";
		}
		var fresh = document.getElementById("answer");
		if (!fresh) {
			fresh = document.createElement("div");
			fresh.id = "answer";
			var box = convoEl();
			if (box) box.appendChild(fresh);
		}
		answer = fresh;
		return date;
	}

	// Sending the question answers itself and REPLACES whatever the area showed -
	// it is a takeover, not one more turn in the demo thread. Any other text just
	// lands as a user bubble so the composer still behaves like a chat box.
	function sendAsk(rawText, when) {
		var value = String(rawText == null ? "" : rawText).trim();
		if (!value) return false;
		var takeover = value === EGG_QUESTION ? resetConvo() : null;
		var user = document.createElement("div");
		user.className = "bubble user";
		user.textContent = value;
		pushBubble(user);
		if (takeover) pushBubble(takeover);
		if (value !== EGG_QUESTION) return true;
		eggLastAt = clock;
		setTimeout(function () { pushBubble(eggAnswer(when || new Date())); }, 520);
		return true;
	}

	function wireComposer() {
		var input = document.getElementById("ask");
		var send = document.getElementById("send");
		if (!input) return;
		var fire = function () {
			if (clock - eggLastAt < EGG_COOLDOWN_MS) return;
			if (sendAsk(input.value, new Date())) input.value = "";
		};
		input.addEventListener("keydown", function (ev) {
			if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); fire(); }
		});
		if (send) send.addEventListener("click", fire);
	}
	wireComposer();


	// ---------------------------------------------------------------- ghosts
	function composerRing() {
		var r = frame.getBoundingClientRect();
		var c = document.querySelector("#frame .composer").getBoundingClientRect();
		return M.rectToRing({ left: c.left - r.left, top: c.top - r.top, width: c.width, height: c.height }, 12);
	}

	function maybeFinish() {
		if (!state.finishAt) return;
		if (clock < state.finishAt) return;
		state.finishAt = 0;
		spawnGhost();
	}

	function spawnGhost(toRow) {
		if (!track) return;
		var from = lastHeads[0] || { x: W / 2, y: H / 2 };
		var ring = composerRing();
		if (toRow) {
			var rowEl = document.querySelector('[data-demo-row="bg1"]');
			if (rowEl) {
				var rr = rowEl.getBoundingClientRect();
				var fr = frame.getBoundingClientRect();
				ring = M.rectToRing({ left: rr.left - fr.left, top: rr.top - fr.top, width: rr.width, height: rr.height }, 10);
			}
		}
		var path = M.returnPath(from, ring);
		var t = theme();
		var g = el("g", {});
		var glow = el("circle", { cx: "0", cy: "0", r: "0", fill: "url(#lab-glow-0)", style: "filter:blur(5px);opacity:0" });
		var path2 = el("path", { d: "", fill: t.core, opacity: "1" });
		var head = el("circle", { cx: "0", cy: "0", r: half(), fill: t.core, opacity: "1" });
		g.appendChild(glow);
		g.appendChild(path2);
		g.appendChild(head);
		ghostHost.appendChild(g);
		// The speed profile is 1 - A*cos(2*pi*p): its slope peaks a quarter lap off
		// a corner. Wait for the next peak and leave carrying exactly that speed.
		var amp = M.getSweepAmp ? M.getSweepAmp() : 0.62;
		var ph0 = phases[0] == null ? 0 : phases[0];
		var sgn = state.dirNow < 0 ? -1 : 1;
		var pick = null;
		[0.25, 0.75].forEach(function (quarter) {
			var ahead = (((quarter - ph0) * sgn) % 1 + 1) % 1;
			if (!pick || ahead < pick.ahead) pick = { ahead: ahead, quarter: quarter };
		});
		var wait = 180 + pick.ahead * lapMs;
		var avg = track.total / lapMs;
		var exitSpeed = Math.max(0.2, avg * (1 - amp * Math.cos(2 * Math.PI * pick.quarter)));
		// px / (px/ms) is already ms; scaling by 1000 here made the hop ~26min long.
		var dur = Math.max(240, (path.leg + path.lap) / (exitSpeed / 1.57));
		ghostSpawns += 1;
	ghosts.push({ g: g, path: path2, head: head, glow: glow, at: clock + wait, dur: dur, wait: wait, uNow: 0, pathData: path });
	}

	function clearGhosts() {
		ghosts = [];
		while (ghostHost && ghostHost.firstChild) ghostHost.removeChild(ghostHost.firstChild);
	}

	// ---------------------------------------------------------------- frame
	var lastHeads = {};
	var lastT = 0;
	var clock = 0;

	// One simulation step. `dt` comes from the real rAF delta, or from the
	// warm-up loop that fast-forwards the scene for a scripted capture.
	var frozen = false;
	function advance(dt) {
		if (!track) return;
		// `?p=` pins the phase: the scene stops advancing so two captures with
		// different palettes can be compared pixel for pixel.
		if (frozen) dt = 0;
		clock += dt;
		var now = clock;
		// The amplitude is eased over time exactly like the plugin does it, so a
		// slider move is a soft reshape of the speed curve, never an instant snap.
		if (M.stepSweepAmp) M.stepSweepAmp(dt);

		if (state.mode === "streaming") {
			// The answer streams in: lines appear, so the orbit ring keeps growing.
			if (now - state.answerGrowAt > 260) {
				state.answerGrowAt = now;
				var lines = answer.querySelectorAll(".ln").length;
				if (lines < 12) {
					var ln = document.createElement("div");
					ln.className = "ln";
					ln.style.width = (40 + Math.round(Math.random() * 55)) + "%";
					answer.appendChild(ln);
				}
			}
		}

		var active = state.mode === "thinking" || state.mode === "streaming" || state.mode === "done";
		var h = half();
		var t = theme();
		var n = clamp(state.count, 1, 4);
		maybeFinish();

		// Reverse (waiting for the user) is eased in, so the tail swaps sides
		// smoothly instead of flipping in one frame.
		var dirTarget = state.reply ? 1 : -1;
		state.dirNow += (dirTarget - state.dirNow) * Math.min(1, dt / 240);
		if (Math.abs(dirTarget - state.dirNow) < 0.01) state.dirNow = dirTarget;
		var dirNow = state.dirNow;

		if (active) {
			state.p = ((state.p + (dt / lapMs) * dirNow) % 1 + 1) % 1;
			var hL = half();
			var nB = clamp(state.count, 1, 4);
			// One shared base clock: every band rides the same speed profile, so
			// accelerations stay in sync and band i is exactly i/n of a lap ahead.
			var warpedBaseL = wrap1(M.sweep(wrap1(state.p)));
			for (var i = 0; i < nB && i < bandNodes.length; i++) {
				var nd = bandNodes[i];
				var bt = bandTheme(i);
				var targetPh = wrap1(warpedBaseL + i / nB);
				var stl = settles[i];
				if (!stl || stl.n !== nB || Math.sign(stl.dir) !== Math.sign(dirNow)) {
					stl = settles[i] = { n: nB, dir: dirNow, t0: clock, gap: wrapCenter((phases[i] == null ? 0 : phases[i]) - targetPh) };
				}
				var suL = Math.min(1, Math.max(0, (clock - stl.t0) / 4000));
				var skL = suL * suL * (3 - 2 * suL);
				var phRaw = wrap1(targetPh + stl.gap * (1 - skL));
				phases[i] = phRaw;
				var slot = wrap1(phRaw);
				slotDbg[i] = Math.round(slot * 1000) / 1000;

				// Release branch: a band waits until its own slot is near the bottom-left
				// corner, then appears there with a tail that grows from zero. The delay is
				// what lines it up with the bands already running - there is no throw and no
				// catch-up afterwards.
				if (pending[i]) {
					var waitL = wrap1(cornerPh - slot);
					waitDbg[i] = Math.round(waitL * 1000) / 1000;
					if (!(waitL <= SPAWN_LEAD || waitL >= 1 - SPAWN_LEAD)) { nd.g.style.opacity = "0"; continue; }
					delete pending[i];
					births[i] = clock;
					lenState[i] = { len: 0, at: clock };
					shifts[i] = { d: waitL <= 0.5 ? waitL : -(1 - waitL), t0: clock };
					nd.g.style.opacity = "";
				}
				// Nothing is waiting any more, so the group must be visible: both a
				// reset and a rebuild blank the opacity, and only the release branch
				// above restores it. Without this line the band was drawn at opacity 0
				// and "start thinking" looked broken after a reset.
				if (!pending[i]) nd.g.style.opacity = "";
				var phaseNow = slot;
				var shL = shifts[i];
				if (shL) {
					var kkL = Math.min(1, Math.max(0, (clock - shL.t0) / SPAWN_MS));
					if (kkL >= 1) delete shifts[i];
					else phaseNow = wrap1(slot + shL.d * (1 - kkL));
				}
				var headS = track.offset + phaseNow * track.total;
				var head = track.at(headS);
				var lst = lenState[i];
				var lenNow = state.trail;
				if (lst && lst.at) {
					var gu = Math.min(1, Math.max(0, (clock - lst.at) / GROW_MS_LAB));
					lenNow = lst.len + (state.trail - lst.len) * easeOutCubic(gu);
				}
				var d = "";
				try { d = M.ribbonPath(track, headS, lenNow, hL, 34, null, dirNow); } catch (e) { d = ""; }
				if (!headDbg[i]) headDbg[i] = {};
				headDbg[i].x = head.x; headDbg[i].y = head.y; headDbg[i].a = head.angle;
				var headPt = { x: head.x, y: head.y };
				// The tail sits *behind* the head, and behind depends on the direction:
				// with the clockwise default (-1) the band travels towards smaller s, so
				// the tail is at headS + lenNow. Dropping the direction factor put the
				// gradient's start on the wrong side of the head, which padded the whole
				// ribbon with the last stop - every palette rendered flat white.
				var tailS = M.wrapArc ? M.wrapArc(track, headS - dirNow * lenNow) : headS - dirNow * lenNow;
				var tailPt = track.at(tailS);
				lastLen[i] = lenNow;
				nd.path.setAttribute("d", d);
				if (nd.edge && d) nd.edge.setAttribute("d", d);
				if (nd.edgeB && d) nd.edgeB.setAttribute("d", d);
				if (bt.glass && nd.lanes && nd.lanes.length) {
					var ha = (head.angle * Math.PI) / 180;
					var nx = -Math.sin(ha);
					var ny = Math.cos(ha);
					var spread = Math.max(2.1, hL * 2);
					for (var li = 0; li < nd.lanes.length; li++) {
						var tt = nd.lanes.length > 1 ? li / (nd.lanes.length - 1) - 0.5 : 0;
						var sway = Math.sin(now / 540 + li * 1.3) * spread * 0.35;
						var off = tt * spread + sway;
						var dj = "";
						try {
							dj = M.ribbonPath(track, headS, lenNow, hL, 34, {
								amp: hL * (1.15 + 0.35 * Math.abs(tt)),
								freq: 1.35 + 0.45 * Math.abs(tt),
								phase: now / (760 - 90 * Math.abs(tt)) + li * 0.31
							}, dirNow);
						} catch (e2) { dj = ""; }
						nd.lanes[li].setAttribute("d", dj);
						nd.lanes[li].setAttribute("transform", "translate(" + (nx * off).toFixed(2) + " " + (ny * off).toFixed(2) + ")");
					}
					if (nd.rim) {
						var dr = "";
						try {
							dr = M.ribbonPath(track, headS, lenNow, hL * 0.92, 34, { amp: hL * 1.55, freq: 1.15, phase: now / 980 }, dirNow);
						} catch (e3) { dr = ""; }
						nd.rim.setAttribute("d", dr);
						nd.rim.setAttribute("transform", "translate(" + (nx * hL * 1.6).toFixed(2) + " " + (ny * hL * 1.6).toFixed(2) + ")");
					}
				}
				nd.head.setAttribute("cx", headPt.x.toFixed(1));
				nd.head.setAttribute("cy", headPt.y.toFixed(1));
				nd.head.setAttribute("r", hL.toFixed(2));
				if (nd.glow) {
					nd.glow.setAttribute("cx", headPt.x.toFixed(1));
					nd.glow.setAttribute("cy", headPt.y.toFixed(1));
					nd.glow.setAttribute("r", (hL * 3.4).toFixed(2));
				}
				if (nd.grad) {
					nd.grad.setAttribute("x1", tailPt.x.toFixed(1));
					nd.grad.setAttribute("y1", tailPt.y.toFixed(1));
					nd.grad.setAttribute("x2", headPt.x.toFixed(1));
					nd.grad.setAttribute("y2", headPt.y.toFixed(1));
				}
				lastHeads[i] = headPt;
			}
		}

		// ghosts: straight hop to the composer ring, one lap, fade out
		for (var gi = ghosts.length - 1; gi >= 0; gi--) {
			var gh = ghosts[gi];
			if (now < gh.at) { gh.g.style.opacity = "0"; gh.uNow = 0; continue; }
			gh.g.style.opacity = "";
			var u = Math.min(1, (now - gh.at) / gh.dur);
			gh.uNow = u;
			var e = easeInOutCubic(u);
			var s = e * gh.pathData.total;
			var tl2 = Math.min(state.trail, s);
			var pl = gh.pathData.at(s);
			var pts3 = [];
			for (var q = 0; q < 34; q++) pts3.push(gh.pathData.at(Math.max(0, s - tl2 * (q / 33))));
			gh.path.setAttribute("d", pts3.length > 1 ? M.polyRibbon(pts3, h) : "");
			var fade = u < 0.62 ? 1 : Math.max(0, 1 - (u - 0.62) / 0.38);
			gh.path.setAttribute("opacity", String(fade));
			gh.head.setAttribute("cx", pl.x.toFixed(1));
			gh.head.setAttribute("cy", pl.y.toFixed(1));
			gh.head.setAttribute("opacity", String(fade));
			gh.glow.setAttribute("cx", pl.x.toFixed(1));
			gh.glow.setAttribute("cy", pl.y.toFixed(1));
			gh.glow.setAttribute("r", (h * 3.2).toFixed(2));
			gh.glow.setAttribute("opacity", String(fade * 0.7));
			if (u >= 1) {
				gh.g.remove();
				ghosts.splice(gi, 1);
			}
		}

		out.textContent =
			"mode=" + state.mode + "  n=" + n + "  p=" + state.p.toFixed(3) +
			"\nlap=" + Math.round(lapMs) + "ms  total=" + Math.round(track.total) + "px  t=" + state.thickness +
			"\nspeed=" + (M.ringSpeedAt ? M.ringSpeedAt(phases[0] || 0, track.total, lapMs).toFixed(2) : "?") +
			"px/ms  ring-avg=" + (track.total / lapMs).toFixed(2) +
			"  cap=" + (M.transitCap ? M.transitCap(phases[0] || 0, track.total, lapMs).toFixed(2) : "?") + "px/ms" +
			"\ntheme=" + themeKey + (multi ? " (per band: " + bandOrder.slice(0, clamp(n, 1, 4)).join(",") + ")" : "") +
			"  glow=" + state.glow + "  dir=" + (state.dirNow < -0.02 ? "cw" : "ccw") +
			"\norbit=" + orbit.mode +
			"  ring=" + (state.mode === "streaming" ? "yes" : "-") +
			"  corner=" + (cornerPh === null ? "null" : cornerPh.toFixed(3)) +
			"  pending=" + (function () { var c = 0; for (var pk in pending) if (pending[pk]) c++; return c; })() +
			"  sweep=" + (M.getSweepAmp ? M.getSweepAmp().toFixed(2) : "?") +
			(wantStyleCheck ? "\n" + styleProbe() : "") +
			"  orgLen=" + (orbit.ring && M.fitRing
				? Math.min(state.trail, M.ellipsePerimeter(M.fitRing(orbit.ring, state.trail).rx, M.fitRing(orbit.ring, state.trail).ry) * 0.8).toFixed(0)
				: "-") +
			"\nhead=" + (function () {
				var hb = headDbg[0];
				return hb ? hb.x.toFixed(1) + "," + hb.y.toFixed(1) + " a=" + hb.a.toFixed(1) : "-";
			})() +
			"\nphases=" + (function () {
				var k0 = clamp(n, 1, 4);
				var list = [];
				for (var j0 = 0; j0 < k0; j0++) list.push(wrap1(phases[j0] == null ? 0 : phases[j0]));
				// Sorted, so the numbers read as positions around the loop instead of
				// birth order.
				list.sort(function (a, b) { return a - b; });
				var gapsL = [];
				for (var j1 = 0; j1 < list.length; j1++) {
					var aL = list[j1];
					var bL = list[(j1 + 1) % list.length];
					var gap = wrap1(bL - aL);
					if (list.length > 1) gapsL.push(gap.toFixed(3));
				}
				return list.map(function (v) { return v.toFixed(3); }).join(",") +
					"  gaps=" + (gapsL.length ? gapsL.join(",") : "-");
			})() +
			"\nbands=" + (function () {
				var parts = [];
				for (var jb = 0; jb < clamp(n, 1, 4); jb++) {
					var gb = grabs[jb];
					var hb = lenState[jb];
					var lnow = lastLen[jb];
					parts.push("b" + jb + ":len=" + (typeof lnow === "number" ? Math.round(lnow) : (hb ? Math.round(hb.len || 0) : "-")) +
						" grab=" + (gb ? Math.round(gb.x) + "," + Math.round(gb.y) : "-"));
				}
				return parts.join(" | ");
			})() +
			"\ncfg=count:" + state.count + " trail:" + state.trail + " thick:" + state.thickness +
			" speed:" + labSpeed.toFixed(2) + " sweep:" + (M.getSweepAmp ? M.getSweepAmp().toFixed(2) : "?") +
			" theme:" + themeKey + " glow:" + state.glow + " multi:" + multi + " reply:" + state.reply +
			"\nghosts=" + ghosts.length + " spawns=" + ghostSpawns + (ghosts.length
				? " wait=" + Math.round(ghosts[0].wait) + " dur=" + String(ghosts[0].dur) + " left=" + Math.round(ghosts[0].at - clock) + " clock=" + Math.round(clock) + " u=" + String(ghosts[0].uNow) +
				  "  leg=" + Math.round(ghosts[0].pathData.leg) + " total=" + Math.round(ghosts[0].pathData.total) +
				  " dlen=" + ((ghosts[0].path.getAttribute("d") || "").length) +
				  " at=" + ghosts[0].head.getAttribute("cx") + "," + ghosts[0].head.getAttribute("cy")
				: "");
	}


	window.__LAB__ = {
		setSpeed: function (v) { labSpeed = clamp(Number(v) || 1.6, 0.3, 3); recalcLap(); },
		getSpeed: function () { return labSpeed; },
		state: state,
		getLap: function () { return lapMs; },
		// Easter-egg hooks: let a headless capture ask the question directly, and
		// let the console check the billing window without touching the DOM.
		isPeakMoment: isPeakMoment,
		sendAsk: sendAsk
	};

	function frameLoop(ts) {
		if (!lastT) lastT = ts;
		var dt = clamp(ts - lastT, 1, 133);
		lastT = ts;
		try { advance(dt); } catch (e) { out.textContent = "error: " + e; }
		requestAnimationFrame(frameLoop);
	}

	window.addEventListener("resize", function () { buildScene(); });

	// URL parameters make the page scriptable for headless captures:
	//   ?mode=thinking|streaming|done|stop&n=2&trail=320&t=6&theme=kimi
	(function () {
		var q = {};
		(location.search || "").replace(/^\?/, "").split("&").forEach(function (kv) {
			if (!kv) return;
			var p = kv.split("=");
			q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
		});
		if (q.n) { state.count = clamp(+q.n || 1, 1, 4); countEl.value = state.count; document.getElementById("v-count").textContent = state.count; }
		if (q.trail) { state.trail = +q.trail; trailEl.value = state.trail; document.getElementById("v-trail").textContent = state.trail; }
		if (q.t) { state.thickness = +q.t; thickEl.value = state.thickness; document.getElementById("v-thick").textContent = state.thickness; }
		if (q.theme && M.THEMES[q.theme]) { themeKey = q.theme; themeEl.value = themeKey; }
		if (q.multi) { multi = true; multiEl.checked = true; }
		// ?corner=0 reproduces the old square-cornered track, for A/B captures.
		if (q.corner !== undefined) { cornerOverride = parseFloat(q.corner) || 0; }
		if (q.reply) { state.reply = true; replyEl.checked = true; }
		if (q.sweep) {
			// 0 is a real value here (uniform speed), so no "|| default" shortcut:
			// the outer `if (q.sweep)` already guarantees a non-empty string.
			var sv = clamp(+q.sweep, 0, 0.95);
			var sel = document.getElementById("sweep");
			if (sel) { sel.value = String(sv); document.getElementById("v-sweep").textContent = sv.toFixed(2); }
			if (M.setSweepAmp) M.setSweepAmp(sv);
		}
		if (q.stylecheck === "1") wantStyleCheck = true;
		buildScene();
		if (!q.ask) {
			// The exchange itself is static markup (so a cached script can never
			// leave the area blank); this only repaints the badge from the real
			// local time and hands the streaming demo a detached #answer.
			initEggConversation(new Date());
		}
		if (q.ask) {
			// Scriptable easter egg: ?ask=现在是什么时段？ with an optional
			// ?at=<ISO instant> to pin which billing window gets answered.
			var whenAsk = q.at ? new Date(q.at) : new Date();
			if (isNaN(whenAsk.getTime())) whenAsk = new Date();
			setTimeout(function () { sendAsk(q.ask, whenAsk); }, 60);
		}
		if (q.mode) {
			state.mode = q.mode === "stop" ? "idle" : q.mode;
			state.birth = 0;
			if (q.mode === "streaming" || q.mode === "stop") state.mode = q.mode === "stop" ? "idle" : "streaming";
			// Pre-grow the answer so a headless capture shows a realistic ring.
			var pre = clamp(+q.lines || 0, 0, 12);
			for (var i = 0; i < pre; i++) {
				var ln = document.createElement("div");
				ln.className = "ln";
				ln.style.width = (48 + ((i * 17) % 46)) + "%";
				answer.appendChild(ln);
			}
			// Fast-forward the scene so a single headless frame can show any
			// stage: warm=1200 lands mid-orbit, warm=3000 lands in the spin-out.
			var warm = clamp(+q.warm || 0, 0, 8000);
			var doneAt = clamp(+q.doneAfter || 0, 0, 8000);
			if (doneAt) {
				for (var w0 = 0; w0 < doneAt; w0 += 16.7) advance(16.7);
				state.mode = "done";
				state.answerGrowAt = 0;
			}
			for (var w = 0; w < warm; w += 16.7) advance(16.7);
			// a ghost must be spawned after the final buildScene(): rebuilding the
			// scene clears ghostSvg and would detach the ghost's nodes.
			pendingGhost = clamp(+q.ghost || 0, 0, 4000);
		}
		if (q.p) { state.p = clamp(+q.p, 0, 1); frozen = true; }
		buildScene();
		if (pendingGhost) {
			spawnGhost(true);
			for (var wg = 0; wg < pendingGhost; wg += 16.7) advance(16.7);
		}
		// Headless hook: `click=reset&after=600` presses a panel button and then
		// fast-forwards, so a single screenshot can prove what a click does.
		if (q.click) {
			// `click=reset,think` presses several buttons in order.
			q.click.split(",").forEach(function (name) {
				var b = document.getElementById("btn-" + name.trim());
				if (b) b.click();
			});
			var after = clamp(+q.after || 0, 0, 6000);
			for (var wc = 0; wc < after; wc += 16.7) advance(16.7);
		}
		requestAnimationFrame(frameLoop);
	})();
})();






