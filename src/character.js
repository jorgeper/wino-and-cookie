import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Adapted from three-stuff-demo/src/character.js. Same models, clips and gait logic;
// the differences are game-oriented: world-space steering (so AI and players share one
// code path), a knock-back velocity, and a floor height that can drop away (sumo).
const DEFAULTS = {
  walkSpeed: 1.3,       // m/s
  runSpeed: 3.4,        // m/s
  accel: 10,            // how quickly we reach target speed
  turnSpeed: 12,        // how quickly we face the move direction
  jumpVelocity: 6.2,    // m/s upward at take-off (~1 m jump)
  gravity: 20,          // m/s²
  jumpStartSpeed: 2.2,  // play the anticipation fast so jumps feel responsive
  fade: 0.2,            // crossfade between clips, seconds
  knockDrag: 4.5,       // how quickly knock-back dies away
};

const ROLE_NAMES = {
  idle: ['idle', 'stand', 'breathe'],
  walk: ['walk', 'waddle'],
  run: ['run', 'sprint', 'jog'],
  jumpStart: ['jumpstart', 'takeoff', 'jumpbegin'],
  jumpAir: ['jumpair', 'airborne', 'fall', 'jumploop', 'jump'],
  land: ['land', 'landing', 'jumpend'],
};
const FALLBACK = { run: 'walk', walk: 'idle', jumpAir: 'idle' };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export class Character {
  /**
   * @param gltf   loaded glTF (shared between every copy of this character)
   * @param entry  manifest entry merged with per-game overrides (scale, runSpeed, ...)
   */
  constructor(gltf, entry) {
    this.id = entry.id;
    this.name = entry.name;
    this.color = new THREE.Color(entry.color || '#3d6bff');
    this.entry = entry;
    const scale = entry.scale ?? 1;
    this.opts = { ...DEFAULTS, ...entry };
    this.scale = scale;

    this.root = new THREE.Group();
    this.root.name = `character:${this.id}`;
    this.model = SkeletonUtils.clone(gltf.scene);
    this.model.scale.setScalar(scale);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false;
      }
    });

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    this.height = size.y || scale;
    this.radius = (Math.max(size.x, size.z) * 0.5 || 0.4) * 0.92;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = gltf.animations;
    this.actions = {};
    for (const clip of this.clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.roles = {};
    for (const [role, names] of Object.entries(ROLE_NAMES)) {
      const clip = names.map((n) => this.clips.find((c) => norm(c.name) === n)).find(Boolean);
      if (clip) this.roles[role] = clip.name;
    }
    for (const [role, fb] of Object.entries(FALLBACK)) this.roles[role] ??= this.roles[fb];
    this.roles.idle ??= this.clips[0]?.name;
    this.mixer.addEventListener('finished', (e) => this.onClipFinished(e.action));

    this.gaits = { walk: this.makeGait('walk', entry, scale), run: this.makeGait('run', entry, scale) };

    this.moveVel = new THREE.Vector3();   // smoothed intended horizontal velocity
    this.velocity = new THREE.Vector3();  // actual velocity this frame (incl. vertical)
    this.knock = new THREE.Vector3();     // knock-back, decays on its own
    this.floorY = 0;                      // height of the ground under us
    this.speedMul = 1;                    // handicap / boost
    this.state = 'ground';                // ground | jumpStart | air | land
    this.current = null;
    this.play(this.roles.idle, 0);
    if (this.current) this.current.time = Math.random() * this.current.getClip().duration;
  }

  get position() { return this.root.position; }
  get grounded() { return this.state === 'ground' || this.state === 'land'; }
  /** Horizontal speed including knock-back. */
  get vx() { return this.velocity.x + this.knock.x; }
  get vz() { return this.velocity.z + this.knock.z; }
  /** Unit vector the character is facing (model front is +Z). */
  facing(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
  }

  makeGait(role, entry, scale) {
    const clip = this.roles[role];
    const measured = clip && entry.locomotion?.[clip];
    const speed = this.opts[`${role}Speed`];
    if (measured?.speed) {
      // Footed characters: play the clip faster to keep up with the game speed.
      const natural = measured.speed * scale;
      const playRate = THREE.MathUtils.clamp(speed / natural, 0.5, 2.4);
      return { clip, speed, playRate, profile: measured.profile };
    }
    return { clip, speed, playRate: 1, profile: measured?.profile ?? null };
  }

  profileAt(gait, action) {
    const p = gait.profile;
    if (!p || !action) return 1;
    const x = (action.time / action.getClip().duration) * p.length;
    const i = Math.floor(x) % p.length;
    const f = x - Math.floor(x);
    return p[i] * (1 - f) + p[(i + 1) % p.length] * f;
  }

  play(clipName, fade = this.opts.fade, { once = false, speed = 1 } = {}) {
    const next = clipName && this.actions[clipName];
    if (!next) return;
    if (next === this.current && !once) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = speed;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) {
      if (fade > 0) this.current.crossFadeTo(next, fade, false);
      else this.current.stop();
    }
    this.current = next;
  }

  playRole(role, fade, opts) { this.play(this.roles[role], fade, opts); }

  onClipFinished(action) {
    if (action !== this.current) return;
    if (this.state === 'jumpStart') this.takeOff();
    else if (this.state === 'land') { this.state = 'ground'; this.updateLocomotionClip(true); }
  }

  takeOff(v = this.opts.jumpVelocity) {
    this.state = 'air';
    this.velocity.y = v;
    this.playRole('jumpAir', 0.1);
  }

  /** Full jump with the wind-up animation. */
  jump() {
    if (!this.grounded) return false;
    if (this.roles.jumpStart) {
      this.state = 'jumpStart';
      this.playRole('jumpStart', 0.08, { once: true, speed: this.opts.jumpStartSpeed });
    } else this.takeOff();
    return true;
  }

  /** Instant little hop (kicks, pounces, happy bounces). */
  hop(v = 3.5) {
    if (!this.grounded && this.state !== 'jumpStart') return false;
    this.takeOff(v);
    return true;
  }

  /** Turn towards a world yaw without moving. */
  faceYaw(yaw, dt, speed = this.opts.turnSpeed) {
    let d = yaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * (1 - Math.exp(-speed * dt));
  }
  facePoint(x, z, dt, speed) { this.faceYaw(Math.atan2(x - this.position.x, z - this.position.z), dt, speed); }

  /** Put the character somewhere, standing still. */
  place(x, z, yaw = 0) {
    this.root.position.set(x, this.floorY, z);
    this.root.rotation.y = yaw;
    this.moveVel.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.state = 'ground';
    this.updateLocomotionClip(true);
  }

  /**
   * @param {number} dt
   * @param {{x: number, z: number, run?: boolean} | null} input  world-space direction, length 0..1
   */
  update(dt, input) {
    const o = this.opts;
    const mag = input ? Math.hypot(input.x, input.z) : 0;
    const moving = mag > 0.05;
    const run = moving && input.run !== false;
    const gait = moving ? this.gaits[run ? 'run' : 'walk'] : null;

    let tx = 0, tz = 0;
    if (gait) {
      const s = (gait.speed * this.speedMul * Math.min(mag, 1)) / mag;
      tx = input.x * s;
      tz = input.z * s;
    }
    // No steering during the jump wind-up; reduced control in the air.
    const control = this.state === 'jumpStart' ? 0.25 : this.state === 'air' ? 0.5 : 1;
    const k = 1 - Math.exp(-o.accel * control * dt);
    this.moveVel.x += (tx - this.moveVel.x) * k;
    this.moveVel.z += (tz - this.moveVel.z) * k;
    const baseSpeed = Math.hypot(this.moveVel.x, this.moveVel.z);

    if (moving && baseSpeed > 0.05) this.faceYaw(Math.atan2(this.moveVel.x, this.moveVel.z), dt);

    if (this.state === 'ground') this.updateLocomotionClip(false, moving, run);
    if (this.state === 'land' && moving && this.current && this.current.time > this.current.getClip().duration * 0.3) {
      this.state = 'ground';
      this.updateLocomotionClip(false, moving, run);
    }

    // On the ground the clip decides how far we move this frame (hoppers travel mid-hop).
    let mult = 1;
    const active = this.state === 'ground' && this.locoRole !== 'idle' ? this.gaits[this.locoRole] : null;
    if (active && this.current?.getClip().name === active.clip) {
      mult = this.profileAt(active, this.current);
      this.current.timeScale = active.playRate * THREE.MathUtils.clamp(baseSpeed / active.speed, 0.35, 1.5);
    }
    this.velocity.x = this.moveVel.x * mult;
    this.velocity.z = this.moveVel.z * mult;

    const p = this.root.position;
    p.x += (this.velocity.x + this.knock.x) * dt;
    p.z += (this.velocity.z + this.knock.z) * dt;
    const kd = Math.exp(-o.knockDrag * dt);
    this.knock.x *= kd;
    this.knock.z *= kd;

    // Vertical motion. Walking off a ledge starts a fall.
    if (this.state !== 'air' && p.y > this.floorY + 0.02) {
      this.state = 'air';
      this.playRole('jumpAir', 0.15);
    }
    if (this.state === 'air') this.velocity.y -= o.gravity * dt;
    p.y += this.velocity.y * dt;
    if (p.y <= this.floorY) {
      p.y = this.floorY;
      if (this.state === 'air' && this.velocity.y <= 0) this.landNow();
      if (this.state !== 'air') this.velocity.y = 0;
    }

    this.mixer.update(dt);
  }

  landNow() {
    if (this.roles.land) {
      this.state = 'land';
      this.playRole('land', 0.08, { once: true, speed: 1.4 });
    } else {
      this.state = 'ground';
      this.updateLocomotionClip(true);
    }
  }

  updateLocomotionClip(force, moving = false, run = false) {
    const role = moving ? (run ? 'run' : 'walk') : 'idle';
    if (force || this.locoRole !== role || this.current?.getClip().name !== this.roles[role]) {
      const prev = this.current;
      const syncPhase = prev && (this.locoRole === 'walk' || this.locoRole === 'run') && (role === 'walk' || role === 'run')
        ? prev.time / prev.getClip().duration : null;
      this.locoRole = role;
      this.playRole(role);
      if (syncPhase !== null && this.current !== prev) this.current.time = syncPhase * this.current.getClip().duration;
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    for (const e of this.fabric?.entries || []) {
      e.fabric.dispose();
      for (const s of e.shells) s.material.dispose();
    }
  }
}
