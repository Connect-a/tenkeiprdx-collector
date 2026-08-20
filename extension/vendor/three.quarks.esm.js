/**
 * three.quarks v0.17.0 build Wed May 20 2026
 * https://quarks.art
 * Copyright 2026 Alchemist0823 <the.forrest.sun@gmail.com>, MIT
 */
import { Triangle, Vector3, ShaderChunk as ShaderChunk$1, Object3D, Mesh, Layers, PlaneGeometry, MeshBasicMaterial, DoubleSide, AdditiveBlending, MeshPhysicalMaterial, MeshStandardMaterial, InstancedBufferAttribute, DynamicDrawUsage, InstancedBufferGeometry, Uniform, ShaderMaterial, BufferGeometry, BufferAttribute, Group, Clock, AnimationMixer, LoopOnce, ObjectLoader, Bone, Sprite, Points, LineSegments, LineLoop, Line, LOD, BatchedMesh, Box3, Sphere, InstancedMesh, SkinnedMesh, LightProbe, SphericalHarmonics3, HemisphereLight, SpotLight, RectAreaLight, PointLight, DirectionalLight, AmbientLight, OrthographicCamera, PerspectiveCamera, Scene, Color, Fog, FogExp2 } from './three.module.js';
import { Vector3 as Vector3$1, Quaternion, ConstantValue, AxisAngleGenerator, Matrix3, ConstantColor, Vector4, SphereEmitter, TrailParticle, SpriteParticle, EmitterFromJSON, ValueGeneratorFromJSON, ColorGeneratorFromJSON, GeneratorFromJSON, BehaviorFromJSON, Vector2, EmitSubParticleSystem, loadPlugin } from './quarks.core.esm.js';
export * from './quarks.core.esm.js';

class MeshSurfaceEmitter {
    get geometry() {
        return this._geometry;
    }
    set geometry(geometry) {
        this._geometry = geometry;
        if (geometry === undefined) {
            return;
        }
        if (typeof geometry === 'string') {
            return;
        }
        const tri = new Triangle();
        this._triangleIndexToArea.length = 0;
        let area = 0;
        if (!geometry.getIndex()) {
            return;
        }
        const array = geometry.getIndex().array;
        const triCount = array.length / 3;
        this._triangleIndexToArea.push(0);
        for (let i = 0; i < triCount; i++) {
            tri.setFromAttributeAndIndices(geometry.getAttribute('position'), array[i * 3], array[i * 3 + 1], array[i * 3 + 2]);
            area += tri.getArea();
            this._triangleIndexToArea.push(area);
        }
        geometry.userData.triangleIndexToArea = this._triangleIndexToArea;
    }
    constructor(geometry) {
        this.type = 'mesh_surface';
        this._triangleIndexToArea = [];
        this._tempA = new Vector3();
        this._tempB = new Vector3();
        this._tempC = new Vector3();
        if (!geometry) {
            return;
        }
        this.geometry = geometry;
    }
    initialize(p) {
        const geometry = this._geometry;
        if (!geometry || geometry.getIndex() === null) {
            p.position.set(0, 0, 0);
            p.velocity.set(0, 0, 1).multiplyScalar(p.startSpeed);
            return;
        }
        const triCount = this._triangleIndexToArea.length - 1;
        let left = 0, right = triCount;
        const target = Math.random() * this._triangleIndexToArea[triCount];
        while (left + 1 < right) {
            const mid = Math.floor((left + right) / 2);
            if (target < this._triangleIndexToArea[mid]) {
                right = mid;
            }
            else {
                left = mid;
            }
        }
        let u1 = Math.random();
        let u2 = Math.random();
        if (u1 + u2 > 1) {
            u1 = 1 - u1;
            u2 = 1 - u2;
        }
        const index1 = geometry.getIndex().array[left * 3];
        const index2 = geometry.getIndex().array[left * 3 + 1];
        const index3 = geometry.getIndex().array[left * 3 + 2];
        const positionBuffer = geometry.getAttribute('position');
        this._tempA.fromBufferAttribute(positionBuffer, index1);
        this._tempB.fromBufferAttribute(positionBuffer, index2);
        this._tempC.fromBufferAttribute(positionBuffer, index3);
        this._tempB.sub(this._tempA);
        this._tempC.sub(this._tempA);
        this._tempA.addScaledVector(this._tempB, u1).addScaledVector(this._tempC, u2);
        p.position.copy(this._tempA);
        this._tempA.copy(this._tempB).cross(this._tempC).normalize();
        p.velocity.copy(this._tempA).normalize().multiplyScalar(p.startSpeed);
    }
    toJSON() {
        return {
            type: 'mesh_surface',
            mesh: this._geometry ? this._geometry.uuid : '',
        };
    }
    static fromJSON(json, meta) {
        return new MeshSurfaceEmitter(meta.geometries[json.geometry]);
    }
    clone() {
        return new MeshSurfaceEmitter(this._geometry);
    }
    update(system, delta) { }
}
const MeshSurfaceEmitterPlugin = {
    id: "three.quarks",
    initialize: () => { },
    emitterShapes: [{
            type: 'mesh_surface',
            params: [['geometry', ['geometry']]],
            constructor: MeshSurfaceEmitter,
            loadJSON: MeshSurfaceEmitter.fromJSON,
        }],
    behaviors: [],
};

var soft_fragment = `
#ifdef SOFT_PARTICLES

    /* #ifdef LOGDEPTH
    float distSample = linearize_depth_log(sampleDepth, near, far);
    #else
    float distSample = ortho ? linearize_depth_ortho(sampleDepth, near, far) : linearize_depth(sampleDepth, near, far);
    #endif */

    vec2 p2 = projPosition.xy / projPosition.w;
    
    p2 = 0.5 * p2 + 0.5;

    float readDepth = texture2D(depthTexture, p2.xy).r;
    float viewDepth = linearize_depth(readDepth);

    float softParticlesFade = saturate(SOFT_INV_FADE_DISTANCE * ((viewDepth - SOFT_NEAR_FADE) - linearDepth));
    
    gl_FragColor *= softParticlesFade;

    //gl_FragColor = vec4(softParticlesFade , 0, 0, 1);
#endif
`;

var soft_pars_fragment = `
#ifdef SOFT_PARTICLES

    uniform sampler2D depthTexture;
    uniform vec4 projParams;
    uniform vec2 softParams;

    varying vec4 projPosition;
    varying float linearDepth;

    #define SOFT_NEAR_FADE softParams.x
    #define SOFT_INV_FADE_DISTANCE softParams.y

    #define zNear projParams.x
    #define zFar projParams.y

    float linearize_depth(float d)
    {
        return (zFar * zNear) / (zFar - d * (zFar - zNear));
    }

#endif
`;

var soft_pars_vertex = `
#ifdef SOFT_PARTICLES
    varying vec4 projPosition;
    varying float linearDepth;
#endif
`;

var soft_vertex = `
#ifdef SOFT_PARTICLES
    projPosition = gl_Position;
    linearDepth = -mvPosition.z;
#endif
`;

var tile_fragment = `
#ifdef USE_MAP
    vec4 texelColor = texture2D( map, vUv);
    #ifdef TILE_BLEND
        texelColor = mix( texelColor, texture2D( map, vUvNext ), vUvBlend );
    #endif
    diffuseColor *= texelColor;
#endif
`;

var tile_pars_fragment = `
#if defined( USE_UV ) || defined( USE_ANISOTROPY )

\tvarying vec2 vUv;
#ifdef TILE_BLEND
    varying vec2 vUvNext;
    varying float vUvBlend;
#endif

#endif
#ifdef USE_MAP

\tuniform mat3 mapTransform;
\tvarying vec2 vMapUv;
#ifdef TILE_BLEND
    varying vec2 vMapUvNext;
#endif

#endif
#ifdef USE_ALPHAMAP

\tuniform mat3 alphaMapTransform;
\tvarying vec2 vAlphaMapUv;

#endif
#ifdef USE_LIGHTMAP

\tuniform mat3 lightMapTransform;
\tvarying vec2 vLightMapUv;

#endif
#ifdef USE_AOMAP

\tuniform mat3 aoMapTransform;
\tvarying vec2 vAoMapUv;

#endif
#ifdef USE_BUMPMAP

\tuniform mat3 bumpMapTransform;
\tvarying vec2 vBumpMapUv;

#endif
#ifdef USE_NORMALMAP

\tuniform mat3 normalMapTransform;
\tvarying vec2 vNormalMapUv;

#endif
#ifdef USE_DISPLACEMENTMAP

\tuniform mat3 displacementMapTransform;
\tvarying vec2 vDisplacementMapUv;

#endif
#ifdef USE_EMISSIVEMAP

\tuniform mat3 emissiveMapTransform;
\tvarying vec2 vEmissiveMapUv;

#endif
#ifdef USE_METALNESSMAP

\tuniform mat3 metalnessMapTransform;
\tvarying vec2 vMetalnessMapUv;

#endif
#ifdef USE_ROUGHNESSMAP

\tuniform mat3 roughnessMapTransform;
\tvarying vec2 vRoughnessMapUv;

#endif
#ifdef USE_ANISOTROPYMAP

\tuniform mat3 anisotropyMapTransform;
\tvarying vec2 vAnisotropyMapUv;

#endif
#ifdef USE_CLEARCOATMAP

\tuniform mat3 clearcoatMapTransform;
\tvarying vec2 vClearcoatMapUv;

#endif
#ifdef USE_CLEARCOAT_NORMALMAP

\tuniform mat3 clearcoatNormalMapTransform;
\tvarying vec2 vClearcoatNormalMapUv;

#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP

\tuniform mat3 clearcoatRoughnessMapTransform;
\tvarying vec2 vClearcoatRoughnessMapUv;

#endif
#ifdef USE_SHEEN_COLORMAP

\tuniform mat3 sheenColorMapTransform;
\tvarying vec2 vSheenColorMapUv;

#endif
#ifdef USE_SHEEN_ROUGHNESSMAP

\tuniform mat3 sheenRoughnessMapTransform;
\tvarying vec2 vSheenRoughnessMapUv;

#endif
#ifdef USE_IRIDESCENCEMAP

\tuniform mat3 iridescenceMapTransform;
\tvarying vec2 vIridescenceMapUv;

#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP

\tuniform mat3 iridescenceThicknessMapTransform;
\tvarying vec2 vIridescenceThicknessMapUv;

#endif
#ifdef USE_SPECULARMAP

\tuniform mat3 specularMapTransform;
\tvarying vec2 vSpecularMapUv;

#endif
#ifdef USE_SPECULAR_COLORMAP

\tuniform mat3 specularColorMapTransform;
\tvarying vec2 vSpecularColorMapUv;

#endif
#ifdef USE_SPECULAR_INTENSITYMAP

\tuniform mat3 specularIntensityMapTransform;
\tvarying vec2 vSpecularIntensityMapUv;

#endif
#ifdef USE_TRANSMISSIONMAP

\tuniform mat3 transmissionMapTransform;
\tvarying vec2 vTransmissionMapUv;

#endif
#ifdef USE_THICKNESSMAP

\tuniform mat3 thicknessMapTransform;
\tvarying vec2 vThicknessMapUv;

#endif
`;

var tile_pars_vertex = `
#ifdef UV_TILE
    attribute float uvTile;
    uniform vec2 tileCount;
    
    mat3 makeTileTransform(float uvTile) {
        float col = mod(uvTile, tileCount.x);
        float row = (tileCount.y - floor(uvTile / tileCount.x) - 1.0);
        
        return mat3(
          1.0 / tileCount.x, 0.0, 0.0,
          0.0, 1.0 / tileCount.y, 0.0, 
          col / tileCount.x, row / tileCount.y, 1.0);
    }
#else
    mat3 makeTileTransform(float uvTile) {
        return mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
    }
#endif

#if defined( USE_UV ) || defined( USE_ANISOTROPY )

\tvarying vec2 vUv;
#ifdef TILE_BLEND
    varying vec2 vUvNext;
    varying float vUvBlend;
#endif

#endif
#ifdef USE_MAP

\tuniform mat3 mapTransform;
\tvarying vec2 vMapUv;
#ifdef TILE_BLEND
    varying vec2 vMapUvNext;
#endif

#endif
#ifdef USE_ALPHAMAP

\tuniform mat3 alphaMapTransform;
\tvarying vec2 vAlphaMapUv;

#endif
#ifdef USE_LIGHTMAP

\tuniform mat3 lightMapTransform;
\tvarying vec2 vLightMapUv;

#endif
#ifdef USE_AOMAP

\tuniform mat3 aoMapTransform;
\tvarying vec2 vAoMapUv;

#endif
#ifdef USE_BUMPMAP

\tuniform mat3 bumpMapTransform;
\tvarying vec2 vBumpMapUv;

#endif
#ifdef USE_NORMALMAP

\tuniform mat3 normalMapTransform;
\tvarying vec2 vNormalMapUv;

#endif
#ifdef USE_DISPLACEMENTMAP

\tuniform mat3 displacementMapTransform;
\tvarying vec2 vDisplacementMapUv;

#endif
#ifdef USE_EMISSIVEMAP

\tuniform mat3 emissiveMapTransform;
\tvarying vec2 vEmissiveMapUv;

#endif
#ifdef USE_METALNESSMAP

\tuniform mat3 metalnessMapTransform;
\tvarying vec2 vMetalnessMapUv;

#endif
#ifdef USE_ROUGHNESSMAP

\tuniform mat3 roughnessMapTransform;
\tvarying vec2 vRoughnessMapUv;

#endif
#ifdef USE_ANISOTROPYMAP

\tuniform mat3 anisotropyMapTransform;
\tvarying vec2 vAnisotropyMapUv;

#endif
#ifdef USE_CLEARCOATMAP

\tuniform mat3 clearcoatMapTransform;
\tvarying vec2 vClearcoatMapUv;

#endif
#ifdef USE_CLEARCOAT_NORMALMAP

\tuniform mat3 clearcoatNormalMapTransform;
\tvarying vec2 vClearcoatNormalMapUv;

#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP

\tuniform mat3 clearcoatRoughnessMapTransform;
\tvarying vec2 vClearcoatRoughnessMapUv;

#endif
#ifdef USE_SHEEN_COLORMAP

\tuniform mat3 sheenColorMapTransform;
\tvarying vec2 vSheenColorMapUv;

#endif
#ifdef USE_SHEEN_ROUGHNESSMAP

\tuniform mat3 sheenRoughnessMapTransform;
\tvarying vec2 vSheenRoughnessMapUv;

#endif
#ifdef USE_IRIDESCENCEMAP

\tuniform mat3 iridescenceMapTransform;
\tvarying vec2 vIridescenceMapUv;

#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP

\tuniform mat3 iridescenceThicknessMapTransform;
\tvarying vec2 vIridescenceThicknessMapUv;

#endif
#ifdef USE_SPECULARMAP

\tuniform mat3 specularMapTransform;
\tvarying vec2 vSpecularMapUv;

#endif
#ifdef USE_SPECULAR_COLORMAP

\tuniform mat3 specularColorMapTransform;
\tvarying vec2 vSpecularColorMapUv;

#endif
#ifdef USE_SPECULAR_INTENSITYMAP

\tuniform mat3 specularIntensityMapTransform;
\tvarying vec2 vSpecularIntensityMapUv;

#endif
#ifdef USE_TRANSMISSIONMAP

\tuniform mat3 transmissionMapTransform;
\tvarying vec2 vTransmissionMapUv;

#endif
#ifdef USE_THICKNESSMAP

\tuniform mat3 thicknessMapTransform;
\tvarying vec2 vThicknessMapUv;

#endif
`;

var tile_vertex = `
#ifdef UV_TILE
    mat3 tileTransform = makeTileTransform(floor(uvTile));
    #ifdef TILE_BLEND
        mat3 nextTileTransform = makeTileTransform(ceil(uvTile));
        vUvBlend = fract(uvTile);
    #endif
#else
    mat3 tileTransform = makeTileTransform(0.0);
#endif

#if defined( USE_UV ) || defined( USE_ANISOTROPY )

vUv = (tileTransform *vec3( uv, 1 )).xy;
#if defined( TILE_BLEND ) && defined( UV_TILE )
    vUvNext = (nextTileTransform *vec3( uv, 1 )).xy;
#endif

#endif
#ifdef USE_MAP

vMapUv = ( tileTransform * (mapTransform * vec3( MAP_UV, 1 ) )).xy;
#if defined( TILE_BLEND ) && defined( UV_TILE )
    vMapUvNext = (nextTileTransform * (mapTransform * vec3( MAP_UV, 1 ))).xy;
#endif

#endif
#ifdef USE_ALPHAMAP

vAlphaMapUv = ( tileTransform * (alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) )).xy;
    
#endif
#ifdef USE_LIGHTMAP

vLightMapUv = ( tileTransform * (lightMapTransform * vec3( LIGHTMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_AOMAP

vAoMapUv = ( tileTransform * (aoMapTransform * vec3( AOMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_BUMPMAP

vBumpMapUv = ( tileTransform * (bumpMapTransform * vec3( BUMPMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_NORMALMAP

vNormalMapUv = ( tileTransform * (normalMapTransform * vec3( NORMALMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_DISPLACEMENTMAP

vDisplacementMapUv = ( tileTransform * (displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_EMISSIVEMAP

vEmissiveMapUv = ( tileTransform * (emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_METALNESSMAP

vMetalnessMapUv = ( tileTransform * (metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_ROUGHNESSMAP

vRoughnessMapUv = ( tileTransform * (roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_ANISOTROPYMAP

vAnisotropyMapUv = ( tileTransform * (anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_CLEARCOATMAP

vClearcoatMapUv = ( tileTransform * (clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_CLEARCOAT_NORMALMAP

vClearcoatNormalMapUv = ( tileTransform * (clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP

vClearcoatRoughnessMapUv = ( tileTransform * (clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_IRIDESCENCEMAP

vIridescenceMapUv = ( tileTransform * (iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP

vIridescenceThicknessMapUv = ( tileTransform * (iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_SHEEN_COLORMAP

vSheenColorMapUv = ( tileTransform * (sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_SHEEN_ROUGHNESSMAP

vSheenRoughnessMapUv = ( tileTransform * (sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_SPECULARMAP

vSpecularMapUv = ( tileTransform * (specularMapTransform * vec3( SPECULARMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_SPECULAR_COLORMAP

vSpecularColorMapUv = ( tileTransform * (specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_SPECULAR_INTENSITYMAP

vSpecularIntensityMapUv = ( tileTransform * (specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_TRANSMISSIONMAP

vTransmissionMapUv = ( tileTransform * transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) )).xy;

#endif
#ifdef USE_THICKNESSMAP

vThicknessMapUv = ( tileTransform * thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) )).xy;

#endif

`;

const ShaderChunk = ShaderChunk$1;
function registerShaderChunks() {
    ShaderChunk['tile_pars_vertex'] = tile_pars_vertex;
    ShaderChunk['tile_vertex'] = tile_vertex;
    ShaderChunk['tile_pars_fragment'] = tile_pars_fragment;
    ShaderChunk['tile_fragment'] = tile_fragment;
    ShaderChunk['soft_pars_vertex'] = soft_pars_vertex;
    ShaderChunk['soft_vertex'] = soft_vertex;
    ShaderChunk['soft_pars_fragment'] = soft_pars_fragment;
    ShaderChunk['soft_fragment'] = soft_fragment;
}

class ParticleEmitter extends Object3D {
    constructor(system) {
        super();
        this.type = 'ParticleEmitter';
        this.system = system;
    }
    clone() {
        const system = this.system.clone();
        system.emitter.copy(this, true);
        return system.emitter;
    }
    dispose() { }
    extractFromCache(cache) {
        const values = [];
        for (const key in cache) {
            const data = cache[key];
            delete data.metadata;
            values.push(data);
        }
        return values;
    }
    toJSON(meta, options = {}) {
        const children = this.children;
        this.children = this.children.filter((child) => child.type !== 'ParticleSystemPreview');
        const data = super.toJSON(meta);
        this.children = children;
        if (this.system !== null)
            data.object.ps = this.system.toJSON(meta, options);
        return data;
    }
}

var RenderMode;
(function (RenderMode) {
    RenderMode[RenderMode["BillBoard"] = 0] = "BillBoard";
    RenderMode[RenderMode["StretchedBillBoard"] = 1] = "StretchedBillBoard";
    RenderMode[RenderMode["Mesh"] = 2] = "Mesh";
    RenderMode[RenderMode["Trail"] = 3] = "Trail";
    RenderMode[RenderMode["HorizontalBillBoard"] = 4] = "HorizontalBillBoard";
    RenderMode[RenderMode["VerticalBillBoard"] = 5] = "VerticalBillBoard";
})(RenderMode || (RenderMode = {}));
class VFXBatch extends Mesh {
    constructor(settings) {
        super();
        this.type = 'VFXBatch';
        this.maxParticles = 1000;
        this.systems = new Set();
        const layers = new Layers();
        layers.mask = settings.layers.mask;
        const newMat = settings.material.clone();
        newMat.defines = {};
        Object.assign(newMat.defines, settings.material.defines);
        this.settings = {
            instancingGeometry: settings.instancingGeometry,
            renderMode: settings.renderMode,
            renderOrder: settings.renderOrder,
            material: newMat,
            uTileCount: settings.uTileCount,
            vTileCount: settings.vTileCount,
            blendTiles: settings.blendTiles,
            softParticles: settings.softParticles,
            softNearFade: settings.softNearFade,
            softFarFade: settings.softFarFade,
            layers: layers,
        };
        this.frustumCulled = false;
        this.renderOrder = this.settings.renderOrder;
    }
    addSystem(system) {
        this.systems.add(system);
    }
    removeSystem(system) {
        this.systems.delete(system);
    }
    applyDepthTexture(depthTexture) {
        const uniform = this.material.uniforms['depthTexture'];
        if (uniform) {
            if (uniform.value !== depthTexture) {
                uniform.value = depthTexture;
                this.material.needsUpdate = true;
            }
        }
    }
    getVisibleSystems() {
        return Array.from(this.systems).filter((system) => system.emitter.visible);
    }
}

const UP = new Vector3$1(0, 0, 1);
const tempQ = new Quaternion();
const tempV = new Vector3$1();
const tempV2 = new Vector3$1();
new Vector3$1();
const PREWARM_FPS = 60;
const DEFAULT_GEOMETRY = new PlaneGeometry(1, 1, 1, 1);
class ParticleSystem {
    set time(time) {
        this.emissionState.time = time;
    }
    get time() {
        return this.emissionState.time;
    }
    get layers() {
        return this.rendererSettings.layers;
    }
    get texture() {
        return this.rendererSettings.material.map;
    }
    set texture(texture) {
        this.rendererSettings.material.map = texture;
        this.neededToUpdateRender = true;
    }
    get material() {
        return this.rendererSettings.material;
    }
    set material(material) {
        this.rendererSettings.material = material;
        this.neededToUpdateRender = true;
    }
    get uTileCount() {
        return this.rendererSettings.uTileCount;
    }
    set uTileCount(u) {
        this.rendererSettings.uTileCount = u;
        this.neededToUpdateRender = true;
    }
    get vTileCount() {
        return this.rendererSettings.vTileCount;
    }
    set vTileCount(v) {
        this.rendererSettings.vTileCount = v;
        this.neededToUpdateRender = true;
    }
    get blendTiles() {
        return this.rendererSettings.blendTiles;
    }
    set blendTiles(v) {
        this.rendererSettings.blendTiles = v;
        this.neededToUpdateRender = true;
    }
    get softParticles() {
        return this.rendererSettings.softParticles;
    }
    set softParticles(v) {
        this.rendererSettings.softParticles = v;
        this.neededToUpdateRender = true;
    }
    get softNearFade() {
        return this.rendererSettings.softNearFade;
    }
    set softNearFade(v) {
        this.rendererSettings.softNearFade = v;
        this.neededToUpdateRender = true;
    }
    get softFarFade() {
        return this.rendererSettings.softFarFade;
    }
    set softFarFade(v) {
        this.rendererSettings.softFarFade = v;
        this.neededToUpdateRender = true;
    }
    get instancingGeometry() {
        return this.rendererSettings.instancingGeometry;
    }
    set instancingGeometry(geometry) {
        this.restart();
        this.particles.length = 0;
        this.rendererSettings.instancingGeometry = geometry;
        this.neededToUpdateRender = true;
    }
    get renderMode() {
        return this.rendererSettings.renderMode;
    }
    set renderMode(renderMode) {
        if (this.rendererSettings.renderMode !== renderMode) {
            let needRestart = false;
            if (this.rendererSettings.renderMode === RenderMode.Trail) {
                needRestart = true;
            }
            if (this.rendererSettings.renderMode === RenderMode.Mesh) {
                this.startRotation = new ConstantValue(0);
            }
            switch (renderMode) {
                case RenderMode.Trail:
                    this.rendererEmitterSettings = {
                        startLength: new ConstantValue(30),
                        followLocalOrigin: false,
                    };
                    needRestart = true;
                    break;
                case RenderMode.Mesh:
                    this.rendererEmitterSettings = {
                        geometry: DEFAULT_GEOMETRY,
                    };
                    this.startRotation = new AxisAngleGenerator(new Vector3$1(0, 1, 0), new ConstantValue(0));
                    break;
                case RenderMode.StretchedBillBoard:
                    this.rendererEmitterSettings = { speedFactor: 0, lengthFactor: 2 };
                    this.rendererSettings.instancingGeometry = DEFAULT_GEOMETRY;
                    break;
                case RenderMode.BillBoard:
                case RenderMode.VerticalBillBoard:
                case RenderMode.HorizontalBillBoard:
                    this.rendererEmitterSettings = {};
                    this.rendererSettings.instancingGeometry = DEFAULT_GEOMETRY;
                    break;
            }
            this.rendererSettings.renderMode = renderMode;
            if (needRestart) {
                this.restart();
                this.particles.length = 0;
            }
            this.neededToUpdateRender = true;
        }
    }
    get renderOrder() {
        return this.rendererSettings.renderOrder;
    }
    set renderOrder(renderOrder) {
        this.rendererSettings.renderOrder = renderOrder;
        this.neededToUpdateRender = true;
    }
    get blending() {
        return this.rendererSettings.material.blending;
    }
    set blending(blending) {
        this.rendererSettings.material.blending = blending;
        this.neededToUpdateRender = true;
    }
    constructor(parameters) {
        this.temp = new Vector3$1();
        this.travelDistance = 0;
        this.normalMatrix = new Matrix3();
        this.memory = [];
        this.listeners = {};
        this.firstTimeUpdate = true;
        this.autoDestroy = parameters.autoDestroy === undefined ? false : parameters.autoDestroy;
        this.duration = parameters.duration ?? 1;
        this.looping = parameters.looping === undefined ? true : parameters.looping;
        this.prewarm = parameters.prewarm === undefined ? false : parameters.prewarm;
        this.startLife = parameters.startLife ?? new ConstantValue(5);
        this.startSpeed = parameters.startSpeed ?? new ConstantValue(0);
        this.startRotation = parameters.startRotation ?? new ConstantValue(0);
        this.startSize = parameters.startSize ?? new ConstantValue(1);
        this.startColor = parameters.startColor ?? new ConstantColor(new Vector4(1, 1, 1, 1));
        this.emissionOverTime = parameters.emissionOverTime ?? new ConstantValue(10);
        this.emissionOverDistance = parameters.emissionOverDistance ?? new ConstantValue(0);
        this.emissionBursts = parameters.emissionBursts ?? [];
        this.onlyUsedByOther = parameters.onlyUsedByOther ?? false;
        this.emitterShape = parameters.shape ?? new SphereEmitter();
        this.behaviors = parameters.behaviors ?? new Array();
        this.worldSpace = parameters.worldSpace ?? false;
        this.rendererEmitterSettings = parameters.rendererEmitterSettings ?? {};
        if (parameters.renderMode === RenderMode.StretchedBillBoard) {
            const stretchedBillboardSettings = this.rendererEmitterSettings;
            if (parameters.speedFactor !== undefined) {
                stretchedBillboardSettings.speedFactor = parameters.speedFactor;
            }
            stretchedBillboardSettings.speedFactor = stretchedBillboardSettings.speedFactor ?? 0;
            stretchedBillboardSettings.lengthFactor = stretchedBillboardSettings.lengthFactor ?? 0;
        }
        this.rendererSettings = {
            instancingGeometry: parameters.instancingGeometry ?? DEFAULT_GEOMETRY,
            renderMode: parameters.renderMode ?? RenderMode.BillBoard,
            renderOrder: parameters.renderOrder ?? 0,
            material: parameters.material,
            uTileCount: parameters.uTileCount ?? 1,
            vTileCount: parameters.vTileCount ?? 1,
            blendTiles: parameters.blendTiles ?? false,
            softParticles: parameters.softParticles ?? false,
            softNearFade: parameters.softNearFade ?? 0,
            softFarFade: parameters.softFarFade ?? 0,
            layers: parameters.layers ?? new Layers(),
        };
        this.neededToUpdateRender = true;
        this.particles = new Array();
        this.startTileIndex = parameters.startTileIndex || new ConstantValue(0);
        this.emitter = new ParticleEmitter(this);
        this.paused = false;
        this.particleNum = 0;
        this.emissionState = {
            isBursting: false,
            burstParticleIndex: 0,
            burstParticleCount: 0,
            burstIndex: 0,
            burstWaveIndex: 0,
            time: 0,
            waitEmiting: 0,
            travelDistance: 0,
        };
        this.emissionBursts.forEach((burst) => burst.count.startGen(this.memory));
        this.emissionOverDistance.startGen(this.memory);
        this.emitEnded = false;
        this.markForDestroy = false;
        this.prewarmed = false;
    }
    pause() {
        this.paused = true;
    }
    play() {
        this.paused = false;
    }
    stop() {
        this.restart();
        this.pause();
    }
    spawn(count, emissionState, matrix) {
        tempQ.setFromRotationMatrix(matrix);
        const translation = tempV;
        const quaternion = tempQ;
        const scale = tempV2;
        matrix.decompose(translation, quaternion, scale);
        for (let i = 0; i < count; i++) {
            emissionState.burstParticleIndex = i;
            this.particleNum++;
            while (this.particles.length < this.particleNum) {
                if (this.rendererSettings.renderMode === RenderMode.Trail) {
                    this.particles.push(new TrailParticle());
                }
                else {
                    this.particles.push(new SpriteParticle());
                }
            }
            const particle = this.particles[this.particleNum - 1];
            particle.reset();
            particle.speedModifier = 1;
            this.startColor.startGen(particle.memory);
            this.startColor.genColor(particle.memory, particle.startColor, this.emissionState.time);
            particle.color.copy(particle.startColor);
            this.startSpeed.startGen(particle.memory);
            particle.startSpeed = this.startSpeed.genValue(particle.memory, emissionState.time / this.duration);
            this.startLife.startGen(particle.memory);
            particle.life = this.startLife.genValue(particle.memory, emissionState.time / this.duration);
            particle.age = 0;
            this.startSize.startGen(particle.memory);
            if (this.startSize.type === "vec3function") {
                this.startSize.genValue(particle.memory, particle.startSize, emissionState.time / this.duration);
            }
            else {
                const size = this.startSize.genValue(particle.memory, emissionState.time / this.duration);
                particle.startSize.set(size, size, size);
            }
            this.startTileIndex.startGen(particle.memory);
            particle.uvTile = this.startTileIndex.genValue(particle.memory);
            particle.size.copy(particle.startSize);
            if (this.rendererSettings.renderMode === RenderMode.Mesh ||
                this.rendererSettings.renderMode === RenderMode.BillBoard ||
                this.rendererSettings.renderMode === RenderMode.VerticalBillBoard ||
                this.rendererSettings.renderMode === RenderMode.HorizontalBillBoard ||
                this.rendererSettings.renderMode === RenderMode.StretchedBillBoard) {
                const sprite = particle;
                this.startRotation.startGen(particle.memory);
                if (this.rendererSettings.renderMode === RenderMode.Mesh) {
                    if (!(sprite.rotation instanceof Quaternion)) {
                        sprite.rotation = new Quaternion();
                    }
                    if (this.startRotation.type === 'rotation') {
                        this.startRotation.genValue(particle.memory, sprite.rotation, 1, emissionState.time / this.duration);
                    }
                    else {
                        sprite.rotation.setFromAxisAngle(UP, this.startRotation.genValue(sprite.memory, (emissionState.time / this.duration)));
                    }
                }
                else {
                    if (this.startRotation.type === 'rotation') {
                        sprite.rotation = 0;
                    }
                    else {
                        sprite.rotation = this.startRotation.genValue(sprite.memory, emissionState.time / this.duration);
                    }
                }
            }
            else if (this.rendererSettings.renderMode === RenderMode.Trail) {
                const trail = particle;
                this.rendererEmitterSettings.startLength.startGen(trail.memory);
                trail.length = this.rendererEmitterSettings.startLength.genValue(trail.memory, emissionState.time / this.duration);
            }
            this.emitterShape.initialize(particle, emissionState);
            if (this.rendererSettings.renderMode === RenderMode.Trail &&
                this.rendererEmitterSettings.followLocalOrigin) {
                const trail = particle;
                trail.localPosition = new Vector3$1().copy(trail.position);
            }
            if (this.worldSpace) {
                particle.position.applyMatrix4(matrix);
                particle.startSize.multiply(scale).abs();
                particle.size.copy(particle.startSize);
                particle.velocity.multiply(scale).applyMatrix3(this.normalMatrix);
                if (particle.rotation && particle.rotation instanceof Quaternion) {
                    particle.rotation.multiplyQuaternions(tempQ, particle.rotation);
                }
            }
            else {
                if (this.onlyUsedByOther) {
                    particle.parentMatrix = matrix;
                }
            }
            for (let j = 0; j < this.behaviors.length; j++) {
                this.behaviors[j].initialize(particle, this);
            }
        }
    }
    endEmit() {
        this.emitEnded = true;
        if (this.autoDestroy) {
            this.markForDestroy = true;
        }
        this.fire({ type: "emitEnd", particleSystem: this });
    }
    dispose() {
        if (this._renderer)
            this._renderer.deleteSystem(this);
        this.emitter.dispose();
        if (this.emitter.parent)
            this.emitter.parent.remove(this.emitter);
        this.fire({ type: "destroy", particleSystem: this });
    }
    restart() {
        this.memory.length = 0;
        this.paused = false;
        this.particleNum = 0;
        this.emissionState.isBursting = false;
        this.emissionState.burstIndex = 0;
        this.emissionState.burstWaveIndex = 0;
        this.emissionState.time = 0;
        this.emissionState.waitEmiting = 0;
        this.behaviors.forEach((behavior) => {
            behavior.reset();
        });
        this.emitEnded = false;
        this.markForDestroy = false;
        this.prewarmed = false;
        this.emissionBursts.forEach((burst) => burst.count.startGen(this.memory));
        this.emissionOverDistance.startGen(this.memory);
    }
    update(delta) {
        if (this.paused)
            return;
        let currentParent = this.emitter;
        while (currentParent.parent) {
            currentParent = currentParent.parent;
        }
        if (currentParent.type !== 'Scene') {
            this.dispose();
            return;
        }
        if (this.firstTimeUpdate) {
            this.firstTimeUpdate = false;
            this.emitter.updateWorldMatrix(true, false);
        }
        if (this.emitEnded && this.particleNum === 0) {
            if (this.markForDestroy && this.emitter.parent)
                this.dispose();
            return;
        }
        if (this.looping && this.prewarm && !this.prewarmed) {
            this.prewarmed = true;
            for (let i = 0; i < this.duration * PREWARM_FPS; i++) {
                this.update(1.0 / PREWARM_FPS);
            }
        }
        if (delta > 0.1) {
            delta = 0.1;
        }
        if (this.neededToUpdateRender) {
            if (this._renderer)
                this._renderer.updateSystem(this);
            this.neededToUpdateRender = false;
        }
        if (!this.onlyUsedByOther) {
            this.emit(delta, this.emissionState, this.emitter.matrixWorld);
        }
        this.emitterShape.update(this, delta);
        for (let j = 0; j < this.behaviors.length; j++) {
            this.behaviors[j].frameUpdate(delta);
            for (let i = 0; i < this.particleNum; i++) {
                if (!this.particles[i].died) {
                    this.behaviors[j].update(this.particles[i], delta);
                }
            }
        }
        for (let i = 0; i < this.particleNum; i++) {
            if (this.rendererEmitterSettings.followLocalOrigin &&
                this.particles[i].localPosition) {
                this.particles[i].position.copy(this.particles[i].localPosition);
                if (this.particles[i].parentMatrix) {
                    this.particles[i].position.applyMatrix4(this.particles[i].parentMatrix);
                }
                else {
                    this.particles[i].position.applyMatrix4(this.emitter.matrixWorld);
                }
            }
            else {
                this.particles[i].position.addScaledVector(this.particles[i].velocity, delta * this.particles[i].speedModifier);
            }
            this.particles[i].age += delta;
        }
        if (this.rendererSettings.renderMode === RenderMode.Trail) {
            for (let i = 0; i < this.particleNum; i++) {
                const particle = this.particles[i];
                particle.update();
            }
        }
        for (let i = 0; i < this.particleNum; i++) {
            const particle = this.particles[i];
            if (particle.died && (!(particle instanceof TrailParticle) || particle.previous.length === 0)) {
                this.particles[i] = this.particles[this.particleNum - 1];
                this.particles[this.particleNum - 1] = particle;
                this.particleNum--;
                i--;
                this.fire({ type: "particleDied", particleSystem: this, particle: particle });
            }
        }
    }
    emit(delta, emissionState, emitterMatrix) {
        if (emissionState.time > this.duration) {
            if (this.looping) {
                emissionState.time -= this.duration;
                emissionState.burstIndex = 0;
                this.behaviors.forEach((behavior) => {
                    behavior.reset();
                });
            }
            else {
                if (!this.emitEnded && !this.onlyUsedByOther) {
                    this.endEmit();
                }
            }
        }
        this.normalMatrix.getNormalMatrix(emitterMatrix);
        const totalSpawn = Math.ceil(emissionState.waitEmiting);
        this.spawn(totalSpawn, emissionState, emitterMatrix);
        emissionState.waitEmiting -= totalSpawn;
        while (emissionState.burstIndex < this.emissionBursts.length &&
            this.emissionBursts[emissionState.burstIndex].time <= emissionState.time) {
            if (Math.random() < this.emissionBursts[emissionState.burstIndex].probability) {
                const count = this.emissionBursts[emissionState.burstIndex].count.genValue(this.memory, this.time);
                emissionState.isBursting = true;
                emissionState.burstParticleCount = count;
                this.spawn(count, emissionState, emitterMatrix);
                emissionState.isBursting = false;
            }
            emissionState.burstIndex++;
        }
        if (!this.emitEnded) {
            emissionState.waitEmiting +=
                delta * this.emissionOverTime.genValue(this.memory, emissionState.time / this.duration);
            if (emissionState.previousWorldPos != undefined) {
                this.temp.set(emitterMatrix.elements[12], emitterMatrix.elements[13], emitterMatrix.elements[14]);
                emissionState.travelDistance += emissionState.previousWorldPos.distanceTo(this.temp);
                const emitPerMeter = this.emissionOverDistance.genValue(this.memory, emissionState.time / this.duration);
                if (emissionState.travelDistance * emitPerMeter > 0) {
                    const count = Math.floor(emissionState.travelDistance * emitPerMeter);
                    emissionState.travelDistance -= count / emitPerMeter;
                    emissionState.waitEmiting += count;
                }
            }
        }
        if (emissionState.previousWorldPos === undefined)
            emissionState.previousWorldPos = new Vector3$1();
        emissionState.previousWorldPos.set(emitterMatrix.elements[12], emitterMatrix.elements[13], emitterMatrix.elements[14]);
        emissionState.time += delta;
    }
    toJSON(meta, options = {}) {
        const isRootObject = meta === undefined || typeof meta === 'string';
        if (isRootObject) {
            meta = {
                geometries: {},
                materials: {},
                textures: {},
                images: {},
                shapes: {},
                skeletons: {},
                animations: {},
                nodes: {},
            };
        }
        meta.materials[this.rendererSettings.material.uuid] = this.rendererSettings.material.toJSON(meta);
        if (options.useUrlForImage) {
            if (this.texture?.source !== undefined) {
                const image = this.texture.source;
                meta.images[image.uuid] = {
                    uuid: image.uuid,
                    url: this.texture.image.url,
                };
            }
        }
        let rendererSettingsJSON;
        if (this.renderMode === RenderMode.Trail) {
            rendererSettingsJSON = {
                startLength: this.rendererEmitterSettings.startLength.toJSON(),
                followLocalOrigin: this.rendererEmitterSettings.followLocalOrigin,
            };
        }
        else if (this.renderMode === RenderMode.Mesh) {
            rendererSettingsJSON = {};
        }
        else if (this.renderMode === RenderMode.StretchedBillBoard) {
            rendererSettingsJSON = {
                speedFactor: this.rendererEmitterSettings.speedFactor,
                lengthFactor: this.rendererEmitterSettings.lengthFactor,
            };
        }
        else {
            rendererSettingsJSON = {};
        }
        const geometry = this.rendererSettings.instancingGeometry;
        if (meta.geometries && !meta.geometries[geometry.uuid]) {
            meta.geometries[geometry.uuid] = geometry.toJSON();
        }
        return {
            version: '3.0',
            autoDestroy: this.autoDestroy,
            looping: this.looping,
            prewarm: this.prewarm,
            duration: this.duration,
            shape: this.emitterShape.toJSON(),
            startLife: this.startLife.toJSON(),
            startSpeed: this.startSpeed.toJSON(),
            startRotation: this.startRotation.toJSON(),
            startSize: this.startSize.toJSON(),
            startColor: this.startColor.toJSON(),
            emissionOverTime: this.emissionOverTime.toJSON(),
            emissionOverDistance: this.emissionOverDistance.toJSON(),
            emissionBursts: this.emissionBursts.map((burst) => ({
                time: burst.time,
                count: burst.count.toJSON(),
                probability: burst.probability,
                interval: burst.interval,
                cycle: burst.cycle,
            })),
            onlyUsedByOther: this.onlyUsedByOther,
            instancingGeometry: this.rendererSettings.instancingGeometry.uuid,
            renderOrder: this.renderOrder,
            renderMode: this.renderMode,
            rendererEmitterSettings: rendererSettingsJSON,
            material: this.rendererSettings.material.uuid,
            layers: this.layers.mask,
            startTileIndex: this.startTileIndex.toJSON(),
            uTileCount: this.uTileCount,
            vTileCount: this.vTileCount,
            blendTiles: this.blendTiles,
            softParticles: this.rendererSettings.softParticles,
            softFarFade: this.rendererSettings.softFarFade,
            softNearFade: this.rendererSettings.softNearFade,
            behaviors: this.behaviors.map((behavior) => behavior.toJSON()),
            worldSpace: this.worldSpace,
        };
    }
    static fromJSON(json, meta, dependencies) {
        const shape = EmitterFromJSON(json.shape, meta);
        let rendererEmitterSettings;
        if (json.renderMode === RenderMode.Trail) {
            const trailSettings = json.rendererEmitterSettings;
            rendererEmitterSettings = {
                startLength: trailSettings.startLength != undefined
                    ? ValueGeneratorFromJSON(trailSettings.startLength)
                    : new ConstantValue(30),
                followLocalOrigin: trailSettings.followLocalOrigin,
            };
        }
        else if (json.renderMode === RenderMode.Mesh) {
            rendererEmitterSettings = {};
        }
        else if (json.renderMode === RenderMode.StretchedBillBoard) {
            rendererEmitterSettings = json.rendererEmitterSettings;
            if (json.speedFactor != undefined) {
                rendererEmitterSettings.speedFactor = json.speedFactor;
            }
        }
        else {
            rendererEmitterSettings = {};
        }
        const layers = new Layers();
        if (json.layers) {
            layers.mask = json.layers;
        }
        const ps = new ParticleSystem({
            autoDestroy: json.autoDestroy,
            looping: json.looping,
            prewarm: json.prewarm,
            duration: json.duration,
            shape: shape,
            startLife: ValueGeneratorFromJSON(json.startLife),
            startSpeed: ValueGeneratorFromJSON(json.startSpeed),
            startRotation: GeneratorFromJSON(json.startRotation),
            startSize: GeneratorFromJSON(json.startSize),
            startColor: ColorGeneratorFromJSON(json.startColor),
            emissionOverTime: ValueGeneratorFromJSON(json.emissionOverTime),
            emissionOverDistance: ValueGeneratorFromJSON(json.emissionOverDistance),
            emissionBursts: json.emissionBursts?.map((burst) => ({
                time: burst.time,
                count: typeof burst.count === 'number'
                    ? new ConstantValue(burst.count)
                    : ValueGeneratorFromJSON(burst.count),
                probability: burst.probability ?? 1,
                interval: burst.interval ?? 0.1,
                cycle: burst.cycle ?? 1,
            })),
            onlyUsedByOther: json.onlyUsedByOther,
            instancingGeometry: meta.geometries[json.instancingGeometry],
            renderMode: json.renderMode,
            rendererEmitterSettings: rendererEmitterSettings,
            renderOrder: json.renderOrder,
            layers: layers,
            material: json.material
                ? meta.materials[json.material]
                : json.texture
                    ? new MeshBasicMaterial({
                        map: meta.textures[json.texture],
                        transparent: json.transparent ?? true,
                        blending: json.blending,
                        side: DoubleSide,
                    })
                    : new MeshBasicMaterial({
                        color: 0xffffff,
                        transparent: true,
                        blending: AdditiveBlending,
                        side: DoubleSide,
                    }),
            startTileIndex: typeof json.startTileIndex === 'number'
                ? new ConstantValue(json.startTileIndex)
                : ValueGeneratorFromJSON(json.startTileIndex),
            uTileCount: json.uTileCount,
            vTileCount: json.vTileCount,
            blendTiles: json.blendTiles,
            softParticles: json.softParticles,
            softFarFade: json.softFarFade,
            softNearFade: json.softNearFade,
            behaviors: [],
            worldSpace: json.worldSpace,
        });
        ps.behaviors = json.behaviors.map((behaviorJson) => {
            const behavior = BehaviorFromJSON(behaviorJson, ps);
            if (behavior && behavior.type === 'EmitSubParticleSystem') {
                dependencies[behaviorJson.subParticleSystem] = behavior;
            }
            return behavior;
        }).filter(behavior => behavior !== null);
        return ps;
    }
    addBehavior(behavior) {
        this.behaviors.push(behavior);
    }
    getRendererSettings() {
        return this.rendererSettings;
    }
    addEventListener(event, callback) {
        if (!this.listeners[event])
            this.listeners[event] = [];
        this.listeners[event].push(callback);
    }
    removeAllEventListeners(event) {
        if (this.listeners[event])
            this.listeners[event] = [];
    }
    removeEventListener(event, callback) {
        if (this.listeners[event]) {
            const index = this.listeners[event].indexOf(callback);
            if (index !== -1) {
                this.listeners[event].splice(index, 1);
            }
        }
    }
    fire(event) {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(callback => callback(event));
        }
    }
    clone() {
        const newEmissionBursts = [];
        for (const emissionBurst of this.emissionBursts) {
            const newEmissionBurst = {};
            Object.assign(newEmissionBurst, emissionBurst);
            newEmissionBursts.push(newEmissionBurst);
        }
        const newBehaviors = [];
        for (const behavior of this.behaviors) {
            newBehaviors.push(behavior.clone());
        }
        let rendererEmitterSettings;
        if (this.renderMode === RenderMode.Trail) {
            rendererEmitterSettings = {
                startLength: this.rendererEmitterSettings.startLength.clone(),
                followLocalOrigin: this.rendererEmitterSettings.followLocalOrigin,
            };
        }
        else if (this.renderMode === RenderMode.StretchedBillBoard) {
            rendererEmitterSettings = {
                lengthFactor: this.rendererEmitterSettings.lengthFactor,
                speedFactor: this.rendererEmitterSettings.speedFactor,
            };
        }
        else {
            rendererEmitterSettings = {};
        }
        const layers = new Layers();
        layers.mask = this.layers.mask;
        return new ParticleSystem({
            autoDestroy: this.autoDestroy,
            looping: this.looping,
            duration: this.duration,
            shape: this.emitterShape.clone(),
            startLife: this.startLife.clone(),
            startSpeed: this.startSpeed.clone(),
            startRotation: this.startRotation.clone(),
            startSize: this.startSize.clone(),
            startColor: this.startColor.clone(),
            emissionOverTime: this.emissionOverTime.clone(),
            emissionOverDistance: this.emissionOverDistance.clone(),
            emissionBursts: newEmissionBursts,
            onlyUsedByOther: this.onlyUsedByOther,
            instancingGeometry: this.rendererSettings.instancingGeometry,
            renderMode: this.renderMode,
            renderOrder: this.renderOrder,
            rendererEmitterSettings: rendererEmitterSettings,
            material: this.rendererSettings.material,
            startTileIndex: this.startTileIndex,
            uTileCount: this.uTileCount,
            vTileCount: this.vTileCount,
            blendTiles: this.blendTiles,
            softParticles: this.softParticles,
            softFarFade: this.softFarFade,
            softNearFade: this.softNearFade,
            behaviors: newBehaviors,
            worldSpace: this.worldSpace,
            layers: layers,
        });
    }
}

var particle_frag = `

#include <common>
#include <color_pars_fragment>
#include <map_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
#include <alphatest_pars_fragment>

#include <tile_pars_fragment>
#include <soft_pars_fragment>

void main() {

    #include <clipping_planes_fragment>
    
    vec3 outgoingLight = vec3( 0.0 );
    vec4 diffuseColor = vColor;
    
    #include <logdepthbuf_fragment>
    
    #include <tile_fragment>
    #include <alphatest_fragment>

    outgoingLight = diffuseColor.rgb;
    
    #ifdef USE_COLOR_AS_ALPHA
    gl_FragColor = vec4( outgoingLight, diffuseColor.r );
    #else
    gl_FragColor = vec4( outgoingLight, diffuseColor.a );
    #endif
    
    #include <soft_fragment>
    #include <tonemapping_fragment>
}
`;

var particle_physics_frag = `
#define STANDARD

#ifdef PHYSICAL
#define IOR
#define USE_SPECULAR
#endif

uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;

#ifdef IOR
uniform float ior;
#endif

#ifdef USE_SPECULAR
uniform float specularIntensity;
uniform vec3 specularColor;

#ifdef USE_SPECULAR_COLORMAP
uniform sampler2D specularColorMap;
#endif

#ifdef USE_SPECULAR_INTENSITYMAP
uniform sampler2D specularIntensityMap;
#endif
#endif

#ifdef USE_CLEARCOAT
uniform float clearcoat;
uniform float clearcoatRoughness;
#endif

#ifdef USE_DISPERSION
uniform float dispersion;
#endif

#ifdef USE_IRIDESCENCE
uniform float iridescence;
uniform float iridescenceIOR;
uniform float iridescenceThicknessMinimum;
uniform float iridescenceThicknessMaximum;
#endif

#ifdef USE_SHEEN
uniform vec3 sheenColor;
uniform float sheenRoughness;

#ifdef USE_SHEEN_COLORMAP
uniform sampler2D sheenColorMap;
#endif

#ifdef USE_SHEEN_ROUGHNESSMAP
uniform sampler2D sheenRoughnessMap;
#endif
#endif

#ifdef USE_ANISOTROPY
uniform vec2 anisotropyVector;

#ifdef USE_ANISOTROPYMAP
uniform sampler2D anisotropyMap;
#endif
#endif

varying vec3 vViewPosition;

#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {

vec4 diffuseColor = vec4( diffuse, opacity );
#include <clipping_planes_fragment>

ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
vec3 totalEmissiveRadiance = emissive;

#include <logdepthbuf_fragment>
#include <map_fragment>
#include <color_fragment>
#include <alphamap_fragment>
#include <alphatest_fragment>
#include <alphahash_fragment>
#include <roughnessmap_fragment>
#include <metalnessmap_fragment>
#include <normal_fragment_begin>
#include <normal_fragment_maps>
#include <clearcoat_normal_fragment_begin>
#include <clearcoat_normal_fragment_maps>
#include <emissivemap_fragment>

// accumulation
#include <lights_physical_fragment>
#include <lights_fragment_begin>
#include <lights_fragment_maps>
#include <lights_fragment_end>

// modulation
#include <aomap_fragment>

vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;

#include <transmission_fragment>

vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;

#ifdef USE_SHEEN

// Sheen energy compensation approximation calculation can be found at the end of
// https://drive.google.com/file/d/1T0D1VSyR4AllqIJTQAraEIzjlb5h4FKH/view?usp=sharing
float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );

outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;

#endif

#ifdef USE_CLEARCOAT

float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );

vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );

outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;

#endif

#include <opaque_fragment>
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
#include <premultiplied_alpha_fragment>
#include <dithering_fragment>
}`;

var particle_vert = `
#include <common>
#include <color_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#include <tile_pars_vertex>
#include <soft_pars_vertex>

attribute vec3 offset;
attribute float rotation;
attribute vec3 size;

void main() {
	
    vec2 alignedPosition = position.xy * size.xy;
    
    vec2 rotatedPosition;
    rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
    rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
#ifdef HORIZONTAL
    vec4 mvPosition = modelMatrix * vec4( offset, 1.0 );
    mvPosition.x += rotatedPosition.x;
    mvPosition.z -= rotatedPosition.y;
    mvPosition = viewMatrix * mvPosition;
#elif defined(VERTICAL)
    vec4 mvPosition = modelMatrix * vec4( offset, 1.0 );
    mvPosition.y += rotatedPosition.y;
    mvPosition = viewMatrix * mvPosition;
    mvPosition.x += rotatedPosition.x;
#else
    vec4 mvPosition = modelViewMatrix * vec4( offset, 1.0 );
    mvPosition.xy += rotatedPosition;
#endif

	vColor = color;

	gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>

	#include <clipping_planes_vertex>

	#include <tile_vertex>
	#include <soft_vertex>
}
`;

var local_particle_vert = `
#include <common>
#include <color_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#include <tile_pars_vertex>
#include <soft_pars_vertex>

attribute vec3 offset;
attribute vec4 rotation;
attribute vec3 size;
// attribute vec4 color;

void main() {

    float x2 = rotation.x + rotation.x, y2 = rotation.y + rotation.y, z2 = rotation.z + rotation.z;
    float xx = rotation.x * x2, xy = rotation.x * y2, xz = rotation.x * z2;
    float yy = rotation.y * y2, yz = rotation.y * z2, zz = rotation.z * z2;
    float wx = rotation.w * x2, wy = rotation.w * y2, wz = rotation.w * z2;
    float sx = size.x, sy = size.y, sz = size.z;
    
    mat4 matrix = mat4(( 1.0 - ( yy + zz ) ) * sx, ( xy + wz ) * sx, ( xz - wy ) * sx, 0.0,  // 1. column
                      ( xy - wz ) * sy, ( 1.0 - ( xx + zz ) ) * sy, ( yz + wx ) * sy, 0.0,  // 2. column
                      ( xz + wy ) * sz, ( yz - wx ) * sz, ( 1.0 - ( xx + yy ) ) * sz, 0.0,  // 3. column
                      offset.x, offset.y, offset.z, 1.0);
    
    vec4 mvPosition = modelViewMatrix * (matrix * vec4( position, 1.0 ));

	vColor = color;

	gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
    #include <tile_vertex>
    #include <soft_vertex>
}
`;

var local_particle_physics_vert = `
#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>

attribute vec3 offset;
attribute vec4 rotation;
attribute vec3 size;
#include <tile_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

    #include <tile_vertex>
    float x2 = rotation.x + rotation.x, y2 = rotation.y + rotation.y, z2 = rotation.z + rotation.z;
    float xx = rotation.x * x2, xy = rotation.x * y2, xz = rotation.x * z2;
    float yy = rotation.y * y2, yz = rotation.y * z2, zz = rotation.z * z2;
    float wx = rotation.w * x2, wy = rotation.w * y2, wz = rotation.w * z2;
    float sx = size.x, sy = size.y, sz = size.z;

    mat4 particleMatrix = mat4(( 1.0 - ( yy + zz ) ) * sx, ( xy + wz ) * sx, ( xz - wy ) * sx, 0.0,  // 1. column
                      ( xy - wz ) * sy, ( 1.0 - ( xx + zz ) ) * sy, ( yz + wx ) * sy, 0.0,  // 2. column
                      ( xz + wy ) * sz, ( yz - wx ) * sz, ( 1.0 - ( xx + yy ) ) * sz, 0.0,  // 3. column
                      offset.x, offset.y, offset.z, 1.0);

#include <color_vertex>
#include <morphinstance_vertex>
#include <morphcolor_vertex>
#include <batching_vertex>

#include <beginnormal_vertex>
#include <morphnormal_vertex>
#include <skinbase_vertex>
#include <skinnormal_vertex>

	// replace defaultnormal_vertex
	vec3 transformedNormal = objectNormal;
    mat3 m = mat3( particleMatrix );
    transformedNormal /= vec3( dot( m[ 0 ], m[ 0 ] ), dot( m[ 1 ], m[ 1 ] ), dot( m[ 2 ], m[ 2 ] ) );
    transformedNormal = m * transformedNormal;
    transformedNormal = normalMatrix * transformedNormal;
    #ifdef FLIP_SIDED
        transformedNormal = - transformedNormal;
    #endif
    #ifdef USE_TANGENT
        vec3 transformedTangent = ( modelViewMatrix * vec4( objectTangent, 0.0 ) ).xyz;
        #ifdef FLIP_SIDED
        transformedTangent = - transformedTangent;
        #endif
    #endif

	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>

	// replace include <project_vertex>
  vec4 mvPosition = vec4( transformed, 1.0 );
  mvPosition = modelViewMatrix * (particleMatrix * mvPosition);
	gl_Position = projectionMatrix * mvPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	
	vViewPosition = - mvPosition.xyz;
	
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
    vWorldPosition = worldPosition.xyz;
#endif
}
`;

var stretched_bb_particle_vert = `
#include <common>
#include <color_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>

#include <tile_pars_vertex>
#include <soft_pars_vertex>

attribute vec3 offset;
attribute float rotation;
attribute vec3 size;
attribute vec4 velocity;

uniform float speedFactor;

void main() {
    float lengthFactor = velocity.w;
    float avgSize = (size.x + size.y) * 0.5;
#ifdef USE_SKEW
    vec4 mvPosition = modelViewMatrix * vec4( offset, 1.0 );
    vec3 viewVelocity = normalMatrix * velocity.xyz;

    vec3 scaledPos = vec3(position.xy * size.xy, position.z);
    float vlength = length(viewVelocity);
    vec3 projVelocity =  dot(scaledPos, viewVelocity) * viewVelocity / vlength;
    mvPosition.xyz += scaledPos + projVelocity * (speedFactor / avgSize + lengthFactor / vlength);
#else
    vec4 mvPosition = modelViewMatrix * vec4( offset, 1.0 );
    vec3 viewVelocity = normalMatrix * velocity.xyz;
    float vlength = length(viewVelocity); 
    mvPosition.xyz += position.y * normalize(cross(mvPosition.xyz, viewVelocity)) * avgSize; // switch the cross to  match unity implementation
    mvPosition.xyz -= (position.x + 0.5) * viewVelocity * (1.0 + lengthFactor / vlength) * avgSize; // minus position.x to match unity implementation
#endif
	vColor = color;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <tile_vertex>
	#include <soft_vertex>
}
`;

function getMaterialUVChannelName(value) {
    if (value === 0)
        return 'uv';
    return `uv${value}`;
}

class ParticleMeshStandardMaterial extends MeshStandardMaterial {
    constructor(parameters) {
        super(parameters);
    }
    onBeforeCompile(parameters, renderer) {
        super.onBeforeCompile(parameters, renderer);
        parameters.vertexShader = local_particle_physics_vert;
        parameters.fragmentShader = particle_physics_frag;
    }
}
class ParticleMeshPhysicsMaterial extends MeshPhysicalMaterial {
    constructor(parameters) {
        super(parameters);
    }
    onBeforeCompile(parameters, renderer) {
        super.onBeforeCompile(parameters, renderer);
        parameters.vertexShader = local_particle_physics_vert;
        parameters.fragmentShader = particle_physics_frag;
    }
}

class SpriteBatch extends VFXBatch {
    constructor(settings) {
        super(settings);
        this.vector_ = new Vector3$1();
        this.vector2_ = new Vector3$1();
        this.vector3_ = new Vector3$1();
        this.quaternion_ = new Quaternion();
        this.quaternion2_ = new Quaternion();
        this.quaternion3_ = new Quaternion();
        this.rotationMat_ = new Matrix3();
        this.rotationMat2_ = new Matrix3();
        this.maxParticles = 1000;
        this.setupBuffers();
        this.rebuildMaterial();
    }
    buildExpandableBuffers() {
        this.offsetBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
        this.offsetBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('offset', this.offsetBuffer);
        this.colorBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
        this.colorBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('color', this.colorBuffer);
        if (this.settings.renderMode === RenderMode.Mesh) {
            this.rotationBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
            this.rotationBuffer.setUsage(DynamicDrawUsage);
            this.geometry.setAttribute('rotation', this.rotationBuffer);
        }
        else if (this.settings.renderMode === RenderMode.BillBoard ||
            this.settings.renderMode === RenderMode.HorizontalBillBoard ||
            this.settings.renderMode === RenderMode.VerticalBillBoard ||
            this.settings.renderMode === RenderMode.StretchedBillBoard) {
            this.rotationBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles), 1);
            this.rotationBuffer.setUsage(DynamicDrawUsage);
            this.geometry.setAttribute('rotation', this.rotationBuffer);
        }
        this.sizeBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
        this.sizeBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('size', this.sizeBuffer);
        this.uvTileBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles), 1);
        this.uvTileBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('uvTile', this.uvTileBuffer);
        if (this.settings.renderMode === RenderMode.StretchedBillBoard) {
            this.velocityBuffer = new InstancedBufferAttribute(new Float32Array(this.maxParticles * 4), 4);
            this.velocityBuffer.setUsage(DynamicDrawUsage);
            this.geometry.setAttribute('velocity', this.velocityBuffer);
        }
    }
    setupBuffers() {
        if (this.geometry)
            this.geometry.dispose();
        this.geometry = new InstancedBufferGeometry();
        this.geometry.setIndex(this.settings.instancingGeometry.getIndex());
        if (this.settings.instancingGeometry.hasAttribute('normal')) {
            this.geometry.setAttribute('normal', this.settings.instancingGeometry.getAttribute('normal'));
        }
        this.geometry.setAttribute('position', this.settings.instancingGeometry.getAttribute('position'));
        if (this.settings.instancingGeometry.hasAttribute('uv')) {
            this.geometry.setAttribute('uv', this.settings.instancingGeometry.getAttribute('uv'));
        }
        this.buildExpandableBuffers();
    }
    expandBuffers(target) {
        while (target >= this.maxParticles) {
            this.maxParticles *= 2;
        }
        this.setupBuffers();
    }
    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;
        const uniforms = {};
        const defines = {};
        if (this.settings.material.type !== 'MeshStandardMaterial' &&
            this.settings.material.type !== 'MeshPhysicalMaterial') {
            uniforms['map'] = new Uniform(this.settings.material.map);
        }
        if (this.settings.material.alphaTest) {
            defines['USE_ALPHATEST'] = '';
            uniforms['alphaTest'] = new Uniform(this.settings.material.alphaTest);
        }
        defines['USE_UV'] = '';
        const uTileCount = this.settings.uTileCount;
        const vTileCount = this.settings.vTileCount;
        if (uTileCount > 1 || vTileCount > 1) {
            defines['UV_TILE'] = '';
            uniforms['tileCount'] = new Uniform(new Vector2(uTileCount, vTileCount));
        }
        if (this.settings.material.defines &&
            this.settings.material.defines['USE_COLOR_AS_ALPHA'] !== undefined) {
            defines['USE_COLOR_AS_ALPHA'] = '';
        }
        if (this.settings.material.normalMap) {
            defines['USE_NORMALMAP'] = '';
            defines['NORMALMAP_UV'] = getMaterialUVChannelName(this.settings.material.normalMap.channel);
            uniforms['normalMapTransform'] = new Uniform(new Matrix3().copy(this.settings.material.normalMap.matrix));
        }
        if (this.settings.material.map) {
            defines['USE_MAP'] = '';
            if (this.settings.blendTiles)
                defines['TILE_BLEND'] = '';
            defines['MAP_UV'] = getMaterialUVChannelName(this.settings.material.map.channel);
            uniforms['mapTransform'] = new Uniform(new Matrix3().copy(this.settings.material.map.matrix));
        }
        defines['USE_COLOR_ALPHA'] = '';
        let onBeforeRender;
        if (this.settings.softParticles) {
            defines['SOFT_PARTICLES'] = '';
            const nearFade = this.settings.softNearFade;
            const invFadeDistance = 1.0 / (this.settings.softFarFade - this.settings.softNearFade);
            uniforms['softParams'] = new Uniform(new Vector2(nearFade, invFadeDistance));
            uniforms['depthTexture'] = new Uniform(null);
            const projParams = (uniforms['projParams'] = new Uniform(new Vector4()));
            onBeforeRender = (_renderer, _scene, camera) => {
                projParams.value.set(camera.near, camera.far, 0, 0);
            };
        }
        let needLights = false;
        if (this.settings.renderMode === RenderMode.BillBoard ||
            this.settings.renderMode === RenderMode.VerticalBillBoard ||
            this.settings.renderMode === RenderMode.HorizontalBillBoard ||
            this.settings.renderMode === RenderMode.Mesh) {
            let vertexShader;
            let fragmentShader;
            if (this.settings.renderMode === RenderMode.Mesh) {
                if (this.settings.material.type === 'MeshStandardMaterial' ||
                    this.settings.material.type === 'MeshPhysicalMaterial') {
                    defines['USE_COLOR'] = '';
                    vertexShader = local_particle_physics_vert;
                    fragmentShader = particle_physics_frag;
                    needLights = true;
                }
                else {
                    vertexShader = local_particle_vert;
                    fragmentShader = particle_frag;
                }
            }
            else {
                vertexShader = particle_vert;
                fragmentShader = particle_frag;
            }
            if (this.settings.renderMode === RenderMode.VerticalBillBoard) {
                defines['VERTICAL'] = '';
            }
            else if (this.settings.renderMode === RenderMode.HorizontalBillBoard) {
                defines['HORIZONTAL'] = '';
            }
            let specialMats = false;
            if (this.settings.renderMode === RenderMode.Mesh) {
                if (this.settings.material.type === 'MeshStandardMaterial') {
                    this.material = new ParticleMeshStandardMaterial({});
                    this.material.copy(this.settings.material);
                    this.material.uniforms = uniforms;
                    this.material.defines = defines;
                    specialMats = true;
                }
                else if (this.settings.material.type === 'MeshPhysicalMaterial') {
                    this.material = new ParticleMeshPhysicsMaterial({});
                    this.material.copy(this.settings.material);
                    this.material.uniforms = uniforms;
                    this.material.defines = defines;
                    specialMats = true;
                }
            }
            if (!specialMats) {
                this.material = new ShaderMaterial({
                    uniforms: uniforms,
                    defines: defines,
                    vertexShader: vertexShader,
                    fragmentShader: fragmentShader,
                    transparent: this.settings.material.transparent,
                    depthWrite: !this.settings.material.transparent,
                    blending: this.settings.material.blending,
                    blendDst: this.settings.material.blendDst,
                    blendSrc: this.settings.material.blendSrc,
                    blendEquation: this.settings.material.blendEquation,
                    premultipliedAlpha: this.settings.material.premultipliedAlpha,
                    side: this.settings.material.side,
                    alphaTest: this.settings.material.alphaTest,
                    depthTest: this.settings.material.depthTest,
                    lights: needLights,
                });
            }
        }
        else if (this.settings.renderMode === RenderMode.StretchedBillBoard) {
            uniforms['speedFactor'] = new Uniform(1.0);
            this.material = new ShaderMaterial({
                uniforms: uniforms,
                defines: defines,
                vertexShader: stretched_bb_particle_vert,
                fragmentShader: particle_frag,
                transparent: this.settings.material.transparent,
                depthWrite: !this.settings.material.transparent,
                blending: this.settings.material.blending,
                blendDst: this.settings.material.blendDst,
                blendSrc: this.settings.material.blendSrc,
                blendEquation: this.settings.material.blendEquation,
                premultipliedAlpha: this.settings.material.premultipliedAlpha,
                side: this.settings.material.side,
                alphaTest: this.settings.material.alphaTest,
                depthTest: this.settings.material.depthTest,
            });
        }
        else {
            throw new Error('render mode unavailable');
        }
        if (this.material && onBeforeRender) {
            this.material.onBeforeRender = onBeforeRender;
        }
    }
    update() {
        let index = 0;
        let particleCount = 0;
        const visibleSystems = this.getVisibleSystems();
        for (const system of visibleSystems) {
            particleCount += system.particleNum;
        }
        if (particleCount > this.maxParticles) {
            this.expandBuffers(particleCount);
        }
        for (const system of visibleSystems) {
            if (system.emitter.updateMatrixWorld) {
                system.emitter.updateWorldMatrix(true, false);
                system.emitter.updateMatrixWorld(true);
            }
            const particles = system.particles;
            const particleNum = system.particleNum;
            const rotation = this.quaternion2_;
            const translation = this.vector2_;
            const scale = this.vector3_;
            system.emitter.matrixWorld.decompose(translation, rotation, scale);
            this.rotationMat_.setFromMatrix4(system.emitter.matrixWorld);
            for (let j = 0; j < particleNum; j++, index++) {
                const particle = particles[j];
                if (this.settings.renderMode === RenderMode.Mesh) {
                    let q;
                    if (system.worldSpace) {
                        q = particle.rotation;
                    }
                    else {
                        let parentQ;
                        if (particle.parentMatrix) {
                            parentQ = this.quaternion3_.setFromRotationMatrix(particle.parentMatrix);
                        }
                        else {
                            parentQ = rotation;
                        }
                        q = this.quaternion_;
                        q.copy(parentQ).multiply(particle.rotation);
                    }
                    this.rotationBuffer.setXYZW(index, q.x, q.y, q.z, q.w);
                }
                else if (this.settings.renderMode === RenderMode.StretchedBillBoard ||
                    this.settings.renderMode === RenderMode.VerticalBillBoard ||
                    this.settings.renderMode === RenderMode.HorizontalBillBoard ||
                    this.settings.renderMode === RenderMode.BillBoard) {
                    this.rotationBuffer.setX(index, particle.rotation);
                }
                let vec;
                if (system.worldSpace) {
                    vec = particle.position;
                }
                else {
                    vec = this.vector_;
                    if (particle.parentMatrix) {
                        vec.copy(particle.position).applyMatrix4(particle.parentMatrix);
                    }
                    else {
                        vec.copy(particle.position).applyMatrix4(system.emitter.matrixWorld);
                    }
                }
                this.offsetBuffer.setXYZ(index, vec.x, vec.y, vec.z);
                this.colorBuffer.setXYZW(index, particle.color.x, particle.color.y, particle.color.z, particle.color.w);
                if (system.worldSpace) {
                    this.sizeBuffer.setXYZ(index, particle.size.x, particle.size.y, particle.size.z);
                }
                else {
                    if (particle.parentMatrix) {
                        this.sizeBuffer.setXYZ(index, particle.size.x, particle.size.y, particle.size.z);
                    }
                    else {
                        this.sizeBuffer.setXYZ(index, particle.size.x * Math.abs(scale.x), particle.size.y * Math.abs(scale.y), particle.size.z * Math.abs(scale.z));
                    }
                }
                this.uvTileBuffer.setX(index, particle.uvTile);
                if (this.settings.renderMode === RenderMode.StretchedBillBoard && this.velocityBuffer) {
                    let speedFactor = system.rendererEmitterSettings.speedFactor;
                    if (speedFactor === 0)
                        speedFactor = 0.001;
                    const lengthFactor = system.rendererEmitterSettings.lengthFactor;
                    let vec;
                    if (system.worldSpace) {
                        vec = particle.velocity;
                    }
                    else {
                        vec = this.vector_;
                        if (particle.parentMatrix) {
                            this.rotationMat2_.setFromMatrix4(particle.parentMatrix);
                            vec.copy(particle.velocity).applyMatrix3(this.rotationMat2_);
                        }
                        else {
                            vec.copy(particle.velocity).applyMatrix3(this.rotationMat_);
                        }
                    }
                    this.velocityBuffer.setXYZW(index, vec.x * speedFactor, vec.y * speedFactor, vec.z * speedFactor, lengthFactor);
                }
            }
        }
        this.geometry.instanceCount = index;
        if (index > 0) {
            this.offsetBuffer.clearUpdateRanges();
            this.offsetBuffer.addUpdateRange(0, index * 3);
            this.offsetBuffer.needsUpdate = true;
            this.sizeBuffer.clearUpdateRanges();
            this.sizeBuffer.addUpdateRange(0, index * 3);
            this.sizeBuffer.needsUpdate = true;
            this.colorBuffer.clearUpdateRanges();
            this.colorBuffer.addUpdateRange(0, index * 4);
            this.colorBuffer.needsUpdate = true;
            this.uvTileBuffer.clearUpdateRanges();
            this.uvTileBuffer.addUpdateRange(0, index);
            this.uvTileBuffer.needsUpdate = true;
            if (this.settings.renderMode === RenderMode.StretchedBillBoard && this.velocityBuffer) {
                this.velocityBuffer.clearUpdateRanges();
                this.velocityBuffer.addUpdateRange(0, index * 4);
                this.velocityBuffer.needsUpdate = true;
            }
            if (this.settings.renderMode === RenderMode.Mesh) {
                this.rotationBuffer.clearUpdateRanges();
                this.rotationBuffer.addUpdateRange(0, index * 4);
                this.rotationBuffer.needsUpdate = true;
            }
            else if (this.settings.renderMode === RenderMode.StretchedBillBoard ||
                this.settings.renderMode === RenderMode.HorizontalBillBoard ||
                this.settings.renderMode === RenderMode.VerticalBillBoard ||
                this.settings.renderMode === RenderMode.BillBoard) {
                this.rotationBuffer.clearUpdateRanges();
                this.rotationBuffer.addUpdateRange(0, index);
                this.rotationBuffer.needsUpdate = true;
            }
        }
    }
    dispose() {
        this.geometry.dispose();
    }
}

var trail_frag = `

#include <common>
#include <tile_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>

uniform sampler2D alphaMap;
uniform float useAlphaMap;
uniform float visibility;
uniform float alphaTest;

varying vec4 vColor;
    
void main() {
    #include <clipping_planes_fragment>
    #include <logdepthbuf_fragment>

    vec4 diffuseColor = vColor;
    
    #ifdef USE_MAP
    #include <tile_fragment>
    #ifndef USE_COLOR_AS_ALPHA
    #endif
    #endif
    if( useAlphaMap == 1. ) diffuseColor.a *= texture2D( alphaMap, vUv).a;
    if( diffuseColor.a < alphaTest ) discard;
    gl_FragColor = diffuseColor;

    #include <fog_fragment>
    #include <tonemapping_fragment>
}`;

var trail_vert = `
#include <common>
#include <tile_pars_vertex>
#include <color_pars_vertex>
#include <clipping_planes_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>

attribute vec3 previous;
attribute vec3 next;
attribute float side;
attribute float width;

uniform vec2 resolution;
uniform float lineWidth;
uniform float sizeAttenuation;
    
vec2 fix(vec4 i, float aspect) {
    vec2 res = i.xy / i.w;
    res.x *= aspect;
    return res;
}
    
void main() {

    #include <tile_vertex>
    
    float aspect = resolution.x / resolution.y;

    vColor = color;

    mat4 m = projectionMatrix * modelViewMatrix;
    vec4 finalPosition = m * vec4( position, 1.0 );
    vec4 prevPos = m * vec4( previous, 1.0 );
    vec4 nextPos = m * vec4( next, 1.0 );

    vec2 currentP = fix( finalPosition, aspect );
    vec2 prevP = fix( prevPos, aspect );
    vec2 nextP = fix( nextPos, aspect );

    float w = lineWidth * width;

    vec2 dir;
    if( nextP == currentP ) dir = normalize( currentP - prevP );
    else if( prevP == currentP ) dir = normalize( nextP - currentP );
    else {
        vec2 dir1 = normalize( currentP - prevP );
        vec2 dir2 = normalize( nextP - currentP );
        dir = normalize( dir1 + dir2 );

        vec2 perp = vec2( -dir1.y, dir1.x );
        vec2 miter = vec2( -dir.y, dir.x );
        //w = clamp( w / dot( miter, perp ), 0., 4., * lineWidth * width );

    }

    //vec2 normal = ( cross( vec3( dir, 0. ) vec3( 0., 0., 1. ) ) ).xy;
    vec4 normal = vec4( -dir.y, dir.x, 0., 1. );
    normal.xy *= .5 * w;
    normal *= projectionMatrix;
    if( sizeAttenuation == 0. ) {
        normal.xy *= finalPosition.w;
        normal.xy /= ( vec4( resolution, 0., 1. ) * projectionMatrix ).xy;
    }

    finalPosition.xy += normal.xy * side;

    gl_Position = finalPosition;

	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    
	#include <fog_vertex>
}`;

class TrailBatch extends VFXBatch {
    constructor(settings) {
        super(settings);
        this.vector_ = new Vector3$1();
        this.vector2_ = new Vector3$1();
        this.vector3_ = new Vector3$1();
        this.quaternion_ = new Quaternion();
        this.maxParticles = 10000;
        this.setupBuffers();
        this.rebuildMaterial();
    }
    setupBuffers() {
        if (this.geometry)
            this.geometry.dispose();
        this.geometry = new BufferGeometry();
        this.indexBuffer = new BufferAttribute(new Uint32Array(this.maxParticles * 6), 1);
        this.indexBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setIndex(this.indexBuffer);
        this.positionBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 6), 3);
        this.positionBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('position', this.positionBuffer);
        this.previousBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 6), 3);
        this.previousBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('previous', this.previousBuffer);
        this.nextBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 6), 3);
        this.nextBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('next', this.nextBuffer);
        this.widthBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 2), 1);
        this.widthBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('width', this.widthBuffer);
        this.sideBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 2), 1);
        this.sideBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('side', this.sideBuffer);
        this.uvBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 4), 2);
        this.uvBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('uv', this.uvBuffer);
        this.colorBuffer = new BufferAttribute(new Float32Array(this.maxParticles * 8), 4);
        this.colorBuffer.setUsage(DynamicDrawUsage);
        this.geometry.setAttribute('color', this.colorBuffer);
    }
    expandBuffers(target) {
        while (target >= this.maxParticles) {
            this.maxParticles *= 2;
        }
        this.setupBuffers();
    }
    rebuildMaterial() {
        this.layers.mask = this.settings.layers.mask;
        const uniforms = {
            lineWidth: { value: 1 },
            map: { value: null },
            useMap: { value: 0 },
            alphaMap: { value: null },
            useAlphaMap: { value: 0 },
            resolution: { value: new Vector2(1, 1) },
            sizeAttenuation: { value: 1 },
            visibility: { value: 1 },
            alphaTest: { value: 0 },
        };
        const defines = {};
        defines['USE_UV'] = '';
        defines['USE_COLOR_ALPHA'] = '';
        if (this.settings.material.map) {
            defines['USE_MAP'] = '';
            defines['MAP_UV'] = getMaterialUVChannelName(this.settings.material.map.channel);
            uniforms['map'] = new Uniform(this.settings.material.map);
            uniforms['mapTransform'] = new Uniform(new Matrix3().copy(this.settings.material.map.matrix));
        }
        if (this.settings.material.defines &&
            this.settings.material.defines['USE_COLOR_AS_ALPHA'] !== undefined) {
            defines['USE_COLOR_AS_ALPHA'] = '';
        }
        if (this.settings.renderMode === RenderMode.Trail) {
            this.material = new ShaderMaterial({
                uniforms: uniforms,
                defines: defines,
                vertexShader: trail_vert,
                fragmentShader: trail_frag,
                transparent: this.settings.material.transparent,
                depthWrite: !this.settings.material.transparent,
                side: this.settings.material.side,
                blending: this.settings.material.blending || AdditiveBlending,
                blendDst: this.settings.material.blendDst,
                blendSrc: this.settings.material.blendSrc,
                blendEquation: this.settings.material.blendEquation,
                premultipliedAlpha: this.settings.material.premultipliedAlpha,
            });
        }
        else {
            throw new Error('render mode unavailable');
        }
    }
    update() {
        let index = 0;
        let triangles = 0;
        let particleCount = 0;
        const visibleSystems = this.getVisibleSystems();
        for (const system of visibleSystems) {
            for (let j = 0; j < system.particleNum; j++) {
                particleCount += system.particles[j].previous.length * 2;
            }
        }
        if (particleCount > this.maxParticles) {
            this.expandBuffers(particleCount);
        }
        for (const system of visibleSystems) {
            if (system.emitter.updateMatrixWorld) {
                system.emitter.updateWorldMatrix(true, false);
                system.emitter.updateMatrixWorld(true);
            }
            const rotation = this.quaternion_;
            const translation = this.vector2_;
            const scale = this.vector3_;
            system.emitter.matrixWorld.decompose(translation, rotation, scale);
            const particles = system.particles;
            const particleNum = system.particleNum;
            const uTileCount = this.settings.uTileCount;
            const vTileCount = this.settings.vTileCount;
            const tileWidth = 1 / uTileCount;
            const tileHeight = 1 / vTileCount;
            for (let j = 0; j < particleNum; j++) {
                const particle = particles[j];
                const col = particle.uvTile % vTileCount;
                const row = Math.floor(particle.uvTile / vTileCount + 0.001);
                const iter = particle.previous.values();
                let curIter = iter.next();
                let previous = curIter.value;
                let current = previous;
                if (!curIter.done)
                    curIter = iter.next();
                let next;
                if (curIter.value !== undefined) {
                    next = curIter.value;
                }
                else {
                    next = current;
                }
                for (let i = 0; i < particle.previous.length; i++, index += 2) {
                    this.positionBuffer.setXYZ(index, current.position.x, current.position.y, current.position.z);
                    this.positionBuffer.setXYZ(index + 1, current.position.x, current.position.y, current.position.z);
                    if (system.worldSpace) {
                        this.positionBuffer.setXYZ(index, current.position.x, current.position.y, current.position.z);
                        this.positionBuffer.setXYZ(index + 1, current.position.x, current.position.y, current.position.z);
                    }
                    else {
                        if (particle.parentMatrix) {
                            this.vector_.copy(current.position).applyMatrix4(particle.parentMatrix);
                        }
                        else {
                            this.vector_.copy(current.position).applyMatrix4(system.emitter.matrixWorld);
                        }
                        this.positionBuffer.setXYZ(index, this.vector_.x, this.vector_.y, this.vector_.z);
                        this.positionBuffer.setXYZ(index + 1, this.vector_.x, this.vector_.y, this.vector_.z);
                    }
                    if (system.worldSpace) {
                        this.previousBuffer.setXYZ(index, previous.position.x, previous.position.y, previous.position.z);
                        this.previousBuffer.setXYZ(index + 1, previous.position.x, previous.position.y, previous.position.z);
                    }
                    else {
                        if (particle.parentMatrix) {
                            this.vector_.copy(previous.position).applyMatrix4(particle.parentMatrix);
                        }
                        else {
                            this.vector_.copy(previous.position).applyMatrix4(system.emitter.matrixWorld);
                        }
                        this.previousBuffer.setXYZ(index, this.vector_.x, this.vector_.y, this.vector_.z);
                        this.previousBuffer.setXYZ(index + 1, this.vector_.x, this.vector_.y, this.vector_.z);
                    }
                    if (system.worldSpace) {
                        this.nextBuffer.setXYZ(index, next.position.x, next.position.y, next.position.z);
                        this.nextBuffer.setXYZ(index + 1, next.position.x, next.position.y, next.position.z);
                    }
                    else {
                        if (particle.parentMatrix) {
                            this.vector_.copy(next.position).applyMatrix4(particle.parentMatrix);
                        }
                        else {
                            this.vector_.copy(next.position).applyMatrix4(system.emitter.matrixWorld);
                        }
                        this.nextBuffer.setXYZ(index, this.vector_.x, this.vector_.y, this.vector_.z);
                        this.nextBuffer.setXYZ(index + 1, this.vector_.x, this.vector_.y, this.vector_.z);
                    }
                    this.sideBuffer.setX(index, 1);
                    this.sideBuffer.setX(index + 1, -1);
                    if (system.worldSpace) {
                        this.widthBuffer.setX(index, current.size);
                        this.widthBuffer.setX(index + 1, current.size);
                    }
                    else {
                        if (particle.parentMatrix) {
                            this.widthBuffer.setX(index, current.size);
                            this.widthBuffer.setX(index + 1, current.size);
                        }
                        else {
                            const objectScale = (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3;
                            this.widthBuffer.setX(index, current.size * objectScale);
                            this.widthBuffer.setX(index + 1, current.size * objectScale);
                        }
                    }
                    this.uvBuffer.setXY(index, (i / particle.previous.length + col) * tileWidth, (vTileCount - row - 1) * tileHeight);
                    this.uvBuffer.setXY(index + 1, (i / particle.previous.length + col) * tileWidth, (vTileCount - row) * tileHeight);
                    this.colorBuffer.setXYZW(index, current.color.x, current.color.y, current.color.z, current.color.w);
                    this.colorBuffer.setXYZW(index + 1, current.color.x, current.color.y, current.color.z, current.color.w);
                    if (i + 1 < particle.previous.length) {
                        this.indexBuffer.setX(triangles * 3, index);
                        this.indexBuffer.setX(triangles * 3 + 1, index + 1);
                        this.indexBuffer.setX(triangles * 3 + 2, index + 2);
                        triangles++;
                        this.indexBuffer.setX(triangles * 3, index + 2);
                        this.indexBuffer.setX(triangles * 3 + 1, index + 1);
                        this.indexBuffer.setX(triangles * 3 + 2, index + 3);
                        triangles++;
                    }
                    previous = current;
                    current = next;
                    if (!curIter.done) {
                        curIter = iter.next();
                        if (curIter.value !== undefined) {
                            next = curIter.value;
                        }
                    }
                }
            }
        }
        this.positionBuffer.clearUpdateRanges();
        this.positionBuffer.addUpdateRange(0, index * 3);
        this.positionBuffer.needsUpdate = true;
        this.previousBuffer.clearUpdateRanges();
        this.previousBuffer.addUpdateRange(0, index * 3);
        this.previousBuffer.needsUpdate = true;
        this.nextBuffer.clearUpdateRanges();
        this.nextBuffer.addUpdateRange(0, index * 3);
        this.nextBuffer.needsUpdate = true;
        this.sideBuffer.clearUpdateRanges();
        this.sideBuffer.addUpdateRange(0, index);
        this.sideBuffer.needsUpdate = true;
        this.widthBuffer.clearUpdateRanges();
        this.widthBuffer.addUpdateRange(0, index);
        this.widthBuffer.needsUpdate = true;
        this.uvBuffer.clearUpdateRanges();
        this.uvBuffer.addUpdateRange(0, index * 2);
        this.uvBuffer.needsUpdate = true;
        this.colorBuffer.clearUpdateRanges();
        this.colorBuffer.addUpdateRange(0, index * 4);
        this.colorBuffer.needsUpdate = true;
        this.indexBuffer.clearUpdateRanges();
        this.indexBuffer.addUpdateRange(0, triangles * 3);
        this.indexBuffer.needsUpdate = true;
        this.geometry.setDrawRange(0, triangles * 3);
    }
    dispose() {
        this.geometry.dispose();
    }
}

class BatchedRenderer extends Object3D {
    constructor() {
        super();
        this.batches = [];
        this.systemToBatchIndex = new Map();
        this.type = 'BatchedRenderer';
        this.depthTexture = null;
    }
    static equals(a, b) {
        return (a.material.side === b.material.side &&
            a.material.blending === b.material.blending &&
            a.material.blendSrc === b.material.blendSrc &&
            a.material.blendDst === b.material.blendDst &&
            a.material.blendEquation === b.material.blendEquation &&
            a.material.premultipliedAlpha === b.material.premultipliedAlpha &&
            a.material.transparent === b.material.transparent &&
            a.material.depthTest === b.material.depthTest &&
            a.material.type === b.material.type &&
            a.material.alphaTest === b.material.alphaTest &&
            a.material.map === b.material.map &&
            a.renderMode === b.renderMode &&
            a.blendTiles === b.blendTiles &&
            a.softParticles === b.softParticles &&
            a.softFarFade === b.softFarFade &&
            a.softNearFade === b.softNearFade &&
            a.uTileCount === b.uTileCount &&
            a.vTileCount === b.vTileCount &&
            a.instancingGeometry === b.instancingGeometry &&
            a.renderOrder === b.renderOrder &&
            a.layers.mask === b.layers.mask);
    }
    addSystem(system) {
        system._renderer = this;
        const settings = system.getRendererSettings();
        for (let i = 0; i < this.batches.length; i++) {
            if (BatchedRenderer.equals(this.batches[i].settings, settings)) {
                this.batches[i].addSystem(system);
                this.systemToBatchIndex.set(system, i);
                return;
            }
        }
        let batch;
        switch (settings.renderMode) {
            case RenderMode.Trail:
                batch = new TrailBatch(settings);
                break;
            case RenderMode.Mesh:
            case RenderMode.BillBoard:
            case RenderMode.VerticalBillBoard:
            case RenderMode.HorizontalBillBoard:
            case RenderMode.StretchedBillBoard:
                batch = new SpriteBatch(settings);
                break;
        }
        if (this.depthTexture) {
            batch.applyDepthTexture(this.depthTexture);
        }
        batch.addSystem(system);
        this.batches.push(batch);
        this.systemToBatchIndex.set(system, this.batches.length - 1);
        this.add(batch);
    }
    deleteSystem(system) {
        const batchIndex = this.systemToBatchIndex.get(system);
        if (batchIndex != undefined) {
            this.batches[batchIndex].removeSystem(system);
            this.systemToBatchIndex.delete(system);
        }
    }
    setDepthTexture(depthTexture) {
        this.depthTexture = depthTexture;
        for (const batch of this.batches) {
            batch.applyDepthTexture(depthTexture);
        }
    }
    updateSystem(system) {
        this.deleteSystem(system);
        this.addSystem(system);
    }
    update(delta) {
        this.systemToBatchIndex.forEach((value, ps) => {
            ps.update(delta);
        });
        for (let i = 0; i < this.batches.length; i++) {
            this.batches[i].update();
        }
    }
}

const BatchedParticleRenderer = BatchedRenderer;

class QuarksPrefab extends Group {
    constructor() {
        super();
        this.type = 'QuarksPrefab';
        this.animationData = [];
        this.isPlaying = false;
        this.currentTime = -1e-5;
        this.timeScale = 1;
        this.duration = 0;
        this._mixers = new Map();
        this._tempAnimationJSON = [];
        this._clock = new Clock(true);
    }
    registerBatchedRenderer(renderer) {
        this._batchedRenderer = renderer;
    }
    getOrCreateMixer(target) {
        if (!this._mixers.has(target)) {
            const mixer = new AnimationMixer(target);
            this._mixers.set(target, mixer);
        }
        return this._mixers.get(target);
    }
    addThreeAnimation(target, clip, startTime = 0, duration = clip.duration, loop = false) {
        const mixer = this.getOrCreateMixer(target);
        const action = mixer.clipAction(clip);
        if (!loop) {
            action.setLoop(LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        const data = {
            startTime,
            duration,
            type: 'three',
            loop,
            target,
            clip,
            mixer,
            action
        };
        this.animationData.push(data);
        this.updateDuration();
        return data;
    }
    addParticleSystemAnimation(emitter, startTime = 0, duration = 0, loop = false) {
        if (duration <= 0) {
            duration = emitter.system.duration;
        }
        const data = {
            startTime,
            duration,
            type: 'ps',
            loop,
            target: emitter
        };
        this.animationData.push(data);
        this.pause();
        this.updateDuration();
        return data;
    }
    removeAnimation(index) {
        this.animationData.splice(index, 1);
        this.updateDuration();
    }
    play() {
        if (this.isPlaying)
            return;
        this.isPlaying = true;
    }
    pause() {
        if (!this.isPlaying)
            return;
        this.isPlaying = false;
        this.animationData.forEach(anim => {
            if (anim.target) {
                if (anim.type === 'ps' && !anim.target.system.paused) {
                    anim.target.system.pause();
                }
                else if (anim.type === 'three' && anim.action && anim.action.isRunning()) {
                    anim.action.paused = true;
                }
            }
        });
    }
    stop() {
        this.pause();
        this.currentTime = -1e-5;
        this.animationData.forEach(anim => {
            if (anim.type === 'ps' && anim.target) {
                anim.target.system.stop();
            }
            else if (anim.type === 'three' && anim.mixer && anim.action) {
                anim.action.reset();
            }
        });
    }
    update(forceDelta) {
        if (!this.isPlaying)
            return;
        const delta = forceDelta !== undefined ? forceDelta : this._clock.getDelta();
        this.currentTime += delta * this.timeScale;
        if (this.currentTime > this.duration) {
            this.stop();
        }
        const currentMixers = new Set();
        this.animationData.forEach(anim => {
            const { startTime, duration, type, loop, target, action, mixer } = anim;
            const animationEndTime = startTime + duration;
            const isTimeToStart = this.currentTime >= startTime;
            const isTimeToEnd = this.currentTime > animationEndTime;
            const isStartFrame = Math.abs(this.currentTime - startTime) < delta;
            if (type === 'three' && action && mixer) {
                if (isTimeToStart && !isTimeToEnd) {
                    if (isStartFrame) {
                        action.reset();
                        action.play();
                    }
                    else {
                        if (action.paused) {
                            action.paused = false;
                            action.play();
                        }
                    }
                    this.currentTime - startTime;
                    currentMixers.add(mixer);
                }
                else if (isTimeToEnd) {
                    action.paused = true;
                }
            }
            else if (type === 'ps' && target) {
                if (isTimeToStart && !isTimeToEnd) {
                    if (isStartFrame) {
                        anim.target.system.restart();
                    }
                }
                else if (isTimeToEnd) {
                    anim.target.system.endEmit();
                }
            }
        });
        currentMixers.forEach(mixer => {
            mixer.update(delta);
        });
    }
    setTime(time) {
        const previousTime = this.currentTime;
        this.currentTime = time;
        this.animationData.forEach(anim => {
            const { startTime, duration, type, target, action, mixer } = anim;
            if (type === 'three' && action && mixer) {
                action.reset();
                if (time >= startTime && time < startTime + duration) {
                    const localTime = time - startTime;
                    action.time = localTime;
                    action.play();
                    mixer.update(0);
                    action.paused = !this.isPlaying;
                }
            }
            else if (type === 'ps' && target) {
                if (time >= startTime && time < startTime + duration) {
                    if (previousTime < startTime || previousTime >= startTime + duration) {
                        target.system.restart();
                    }
                }
                else {
                    target.system.endEmit();
                }
            }
        });
    }
    getDuration() {
        return this.duration;
    }
    updateDuration() {
        let maxDuration = 0;
        this.animationData.forEach(anim => {
            const endTime = anim.startTime + anim.duration;
            if (endTime > maxDuration) {
                maxDuration = endTime;
            }
        });
        this.duration = maxDuration;
    }
    resolveReferences(root) {
        this._tempAnimationJSON.forEach(animJson => {
            let target;
            root.traverse(object => {
                if (object.uuid === animJson.targetUUID) {
                    target = object;
                }
            });
            if (target) {
                if (animJson.type === 'three' && animJson.clipUUID) {
                    let clip;
                    if (target.animations) {
                        clip = target.animations.find(c => c.uuid === animJson.clipUUID);
                    }
                    if (clip) {
                        this.addThreeAnimation(target, clip, animJson.startTime, animJson.duration, animJson.loop);
                    }
                }
                else if (animJson.type === 'ps') {
                    this.addParticleSystemAnimation(target, animJson.startTime, animJson.duration, animJson.loop);
                }
            }
        });
        this.updateDuration();
        this._tempAnimationJSON = [];
    }
    toJSON() {
        const json = super.toJSON();
        json.object.animationData = this.animationData.map(anim => ({
            startTime: anim.startTime,
            duration: anim.duration,
            type: anim.type,
            targetUUID: anim.target.uuid,
            clipUUID: anim.clip?.uuid,
            loop: anim.loop
        }));
        return json;
    }
    static fromJSON(json) {
        const prefab = new QuarksPrefab();
        if (json.animationData) {
            prefab._tempAnimationJSON = json.animationData;
        }
        return prefab;
    }
}

class QuarksLoader extends ObjectLoader {
    constructor(manager) {
        super(manager);
    }
    linkReference(object) {
        const objectsMap = {};
        object.traverse(function (child) {
            objectsMap[child.uuid] = child;
        });
        object.traverse(function (child) {
            if (child.type === 'ParticleEmitter') {
                const system = child.system;
                system.emitterShape;
                for (let i = 0; i < system.behaviors.length; i++) {
                    if (system.behaviors[i] instanceof EmitSubParticleSystem) {
                        system.behaviors[i].subParticleSystem = objectsMap[system.behaviors[i].subParticleSystem];
                    }
                }
            }
        });
    }
    parse(json, onLoad) {
        const object = super.parse(json, onLoad);
        this.linkReference(object);
        return object;
    }
    parseObject(data, geometries, materials, textures, animations) {
        let object;
        function getGeometry(name) {
            if (geometries[name] === undefined) {
                console.warn('THREE.ObjectLoader: Undefined geometry', name);
            }
            return geometries[name];
        }
        function getMaterial(name) {
            if (name === undefined)
                return undefined;
            if (Array.isArray(name)) {
                const array = [];
                for (let i = 0, l = name.length; i < l; i++) {
                    const uuid = name[i];
                    if (materials[uuid] === undefined) {
                        console.warn('THREE.ObjectLoader: Undefined material', uuid);
                    }
                    array.push(materials[uuid]);
                }
                return array;
            }
            if (materials[name] === undefined) {
                console.warn('THREE.ObjectLoader: Undefined material', name);
            }
            return materials[name];
        }
        function getTexture(uuid) {
            if (textures[uuid] === undefined) {
                console.warn('THREE.ObjectLoader: Undefined texture', uuid);
            }
            return textures[uuid];
        }
        let geometry, material;
        const meta = {
            textures: textures,
            geometries: geometries,
            materials: materials,
        };
        const dependencies = {};
        switch (data.type) {
            case 'QuarksPrefab':
                object = QuarksPrefab.fromJSON(data);
                break;
            case 'ParticleEmitter':
                object = ParticleSystem.fromJSON(data.ps, meta, dependencies).emitter;
                break;
            case 'Scene':
                object = new Scene();
                if (data.background !== undefined) {
                    if (Number.isInteger(data.background)) {
                        object.background = new Color(data.background);
                    }
                    else {
                        object.background = getTexture(data.background);
                    }
                }
                if (data.environment !== undefined) {
                    object.environment = getTexture(data.environment);
                }
                if (data.fog !== undefined) {
                    if (data.fog.type === 'Fog') {
                        object.fog = new Fog(data.fog.color, data.fog.near, data.fog.far);
                    }
                    else if (data.fog.type === 'FogExp2') {
                        object.fog = new FogExp2(data.fog.color, data.fog.density);
                    }
                    if (data.fog.name !== '') {
                        object.fog.name = data.fog.name;
                    }
                }
                if (data.backgroundBlurriness !== undefined)
                    object.backgroundBlurriness = data.backgroundBlurriness;
                if (data.backgroundIntensity !== undefined)
                    object.backgroundIntensity = data.backgroundIntensity;
                if (data.backgroundRotation !== undefined)
                    object.backgroundRotation.fromArray(data.backgroundRotation);
                if (data.environmentIntensity !== undefined)
                    object.environmentIntensity = data.environmentIntensity;
                if (data.environmentRotation !== undefined)
                    object.environmentRotation.fromArray(data.environmentRotation);
                break;
            case 'PerspectiveCamera':
                object = new PerspectiveCamera(data.fov, data.aspect, data.near, data.far);
                if (data.focus !== undefined)
                    object.focus = data.focus;
                if (data.zoom !== undefined)
                    object.zoom = data.zoom;
                if (data.filmGauge !== undefined)
                    object.filmGauge = data.filmGauge;
                if (data.filmOffset !== undefined)
                    object.filmOffset = data.filmOffset;
                if (data.view !== undefined)
                    object.view = Object.assign({}, data.view);
                break;
            case 'OrthographicCamera':
                object = new OrthographicCamera(data.left, data.right, data.top, data.bottom, data.near, data.far);
                if (data.zoom !== undefined)
                    object.zoom = data.zoom;
                if (data.view !== undefined)
                    object.view = Object.assign({}, data.view);
                break;
            case 'AmbientLight':
                object = new AmbientLight(data.color, data.intensity);
                break;
            case 'DirectionalLight':
                object = new DirectionalLight(data.color, data.intensity);
                break;
            case 'PointLight':
                object = new PointLight(data.color, data.intensity, data.distance, data.decay);
                break;
            case 'RectAreaLight':
                object = new RectAreaLight(data.color, data.intensity, data.width, data.height);
                break;
            case 'SpotLight':
                object = new SpotLight(data.color, data.intensity, data.distance, data.angle, data.penumbra, data.decay);
                break;
            case 'HemisphereLight':
                object = new HemisphereLight(data.color, data.groundColor, data.intensity);
                break;
            case 'LightProbe':
                object = new LightProbe();
                if (data.sh !== undefined) {
                    object.sh = new SphericalHarmonics3().fromArray(data.sh);
                }
                break;
            case 'SkinnedMesh':
                geometry = getGeometry(data.geometry);
                material = getMaterial(data.material);
                object = new SkinnedMesh(geometry, material);
                if (data.bindMode !== undefined)
                    object.bindMode = data.bindMode;
                if (data.bindMatrix !== undefined)
                    object.bindMatrix.fromArray(data.bindMatrix);
                if (data.skeleton !== undefined)
                    object.skeleton = data.skeleton;
                break;
            case 'Mesh':
                geometry = getGeometry(data.geometry);
                material = getMaterial(data.material);
                object = new Mesh(geometry, material);
                break;
            case 'InstancedMesh': {
                geometry = getGeometry(data.geometry);
                material = getMaterial(data.material);
                const count = data.count;
                const instanceMatrix = data.instanceMatrix;
                const instanceColor = data.instanceColor;
                object = new InstancedMesh(geometry, material, count);
                object.instanceMatrix = new InstancedBufferAttribute(new Float32Array(instanceMatrix.array), 16);
                if (instanceColor !== undefined)
                    object.instanceColor = new InstancedBufferAttribute(new Float32Array(instanceColor.array), instanceColor.itemSize);
                break;
            }
            case 'BatchedMesh':
                geometry = getGeometry(data.geometry);
                material = getMaterial(data.material);
                object = new BatchedMesh(data.maxGeometryCount, data.maxVertexCount, data.maxIndexCount, material);
                object.geometry = geometry;
                object.perObjectFrustumCulled = data.perObjectFrustumCulled;
                object.sortObjects = data.sortObjects;
                object._drawRanges = data.drawRanges;
                object._reservedRanges = data.reservedRanges;
                object._visibility = data.visibility;
                object._active = data.active;
                object._bounds = data.bounds.map((bound) => {
                    const box = new Box3();
                    box.min.fromArray(bound.boxMin);
                    box.max.fromArray(bound.boxMax);
                    const sphere = new Sphere();
                    sphere.radius = bound.sphereRadius;
                    sphere.center.fromArray(bound.sphereCenter);
                    return {
                        boxInitialized: bound.boxInitialized,
                        box: box,
                        sphereInitialized: bound.sphereInitialized,
                        sphere: sphere,
                    };
                });
                object._maxGeometryCount = data.maxGeometryCount;
                object._maxVertexCount = data.maxVertexCount;
                object._maxIndexCount = data.maxIndexCount;
                object._geometryInitialized = data.geometryInitialized;
                object._geometryCount = data.geometryCount;
                object._matricesTexture = getTexture(data.matricesTexture.uuid);
                break;
            case 'LOD':
                object = new LOD();
                break;
            case 'Line':
                object = new Line(getGeometry(data.geometry), getMaterial(data.material));
                break;
            case 'LineLoop':
                object = new LineLoop(getGeometry(data.geometry), getMaterial(data.material));
                break;
            case 'LineSegments':
                object = new LineSegments(getGeometry(data.geometry), getMaterial(data.material));
                break;
            case 'PointCloud':
            case 'Points':
                object = new Points(getGeometry(data.geometry), getMaterial(data.material));
                break;
            case 'Sprite':
                object = new Sprite(getMaterial(data.material));
                break;
            case 'Group':
                object = new Group();
                break;
            case 'Bone':
                object = new Bone();
                break;
            default:
                object = new Object3D();
        }
        object.uuid = data.uuid;
        if (data.name !== undefined)
            object.name = data.name;
        if (data.matrix !== undefined) {
            object.matrix.fromArray(data.matrix);
            if (data.matrixAutoUpdate !== undefined)
                object.matrixAutoUpdate = data.matrixAutoUpdate;
            if (object.matrixAutoUpdate) {
                object.matrix.decompose(object.position, object.quaternion, object.scale);
                if (isNaN(object.quaternion.x)) {
                    object.quaternion.set(0, 0, 0, 1);
                }
            }
        }
        else {
            if (data.position !== undefined)
                object.position.fromArray(data.position);
            if (data.rotation !== undefined)
                object.rotation.fromArray(data.rotation);
            if (data.quaternion !== undefined)
                object.quaternion.fromArray(data.quaternion);
            if (data.scale !== undefined)
                object.scale.fromArray(data.scale);
        }
        if (data.up !== undefined)
            object.up.fromArray(data.up);
        if (data.castShadow !== undefined)
            object.castShadow = data.castShadow;
        if (data.receiveShadow !== undefined)
            object.receiveShadow = data.receiveShadow;
        if (data.shadow) {
            if (data.shadow.bias !== undefined)
                object.shadow.bias = data.shadow.bias;
            if (data.shadow.normalBias !== undefined)
                object.normalBias = data.shadow.normalBias;
            if (data.shadow.radius !== undefined)
                object.radius = data.shadow.radius;
            if (data.shadow.mapSize !== undefined)
                object.mapSize.fromArray(data.shadow.mapSize);
            if (data.shadow.camera !== undefined) {
                object.camera = this.parseObject(data.shadow.camera);
            }
        }
        if (data.visible !== undefined)
            object.visible = data.visible;
        if (data.frustumCulled !== undefined)
            object.frustumCulled = data.frustumCulled;
        if (data.renderOrder !== undefined)
            object.renderOrder = data.renderOrder;
        if (data.userData !== undefined)
            object.userData = data.userData;
        if (data.layers !== undefined)
            object.layers.mask = data.layers;
        if (data.children !== undefined) {
            const children = data.children;
            for (let i = 0; i < children.length; i++) {
                object.add(this.parseObject(children[i], geometries, materials, textures, animations));
            }
        }
        if (data.animations !== undefined) {
            const objectAnimations = data.animations;
            for (let i = 0; i < objectAnimations.length; i++) {
                const uuid = objectAnimations[i];
                object.animations.push(animations[uuid]);
            }
        }
        if (data.type === 'LOD') {
            if (data.autoUpdate !== undefined)
                object.autoUpdate = data.autoUpdate;
            const levels = data.levels;
            for (let l = 0; l < levels.length; l++) {
                const level = levels[l];
                const child = object.getObjectByProperty('uuid', level.object);
                if (child !== undefined) {
                    object.addLevel(child, level.distance);
                }
            }
        }
        else if (data.type === 'QuarksPrefab') {
            object.resolveReferences(object);
        }
        return object;
    }
}

class QuarksUtil {
    static runOnAllParticleEmitters(obj, func) {
        obj.traverse((child) => {
            if (child.type === 'ParticleEmitter') {
                func(child);
            }
        });
        if (obj.type === 'ParticleEmitter') {
            func(obj);
        }
    }
    static addToBatchRenderer(obj, batchRenderer) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            batchRenderer.addSystem(ps.system);
        });
    }
    static play(obj) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.play();
        });
    }
    static stop(obj) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.stop();
        });
    }
    static setAutoDestroy(obj, value) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.autoDestroy = value;
        });
    }
    static endEmit(obj) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.endEmit();
        });
    }
    static restart(obj) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.restart();
        });
    }
    static pause(obj) {
        QuarksUtil.runOnAllParticleEmitters(obj, (ps) => {
            ps.system.pause();
        });
    }
}

registerShaderChunks();
loadPlugin(MeshSurfaceEmitterPlugin);
console.log('%c Particle system powered by three.quarks. https://quarks.art/', 'font-size: 14px; font-weight: bold;');

export { BatchedParticleRenderer, BatchedRenderer, MeshSurfaceEmitter, MeshSurfaceEmitterPlugin, ParticleEmitter, ParticleMeshPhysicsMaterial, ParticleMeshStandardMaterial, ParticleSystem, QuarksLoader, QuarksPrefab, QuarksUtil, RenderMode, SpriteBatch, TrailBatch, VFXBatch, registerShaderChunks };
