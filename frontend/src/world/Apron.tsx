// Ferrocrete apron covering the whole installation. Two texture scales are combined in one material:
// a tiled 24 m detail set (slab seams, aggregate, cracks — colour + normal + roughness) and a single
// macro texture spanning the base (slab-to-slab tone, contact grime, scorch, tyre marks, paint, sand
// drifts) multiplied in via a small onBeforeCompile patch. One draw call.
import { useMemo } from 'react'
import * as THREE from 'three'
import { PERIMETER_RADIUS, perimeterVertices } from './layout'
import { APRON_EXTENT, APRON_TILE, apronDetail, apronMacro } from './textures'

export function Apron() {
  const geometry = useMemo(() => {
    const oct = perimeterVertices(PERIMETER_RADIUS + 6)
    // ShapeGeometry lies in XY; rotateX(-90°) maps shape (x, y) → world (x, 0, -y), so feed (x, -z)
    const shape = new THREE.Shape(oct.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ShapeGeometry(shape, 1)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / APRON_TILE, pos.getZ(i) / APRON_TILE)
    g.computeVertexNormals()
    return g
  }, [])

  const material = useMemo(() => {
    const d = apronDetail()
    const macro = apronMacro()
    const m = new THREE.MeshStandardMaterial({
      map: d.map,
      normalMap: d.normal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: d.rough,
      roughness: 0.95,
      metalness: 0.02,
      envMapIntensity: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: 1, // decals (roads, pad markings) sit in front of the apron
      polygonOffsetUnits: 1,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.macroMap = { value: macro }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvMacroUv = (modelMatrix * vec4(transformed, 1.0)).xz / ${APRON_EXTENT.toFixed(1)} + 0.5; // canvas is drawn with +z at row 0 and uploaded flipY → v = 0.5 + z / E`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;\nvarying vec2 vMacroUv;\nvec4 gMacroTex;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n  gMacroTex = texture2D(macroMap, vMacroUv);\n  diffuseColor.rgb *= gMacroTex.rgb * 2.0;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  float macroLuma = dot(gMacroTex.rgb, vec3(0.299, 0.587, 0.114));\n  float sheen = smoothstep(0.48, 0.16, macroLuma) * 0.48;\n  roughnessFactor = clamp(roughnessFactor - sheen, 0.22, 1.0);')
    }
    m.customProgramCacheKey = () => 'imperial-apron-v2'
    return m
  }, [])

  return <mesh geometry={geometry} material={material} position={[0, 0.03, 0]} receiveShadow name="apron" />
}
