"""
One-off edit for characters/penguin-game-refined.blend: give Wino real strides.

The original Walk/Run moved each foot only 5-8 cm per step, so any useful travel
speed made the feet skate. This rewrites just the Foot.L / Foot.R *location*
keys of Walk and Run (rotation keys, body, wings, head etc. are untouched):

  * swing (first half of each foot's cycle): foot lifts and eases forward
  * stance (second half): foot stays on the ground and moves backward at a
    constant speed, so the game can match travel speed to it exactly

The untouched originals are kept in the file as "_Walk_orig" / "_Run_orig"
(the leading underscore keeps them out of the game export).

Run:  Blender -b --factory-startup --disable-autoexec characters/penguin-game-refined.blend \
        --python tools/blender/penguin_strides.py
"""
import bpy, math
from mathutils import Vector

RIG = "Penguin.Rig"
# A = half stride (m, Blender units, before the in-game scale), H = foot lift height.
SPEC = {
    "Walk": dict(A=0.11, H=0.045),
    "Run":  dict(A=0.15, H=0.07),
}
FEET = (("Foot.L", 0.0), ("Foot.R", 0.5))  # R foot is half a cycle behind L, as in the original


def smootherstep(x):
    return x * x * x * (x * (x * 6 - 15) + 10)


def foot_offset(p, A, H):
    """World-space (forward is -Y) offset of a foot at cycle phase p in [0,1)."""
    if p < 0.5:                         # swing: back (+A) to front (-A), lifted
        s = p / 0.5
        return Vector((0.0, A - 2 * A * smootherstep(s), H * math.sin(math.pi * s)))
    s = (p - 0.5) / 0.5                 # stance: front to back, constant speed, on the ground
    return Vector((0.0, -A + 2 * A * s, 0.0))


def channelbag(action):
    return action.layers[0].strips[0].channelbags[0]


arm = bpy.data.objects[RIG]
for name, spec in SPEC.items():
    orig_name = f"_{name}_orig"
    if orig_name in bpy.data.actions:          # re-running: start again from the original
        bpy.data.actions.remove(bpy.data.actions[name])
        action = bpy.data.actions[orig_name].copy()
        action.name = name
    else:
        action = bpy.data.actions[name]
        backup = action.copy()
        backup.name = orig_name
    for a in (action, bpy.data.actions[orig_name]):
        a.use_fake_user = True

    first, last = int(action.frame_range[0]), int(action.frame_range[1])
    period = last - first                       # last frame repeats the first
    cb = channelbag(action)
    for bone_name, phase_offset in FEET:
        to_local = arm.data.bones[bone_name].matrix_local.to_3x3().transposed()
        curves = [cb.fcurves.find(f'pose.bones["{bone_name}"].location', index=i) for i in range(3)]
        for fc_index, fc in enumerate(curves):
            if fc is None or fc_index == 0:      # leave sideways (x) motion as authored
                continue
            for kp in fc.keyframe_points:
                p = ((kp.co[0] - first) / period + phase_offset) % 1.0
                local = to_local @ foot_offset(p, **spec)
                kp.co[1] = local[fc_index]
                kp.handle_left[1] = kp.handle_right[1] = kp.co[1]
                kp.interpolation = "LINEAR"
            fc.update()
    print(f"[strides] {name}: half-stride {spec['A']*100:.0f} cm, lift {spec['H']*100:.0f} cm")

# Leave the rig showing Idle like before.
if "Idle" in bpy.data.actions:
    arm.animation_data.action = bpy.data.actions["Idle"]
bpy.ops.wm.save_mainfile()
print("[strides] saved", bpy.data.filepath)
