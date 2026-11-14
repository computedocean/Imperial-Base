// Nested sun shadow cascades.
//
// The sun is drawn as several shadow-casting directional lights that share one direction and one
// focus point but cover boxes of growing size. The first is the tight, crisp box around what the
// camera looks at; the others reach out so distant buildings still cast shadows.
//
// The stock cascade options in three (CSM addon, SunLight) slice the camera's view frustum instead.
// That wastes most of the map on empty desert when the camera overlooks the base from far away,
// so the cascades here are fitted to the focus point like the single map was before.
//
// Three would light the scene once per directional light. The patch below makes the shader treat
// all shadow-casting directional lights as one sun: each pixel takes its shadow from the tightest
// box that contains it, cross-fades to the next near the edge, and is lit once.
import * as THREE from 'three'

/** Widest half-extent a cascade may reach (metres): the whole base plus the nearer desert. */
export const CASCADE_MAX_HALF = 1500

/**
 * Half-extents of `count` nested cascades. The first equals `half0`; the last reaches
 * CASCADE_MAX_HALF; the ones between are spaced geometrically so each step loses the same
 * factor of sharpness.
 */
export function cascadeHalfExtents(half0: number, count: number, maxHalf = CASCADE_MAX_HALF): number[] {
  if (count <= 1) return [half0]
  const last = Math.max(half0, maxHalf)
  const ratio = Math.pow(last / half0, 1 / (count - 1))
  return Array.from({ length: count }, (_, i) => half0 * Math.pow(ratio, i))
}

// The directional-light block of three's lights_fragment_begin chunk (r187), up to the stock shadow lookup.
const STOCK_HEAD = /#if \( NUM_DIR_LIGHTS > 0 \) && defined\( RE_Direct \)\s+DirectionalLight directionalLight;\s+#if defined\( USE_SHADOWMAP \) && NUM_DIR_LIGHT_SHADOWS > 0\s+DirectionalLightShadow directionalLightShadow;\s+#endif\s+#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_DIR_LIGHTS; i \+\+ \) \{\s+directionalLight = directionalLights\[ i \];\s+getDirectionalLightInfo\( directionalLight, directLight \);\s+#if defined\( USE_SHADOWMAP \) && \( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS \)\s+directionalLightShadow = directionalLightShadows\[ i \];\s+directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (getShadow\( directionalShadowMap\[ i \],[^;]+?vDirectionalShadowCoord\[ i \] \)) : 1\.0;\s+#endif\s+(RE_Direct\([^;]+\);)\s+\}\s+#pragma unroll_loop_end\s+#endif/

/** Fraction of a cascade's width over which it cross-fades into the next one. */
const FADE = '0.07'

function patchedBlock(getShadow: string, reDirect: string) {
  return /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif

	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
	// nested sun cascades: every shadow-casting directional light is one cascade of the same sun
	float sunShade = 0.0; // shadow gathered so far, weighted
	float sunOpen = 1.0;  // weight not yet claimed by a tighter cascade
	float sunIn;
	vec3 sunCoord;
	vec2 sunEdge;
	#endif

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

		directionalLight = directionalLights[ i ];

		getDirectionalLightInfo( directionalLight, directLight );

		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1 && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )

			sunCoord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
			sunEdge = min( sunCoord.xy, 1.0 - sunCoord.xy );
			sunIn = sunOpen * clamp( min( sunEdge.x, sunEdge.y ) / ${FADE}, 0.0, 1.0 );

			if ( sunIn > 0.0 ) {

				directionalLightShadow = directionalLightShadows[ i ];
				sunShade += sunIn * ${getShadow};
				sunOpen -= sunIn;

			}

			#if ( UNROLLED_LOOP_INDEX == NUM_DIR_LIGHT_SHADOWS - 1 )

				// beyond the widest cascade (sunOpen) the ground is simply lit
				directLight.color *= ( directLight.visible && receiveShadow ) ? sunShade + sunOpen : 1.0;
				${reDirect}

			#endif

		#else

			#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
			directionalLightShadow = directionalLightShadows[ i ];
			directLight.color *= ( directLight.visible && receiveShadow ) ? ${getShadow} : 1.0;
			#endif

			${reDirect}

		#endif

	}
	#pragma unroll_loop_end

#endif`
}

/** Returns the chunk with the sun-cascade block swapped in, or null if three's chunk no longer matches. */
export function patchLightsChunk(chunk: string): string | null {
  const m = STOCK_HEAD.exec(chunk)
  if (!m) return null
  return chunk.slice(0, m.index) + patchedBlock(m[1], m[2]) + chunk.slice(m.index + m[0].length)
}

let installed: boolean | null = null

/**
 * Patch three's lighting chunk once. Returns false (and leaves three untouched) if the stock
 * chunk has changed shape, in which case the caller must fall back to a single sun light.
 * Scenes with at most one shadow-casting directional light compile exactly as before.
 */
export function installSunCascades(): boolean {
  if (installed !== null) return installed
  const patched = patchLightsChunk(THREE.ShaderChunk.lights_fragment_begin)
  if (patched) THREE.ShaderChunk.lights_fragment_begin = patched
  else console.warn('[sunCascades] three lighting chunk changed; using a single shadow map')
  installed = !!patched
  return installed
}
