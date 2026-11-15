---
name: cozy-game-assets
description: Write consistent image prompts and generate consistent front, back, left, and right views of cozy stylized 3D game assets matching the bundled approved tree reference. Save each asset's images and prompts in its own named folder under the current project's assets folder. Use for assets in this visual style, not actual 3D mesh creation or unrelated art styles.
---

# Cozy game assets

Create reusable prompts and, when requested, raster asset images in the visual style of [the approved tree](references/style-tree.png). This image is the visual source of truth. The target is a clean stylized 3D render, not a mesh or a realistic object photograph.

## Style lock

- Simple, chunky silhouettes with generous rounded volumes; a few overlapping puffy shapes, like clay or marshmallow. Smooth surfaces, gently beveled edges, no sharp low-poly facets.
- Soft matte materials with broad hand-painted color variation. Warm, cheerful midtones, lighter warm highlights on top, deeper cooler shading underneath. Keep saturation and contrast comparable to the reference; avoid neon highlights.
- Sparse painted details that describe the material without adding fine geometry: a few leaf clumps, simple bark strokes, or equivalent broad marks appropriate to the subject. No realistic pores, fabric fuzz, stitching, grain microtexture, or dense fine detail.
- Slightly chunky, friendly proportions. No faces by default; preserve explicit user requests for character features.
- Soft even studio lighting, gentle ambient occlusion and a subtle contact shadow. No dramatic directional lighting, hard shadows, glossy plastic, metallic glare, outlines, or photorealism.
- Generate four separate cardinal views of each asset: front, back, left, and right. Use an orthographic, eye-level camera with no elevation or three-quarter angle; keep camera scale, canvas dimensions, vertical alignment, and margins consistent across the set. Show one isolated whole object per image. The tree reference controls style; these cardinal-view requirements override its three-quarter camera.
- Plain light grey background by default. Use genuine transparency if requested, retaining the same object lighting and materials.
- Apply the reference's visual language to the requested subject. Green foliage and brown bark are tree-specific, not required colors for every object. Do not add tree parts, apples, foliage, props, ground platforms, text, or scenery unless the subject calls for them.

## Workflow

1. Resolve the invocation's working directory before creating files. Outputs belong in `<working-directory>/assets/<asset-name>/`, with one folder per asset named in lowercase kebab-case (for example, `assets/maple-tree/`), never relative to the installed skill directory. Keep all views and prompts for that asset together in this folder. Honor an explicitly requested destination instead.
2. Inspect the bundled reference with the image-viewing tool before composing the prompt. If it is unavailable, disclose that limitation and use the style lock; do not claim a visual match was checked.
3. Identify the requested object and distinguishing features. Make ordinary design choices without a questionnaire. For a collection, keep the same camera, lighting, detail density, palette treatment, and composition rules for every member.
4. Compose four standalone prompts using the template below, one for each cardinal view. Keep the shared style wording consistent; change subject, silhouette, materials, colors, and necessary details. If the user only asks for prompts, save and deliver prompts without generating images. If they ask to make/generate assets, write the prompts and generate the images.
5. For image generation, follow the available `imagegen` skill and use the built-in image generation tool. Include the bundled tree as a **style reference only**, using the supported reference-image mechanism after viewing it. State explicitly that the new subject should replace the tree while matching its rendering style. Do not silently switch to a paid API/CLI fallback. If generation is unavailable, retain the prompts and explain the limitation.
6. Generate the front first to establish the object design. Then generate the back, left, and right sequentially, supplying the front and any useful completed views as identity references, in addition to the tree style reference when needed. Inspect local references before using them. Explicitly label each image's role. Preserve the same geometry, proportions, number and arrangement of parts, colors, and painted markings; rotate the viewpoint instead of redesigning the object. Newly revealed surfaces must be plausible continuations of that design. Left and right mean the object's own left and right, viewed directly from those sides; never mirror an image to substitute for the opposite view.
7. Inspect each result against the reference: silhouette softness, chunky proportions, matte finish, painted detail density, warm-to-cool shading, camera, lighting, background, and full-object framing. Also compare all four views for consistent silhouette structure, asymmetries, part placement, height, scale, and markings. Correct drift with a targeted edit, preserving successful features. Do not present incomplete sets as finished. Do not claim exact pixel-level consistency; reference guidance reduces variation but does not eliminate it.
8. Create `assets/<asset-name>/` as needed and copy each selected image there, retaining the original generated file. For example, save a maple tree's set in `assets/maple-tree/` and an oak tree's set in `assets/oak-tree/`. Use descriptive lowercase kebab-case asset names with view suffixes: `oak-tree-front.png`, `oak-tree-back.png`, `oak-tree-left.png`, and `oak-tree-right.png`. Save the exact generation/edit prompt alongside each image as `<same-stem>.prompt.md`, including the roles and paths of image references so the inputs are traceable. Keep one consistent version stem for the entire set: if any target file already exists, use `oak-tree-v2-front.png`, etc. in the same `assets/oak-tree/` folder unless replacement was explicitly requested. For prompt-only requests, save all four prompt files without generating images. Do not replace the four separate images with a contact sheet.
9. Return links to all four saved views and their prompts, and briefly state whether generation or prompt-only work was performed. Report any missing view if generation fails. Images are rendered references for workflows such as Tripo; do not imply they are exported meshes or guaranteed geometrically exact reconstructions.

## Prompt template

Replace bracketed fields; omit irrelevant subject details. Preserve the core style language.

```text
Use case: stylized-concept.
Create a clean stylized 3D game asset render of a single [subject and distinguishing features].
Use the supplied approved tree image as a STYLE REFERENCE ONLY: match its soft rounded modeling, chunky proportions, matte hand-painted surfaces, detail density, and studio lighting. Use the cardinal camera specified below instead of the reference camera. Render the requested subject, not a tree or a variation of the reference object.
Shape: [simple recognizable silhouette and major parts], built from a few chunky rounded volumes, smooth and puffy like clay or marshmallow, with gently beveled edges and no sharp facets.
Materials and colors: [subject-appropriate warm base colors and simplified materials]. Broad hand-painted color variation with lighter warm highlights on top and deeper cooler shading underneath; [a few appropriate painted marks]. Soft matte finish, simplified shapes, no realism or fine surface detail.
Identity references: [for back/left/right, identify the generated front and any other supplied views]. Show exactly the same object from the requested side, preserving its geometry, proportions, colors, and placement of details. Do not redesign or mirror it.
Composition: direct [front/back/left/right] view, orthographic eye-level camera, no camera tilt or three-quarter angle. Left/right are the object's own sides. Whole object centered in frame with comfortable margins, identical canvas size, camera scale, and ground baseline across all four views, isolated on a plain light grey background.
Lighting: soft even studio lighting, gentle ambient shading and a subtle contact shadow, matching the reference.
Avoid: faces unless requested, extra objects, scenery, ground platforms, text, logos, outlines, hard shadows, glossy surfaces, photorealism, sharp low-poly facets, fine leaves, fabric texture, and dense microdetail.
```

For transparent outputs, replace the background phrase and enable the tool's transparent-background setting. For explicitly requested views or special features, change only the relevant prompt clauses while preserving the style lock.
