"""
One-off fix for characters/penguin-game-refined.blend.

The image "Penguin.Fabric.BaseColor.Clean" points at the refined, smooth
penguin-fabric-basecolor.png, but the copy packed inside the .blend was still the
original grainy Tripo JPEG. This loads the PNG from disk, re-packs it and saves.
"""
import bpy, os, hashlib

img = bpy.data.images["Penguin.Fabric.BaseColor.Clean"]
src = bpy.path.abspath(img.filepath)
assert os.path.exists(src), f"missing {src}"
before = hashlib.md5(bytes(img.packed_file.data)).hexdigest()[:12] if img.packed_file else None
if img.packed_file:
    img.unpack(method="REMOVE")      # drop the stale packed copy; keep the path to the PNG
img.filepath = src
img.source = "FILE"
img.reload()
img.pack()
after = hashlib.md5(bytes(img.packed_file.data)).hexdigest()[:12]
print(f"[texture] {img.name}: {before} -> {after}, {img.size[0]}x{img.size[1]}, {len(img.packed_file.data)} bytes")
bpy.ops.wm.save_mainfile()
print("[texture] saved", bpy.data.filepath)
