"""
Blender-side exporter: turns one .blend into one game-ready .glb.

Run by tools/export.mjs as:
  Blender -b --factory-startup --disable-autoexec file.blend --python tools/export_blend.py -- out.glb [maxTextureSize]

What it does (none of this is saved back to the .blend):
  * exports only objects that are visible in the viewport (hidden backups,
    bone-shape widgets, cameras and lights are skipped)
  * exports every Action as a separate animation clip, except ones whose name
    contains "preview" (demo clips) or starts with "_" (your private scratch clips)
  * shrinks textures larger than maxTextureSize and stores them as JPEG so the
    .glb stays small enough for the browser
  * prints a JSON line "EXPORT_INFO {...}" that the Node script reads
"""
import bpy, sys, json

argv = sys.argv[sys.argv.index("--") + 1:]
out_path = argv[0]
max_tex = int(argv[1]) if len(argv) > 1 else 2048


def skip_action(name: str) -> bool:
    return "preview" in name.lower() or name.startswith("_")


# 1. Drop demo / scratch actions so the exporter never sees them.
for action in list(bpy.data.actions):
    if skip_action(action.name):
        for obj in bpy.data.objects:
            ad = obj.animation_data
            if ad and ad.action == action:
                ad.action = None
        bpy.data.actions.remove(action)

clips = sorted(a.name for a in bpy.data.actions)
armatures = [o for o in bpy.data.objects if o.type == "ARMATURE" and o.visible_get()]


# 1b. Measure how each clip "travels", so the game can move the character in step
#     with the animation instead of sliding it.
#
#   * Rigs with foot bones (name contains foot/paw/toe): the lowest foot is the
#     planted one; how fast it moves backward is how fast the body should move
#     forward. -> "speed" (m/s at 1x playback) + a per-frame profile.
#   * Rigs without feet (hoppers): travel happens while the body is off the
#     ground. -> per-frame profile from the mesh's lowest point, no speed.
def measure_locomotion(arm):
    import numpy as np
    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    feet = [b for b in arm.pose.bones if any(k in b.name.lower() for k in ("foot", "paw", "toe"))]
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
              and any(m.type == "ARMATURE" and m.object == arm for m in o.modifiers)]
    ad = arm.animation_data or arm.animation_data_create()
    result = {}
    for action in bpy.data.actions:
        first, last = int(action.frame_range[0]), int(action.frame_range[1])
        if last - first < 4:
            continue
        ad.action = action
        if action.slots:
            ad.action_slot = action.slots[0]
        foot_y, foot_z, ground = [], [], []
        for f in range(first, last):          # last frame repeats the first
            scene.frame_set(f)
            if feet:
                pos = [arm.matrix_world @ b.head for b in feet]
                foot_y.append([p.y for p in pos])
                foot_z.append([p.z for p in pos])
            else:
                dg = bpy.context.evaluated_depsgraph_get()
                lows = []
                for o in meshes:
                    ev = o.evaluated_get(dg)
                    me = ev.to_mesh()
                    co = np.empty(len(me.vertices) * 3)
                    me.vertices.foreach_get("co", co)
                    co = co.reshape(-1, 3)
                    mw = np.array(ev.matrix_world)
                    lows.append((co @ mw[:3, :3].T + mw[:3, 3])[:, 2].min())
                    ev.to_mesh_clear()
                ground.append(min(lows))
        n = last - first
        if feet:
            y = np.array(foot_y)
            z = np.array(foot_z)
            planted = z.argmin(axis=1)
            # backward motion of the planted foot (forward is -Y in Blender)
            vel = (np.roll(y, -1, axis=0) - np.roll(y, 1, axis=0)) * fps / 2
            v = np.clip(vel[np.arange(n), planted], 0, None)
            speed = float(v.mean())
            if speed < 1e-3:
                continue
            profile = v / speed
            result[action.name] = {"mode": "feet", "speed": round(speed, 4),
                                   "profile": [round(float(x), 3) for x in profile]}
        else:
            c = np.array(ground) - min(ground)
            if c.max() < 0.01:                  # never leaves the ground: not a hop
                continue
            t = np.clip(c / (0.5 * c.max()), 0, 1)
            w = 0.03 + t * t * (3 - 2 * t)      # travel almost only while airborne
            profile = w / w.mean()
            result[action.name] = {"mode": "hop", "speed": None,
                                   "profile": [round(float(x), 3) for x in profile]}
    return result


locomotion = measure_locomotion(armatures[0]) if armatures else {}

# 2. Put every rig in its rest-ish state (no active action), so the bind pose is clean.
for arm in armatures:
    if arm.animation_data:
        arm.animation_data.action = None

# 3. Downscale big textures (in memory only).
for img in bpy.data.images:
    if img.size[0] > max_tex or img.size[1] > max_tex:
        w, h = img.size
        s = max_tex / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))

# 4. Export.
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_visible=True,
    export_cameras=False,
    export_lights=False,
    export_apply=False,          # keep the Armature modifier live (skinning)
    export_skins=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_frame_range=False,
    export_anim_slide_to_zero=True,
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_yup=True,
)

# Rough size info for the manifest (in Blender meters, Z-up).
height = 0.0
for o in bpy.data.objects:
    if o.type == "MESH" and o.visible_get():
        zs = [(o.matrix_world @ v.co).z for v in o.data.vertices]
        if zs:
            height = max(height, max(zs))

print("EXPORT_INFO " + json.dumps({
    "clips": clips,
    "armatures": [a.name for a in armatures],
    "height": round(height, 3),
    "fps": bpy.context.scene.render.fps,
    "locomotion": locomotion,
}))
