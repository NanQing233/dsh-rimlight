/** Host half of the bundle; the Client module owns the rendering. */
import z from "@deepseek-ai/schemastery";

/**
 * Live-editable settings for the marquee, in CSS pixels:
 * - `trailLength`: how long the meteor tail is.
 * - `thickness`: how wide the light band is (default 6, i.e. half of the
 *   original 12 so the band reads as a thin streak rather than a bar).
 * - `edgeGlow`: draw a white rim/bloom along the band's edges.
 * - `modelColor`: pick the palette from the model that is being called.
 * - `speed`: speed multiplier for the trip around the frame (1 = the original
 *   pace, lower is slower, higher is faster).
 *
 * All fields are volatile so the settings form can write them without
 * remounting the plugin.
 */
const Config = z.object({
	trailLength: z.number().step(1).min(40).max(1200).default(320).volatile(),
	thickness: z.number().step(1).min(2).max(24).default(6).volatile(),
	edgeGlow: z.boolean().default(true).volatile(),
	modelColor: z.boolean().default(true).volatile(),
	theme: z.string().default("").volatile(),
	unknownTheme: z.string().default("prism").volatile(),
	speed: z.number().step(0.05).min(0.3).max(3).default(1.6).volatile(),
	// How much the band's speed breathes over one lap: 0 = constant, 0.62 =
	// shipped tuning (slow at the corners, quick along an edge).
	// step must divide the default, otherwise schemastery rejects the config
	// ("expected number multiple of 0.05 but got 0.62") and the plugin never
	// activates at all.
	sweep: z.number().step(0.01).min(0).max(0.95).default(0.62).volatile(),
});

export { Config };
export function apply() {}