import * as THREE from 'three';

/**
 * Photo mode (Testing Ground): freezes the scene and path-traces it (real light bounces,
 * soft contact shadows, colour bleeding). It refines progressively; the longer you wait
 * the cleaner it gets. Moving the camera restarts it.
 *
 * Things the path tracer can't do (the grid shader, the fake contact shadows, the fur
 * shells, the selection rings) are swapped out or hidden while it runs.
 * The path tracer is only downloaded the first time photo mode is opened.
 */
export class PhotoMode {
  constructor({ renderer, scene, camera, controls, ground, getHidden }) {
    Object.assign(this, { renderer, scene, camera, controls, ground, getHidden });
    this.active = false;
    this.tracer = null;
    this.saved = null;
    this.onCameraChange = () => this.tracer?.updateCamera();
  }

  gridTexture() {
    if (this._grid) return this._grid;
    // One 10 m tile: faint 5 m checker, 1 m lines, stronger 5 m lines (matches the live floor).
    const px = 1024, cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const g = cv.getContext('2d');
    const m = px / 10;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px);
    g.fillStyle = '#eff1f6'; g.fillRect(0, 0, px / 2, px / 2); g.fillRect(px / 2, px / 2, px / 2, px / 2);
    g.fillStyle = '#dde1e8';
    for (let i = 0; i <= 10; i++) { g.fillRect(i * m - 0.75, 0, 1.5, px); g.fillRect(0, i * m - 0.75, px, 1.5); }
    g.fillStyle = '#b4bbc7';
    for (const i of [0, 5, 10]) { g.fillRect(i * m - 1.25, 0, 2.5, px); g.fillRect(0, i * m - 1.25, px, 2.5); }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 40); // the floor is 400 m wide
    t.anisotropy = 8;
    this._grid = t;
    return t;
  }

  /** @param L the current mood (see MOODS in engine.js): sky / ground light colours */
  async enter(L) {
    if (this.active) return;
    this.active = true;
    const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
    if (!this.active) return; // closed again while loading
    const { scene } = this;

    // Swap/hide what the path tracer can't render.
    const hidden = this.getHidden().filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const groundMat = this.ground.material;
    this.ground.material = new THREE.MeshStandardMaterial({ map: this.gridTexture(), roughness: 0.95 });
    const env = new GradientEquirectTexture(64);
    env.topColor.set(L.hemiSky).multiplyScalar(L.hemiI * 0.6);
    env.bottomColor.set(L.hemiGround).multiplyScalar(L.hemiI * 0.35);
    env.exponent = 2;
    env.update();
    const backdrop = new THREE.Color(L.horizon);
    this.saved = { hidden, groundMat, environment: scene.environment, envIntensity: scene.environmentIntensity, background: scene.background, env };
    scene.environment = env;
    scene.environmentIntensity = 1;
    scene.background = backdrop;

    if (!this.tracer) {
      const t = new WebGLPathTracer(this.renderer);
      t.bounces = 4;
      t.filterGlossyFactor = 0.5;
      t.minSamples = 1;
      t.renderDelay = 0;
      t.fadeDuration = 300;
      t.tiles.set(2, 2);
      t.renderScale = 0.75; // converges noticeably faster on big Retina screens
      this.tracer = t;
    }
    this.tracer.setScene(scene, this.camera); // small scene: building the BVH synchronously takes a moment
    this.ready = true;
    this.controls.addEventListener('change', this.onCameraChange);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.ready = false;
    const s = this.saved;
    if (!s) return;
    this.controls.removeEventListener('change', this.onCameraChange);
    this.ground.material.dispose();
    this.ground.material = s.groundMat;
    this.scene.environment = s.environment;
    this.scene.environmentIntensity = s.envIntensity;
    this.scene.background = s.background;
    s.env.dispose();
    s.hidden.forEach((o) => (o.visible = true));
    this.saved = null;
  }

  /** One more pass of refinement. Returns the sample count so far. */
  render() {
    this.tracer.renderSample();
    return Math.floor(this.tracer.samples);
  }

  /** Download the current frame (call right after render()). */
  save() {
    const a = document.createElement('a');
    a.download = `wino-and-cookie-photo-${Date.now()}.png`;
    a.href = this.renderer.domElement.toDataURL('image/png');
    a.click();
  }

  dispose() {
    this.exit();
    this.tracer?.dispose?.();
    this._grid?.dispose();
  }
}
