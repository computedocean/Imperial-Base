// Compress the Blender-built models in public/models in place (run after any tools/blender build):
//   node scripts/optimize-models.mjs            every .glb in public/models
//   node scripts/optimize-models.mjs <dir|file> another folder, or one file
//
// Each GLB is de-duplicated, its vertices reordered for compression, positions and normals quantised, and the
// buffers packed with Meshopt (EXT_meshopt_compression). Texture coordinates are left as floats on purpose: the
// app re-binds materials by name, so a UV transform stored on the GLB's own materials would be lost. For the same
// reason materials are never merged and unused-looking attributes (the lightmap UVs) are never pruned; the script
// checks that every primitive keeps its material name and attributes, and stops if not.
// Files that are already compressed are skipped, so the script is safe to run twice.
// The app's loaders decode Meshopt (drei's useGLTF does by default; vehicles/models.ts sets the decoder).
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, quantize, reorder } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(process.argv[2] ?? join(here, '..', 'public', 'models'))
const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith('.glb')).map((f) => join(target, f)) : [target]

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

/** Material names and vertex attributes of every primitive: what the app binds to, so it must not change. */
function signature(doc) {
  return doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => `${p.getMaterial()?.getName()}:${p.listSemantics().sort().join(',')}`)).sort().join(' | ')
}

let before = 0
let after = 0
for (const file of files) {
  const size = statSync(file).size
  const doc = await io.read(file)
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) {
    console.log(`skip   ${file.split(/[\\/]/).pop()} (already compressed)`)
    before += size
    after += size
    continue
  }
  const before_ = signature(doc)
  await doc.transform(
    // accessors and meshes only: the materials are identical placeholders told apart by NAME, so they must survive
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ pattern: /^(POSITION|NORMAL)(_\d+)?$/, quantizePosition: 14, quantizeNormal: 10 }),
  )
  if (signature(doc) !== before_) throw new Error(`${file}: materials or vertex attributes changed:
${before_}
${signature(doc)}`)
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  await io.write(file, doc)
  const now = statSync(file).size
  before += size
  after += now
  console.log(`${(size / 1024).toFixed(0).padStart(6)} KB -> ${(now / 1024).toFixed(0).padStart(5)} KB  ${file.split(/[\\/]/).pop()}`)
}
console.log(`total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`)
