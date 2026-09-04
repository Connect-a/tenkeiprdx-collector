import * as THREE from '../../vendor/three.module.js';

export function createSky(scene, renderer) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { envMap: { value: null }, backgroundRotation: { value: new THREE.Matrix3() } },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: [
      'varying vec3 vWorldDirection;',
      'void main(){',
      '  vWorldDirection = ( modelMatrix * vec4( position, 0.0 ) ).xyz;',
      '  gl_Position = ( projectionMatrix * modelViewMatrix * vec4( position, 1.0 ) ).xyww;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform samplerCube envMap;',
      'uniform mat3 backgroundRotation;',
      'varying vec3 vWorldDirection;',
      'void main(){',
      '  gl_FragColor = textureCube( envMap, backgroundRotation * normalize( vWorldDirection ) );',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.visible = false;
  mesh.onBeforeRender = function (r, s, cam) {
    this.matrixWorld.copyPosition(cam.matrixWorld);
  };
  scene.add(mesh);
  let rt = null;

  return {
    mesh,
    set(bg, rotation) {
      if (rt) {
        rt.dispose();
        rt = null;
      }
      mat.uniforms.envMap.value = null;
      mesh.visible = false;
      scene.background = null;
      if (!bg) return;
      if (bg.isColor) {
        scene.background = bg;
        return;
      }
      let cube = bg.isCubeTexture ? bg : null;
      if (!cube && bg.isTexture && bg.image && bg.image.height > 0) {
        rt = new THREE.WebGLCubeRenderTarget(bg.image.height);
        rt.fromEquirectangularTexture(renderer, bg);
        cube = rt.texture;
      }
      if (!cube) return;
      mat.uniforms.envMap.value = cube;
      mat.uniforms.backgroundRotation.value.setFromMatrix4(new THREE.Matrix4().makeRotationY(rotation || 0)).transpose();
      mesh.visible = true;
    },
    dispose() {
      if (rt) rt.dispose();
      rt = null;
      scene.remove(mesh);
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
