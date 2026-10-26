# Morrow artwork

## Original generated crew

- Production asset: `app/assets/orbit-crew.webp` (1024×1024, 100,526 bytes), used as a 4×4 CSS
  sprite atlas. Each avatar has fixed dimensions, avoiding layout shift. There are 16 original
  fictional characters, 14 used for the crew and others for the workspace and growth graphics.
- Built-in `image_gen` generation was used, not the API/CLI fallback.
- Original output retained at `/Users/apple/.codex/generated_images/01a16352-8bbc-7342-b7e3-a0c7e0ac8546/exec-26d49c3a-1600-4b75-970b-b13b7a6d3c11.png`.
- Converted to WebP with `cwebp -q 82 -resize 1024 1024`; the project needs only the local WebP.
- The workspace character is a fictional avatar, not a photograph of the account owner.

Final prompt:

> Use case: stylized-concept. Asset type: one production avatar atlas image for a premium dark
> career dashboard called Orbit. Create a precise 4 by 4 grid of sixteen separate high-end 3D
> vinyl character head avatars. Every tile is exactly the same size, on an identical solid very
> dark charcoal background #1b1d24. No visible grid lines. Each character is centered, fully
> contained in its tile, with 18% clear padding around the entire head and shoulders. All sixteen
> heads use the same soft studio light, real ambient occlusion, beautifully modeled forms,
> polished ceramic and satin vinyl material, memorable and friendly but sophisticated for Gen Z.
> Their faces have expressive black capsule eyes, small smiles, no uncanny realistic humans.
> Distinct character types in reading order: lavender capsule robot with headphones; mint rounded
> square explorer bot with a small antenna; peach round pilot bot with a glass visor; periwinkle
> astronaut bot with a metallic ring around the head; warm ivory robot with black faceplate; sage
> companion bot with two rounded ears; dusty rose rounded AI character; blue gray bookish bot with
> round glasses; charcoal professional bot with lilac side panels; purple creative bot with
> asymmetrical antenna; ivory helpful robot with peach cheeks; mint study bot with a tiny visor;
> lavender star-shaped soft sculpture character with two eyes; peach round investigator bot with
> large glasses; silver chrome pearl robot with gentle lavender reflections; rich violet pill
> shaped mascot with a single ring around its head. Every character is an original identity, no
> copyrighted characters, no brand logos, NO TEXT, NO LETTERS, NO WATERMARK. These should be finished
> polished 3D avatar assets, not flat vector icons, not a UI mockup. Square overall image, uniform
> 4x4 layout, 16 cleanly separated tiles, dark background that blends into #1b1d24 UI. Aim for
> exceptional shape design and tactile lighting.

## Code-native graphics and typography

`app/js/components/identity.js` contains the original Orbit mark and filled/duotone navigation
set. Familiar small action symbols use the existing code-native utility set. Source Sans3 is
locally hosted; its license is included under `app/fonts/`.

## Visual reference

[iBanko Finance Dashboard UI Concept, Anik Deb](https://dribbble.com/shots/19411888-iBanko-Finance-Dashboard-UI-Concept)
was used for composition and hierarchy. The tablet image is retained only in ignored QA artifacts.
Its logo, financial figures, portraits and card imagery are not shipped in Orbit.

## Orbit world extension — October 23, 2026

- Mode: built-in imagegen; existing `orbit-crew.webp` supplied as a style reference, viewed before generation.
- Saved original: `/Users/apple/.codex/generated_images/01a16352-8bbc-7342-b7e3-a0c7e0ac8546/exec-e9488db6-a1f0-461d-9936-f95e465fdf78.png` (1254×1254).
- Production: `app/assets/orbit-world.webp` (1024×1024, 108,128 bytes). Converted with cwebp quality 85. Original retained.
- Eight new portraits (indices16–23) and eight section emblems (24–31). Total selectable workspace portraits: 24. The atlas is centrally cropped within each CSS tile to avoid neighboring-row bleed; no screenshot is used as UI.
- New portraits identify Hirist/Instahyre/Cutshort/Wellfound profile agents and extend the workspace picker. Emblems identify Orbit, Research Studio, Data hub, Action inbox, Flows, Reports, Learning path and Preferences.
- No platform logos or implied platform affiliation. Existing vector utility icons remain for common actions.

Final prompt:

> Use case: stylized-concept. Asset type: a production 4 by 4 sprite atlas for Orbit, a dark career dashboard. Input image is a STYLE REFERENCE only, preserve its premium glossy vinyl 3D material, rounded cute bot faces, studio rim light, tasteful lavender/mint/peach/slate palette. Generate a NEW atlas of sixteen distinct graphics on a uniform charcoal #191b22 backdrop, exactly four equal columns and four equal rows, no gaps, no borders, no text. Each figure is centered WITHIN its 256px square cell of a 1024px square image, safely contained with 18px margin, even scale, no objects crossing cell boundaries. Row 1: four NEW friendly head-and-shoulder robot avatars for profile update specialists: mint bot with clear round visor and tiny leaf antenna; peach bot with headphones and square glasses; lavender bot with sleek swept helmet and small star antenna; slate blue bot with silver glasses and circular ear pads. Row 2: four NEW user avatar mascots: cream bot with small lavender bowtie; lilac cat-eared robot; pearl silver floating orb bot; sage green explorer bot. Row 3: four matching beautiful dimensional standalone app emblems without faces: purple ringed planet (Orbit brand); mint magnifying glass over purple open book (Research Studio); three stacked translucent lavender data cylinders with mint accents (Data hub); peach mail tray with one cream card (Action inbox). Row 4: four matching dimensional emblems: lilac and mint connected flow nodes (Flows); cream report sheet with purple tiny bar graph (Reports); mint graduation cap on lavender book (Learning path); lavender polished cog with pearl center (Preferences). Camera orthographic-ish front three-quarter, highly polished soft studio lighting, gentle cast shadows confined to cells, no bright background, no labels, no brand logos, no watermark. Keep professional collectible designer-toy quality matching reference. Prioritize clean legibility at 48px. This is an asset atlas, not a dashboard screenshot.

### Delivery variants

Both generated originals are also encoded at the same 1024×1024 dimensions as AVIF with FFmpeg/SVT-AV1 (CRF34). CSS `image-set` selects AVIF on supporting browsers and retains WebP fallback. `app/assets/orbit-crew.avif` is 61,463 bytes; `app/assets/orbit-world.avif` is 58,376 bytes. Combined image transfer drops from 208,654 to 119,839 bytes without removing graphics or changing layout/materials. Browser screenshots verify the rendered variants.

## Morrow crew extension and identity — October 23, 2026

- Mode: built-in imagegen, using the approved original crew atlas as a viewed style reference.
- Generated original: `/Users/apple/.codex/generated_images/01a16352-8bbc-7342-b7e3-a0c7e0ac8546/exec-0f63b1ce-07ef-405c-a167-58e9186014fd.png`.
- Production: `app/assets/morrow-crew.webp` and `app/assets/morrow-crew.avif`, 1024×1024; WebP quality84 and AV1 CRF34. CSS selects a supported format and centrally crops each tile to avoid neighboring-cell bleed.
- Portrait indices32–39: lavender bunny, mint mushroom, peach pilot, pearl professor, slate bear, violet beanie, mint stargazer, cream earmuffs. Combined with existing atlases: **32 selectable portraits**.
- Symbol indices40–47: folded M sculpture, calendar, filter, PDF document, folder, chart, shield/check, magnifier/document.
- Primary brand mark: original code-native `app/assets/morrow-mark.svg`; raster M sculpture is supporting artwork. No platform affiliation implied; no trademark clearance claimed for the working name.
- Local display type: Space Grotesk variable, from Google Fonts, with OFL license at `app/fonts/space-grotesk-OFL.txt`. Body remains Source Sans3.

Generation brief (recorded summary):

> Create a precise four-by-four atlas on uniform charcoal #191b22. Use the original crew as a style reference for premium glossy vinyl/ceramic, soft studio rim lighting, friendly rounded robot faces and restrained lavender, mint, peach, cream and slate colors. The first eight cells contain the distinct robot portraits listed above; the final eight contain the dimensional utility symbols listed above. Center each object in an equal cell with safe margins, no overlaps, no text, no labels and no watermark. Preserve polished collectible-toy detail and legibility at small dashboard sizes. This is a production asset atlas, not a dashboard screenshot.

## Morrow friends — October 26, 2026

- Mode: built-in imagegen. The original `orbit-crew.webp` was visually inspected for material, framing, and expression; this is a new atlas, not a replacement.
- Generated original: `/Users/apple/.codex/generated_images/01a17834-1d1e-7280-905d-44a8e971aea5/exec-8fc81ca0-4142-45b6-a7a9-ddb1cc0d4016.png` (1254×1254). Original retained.
- Production: `app/assets/morrow-friends.avif` (156,276 bytes, quality70) and `app/assets/morrow-friends.webp` (236,000 bytes, quality88). Format conversion with Pillow preserves all pixels and full atlas dimensions; CSS `image-set` selects one format. A 430% CSS background size and optical row centers prevent neighboring portrait bleed; inspected in Chromium at 152px, recorded at `artifacts/refinement/friends-atlas-crops.png`.
- Portrait indices48–63: Peach fox, Mint aviator, Buttercream reader, Pearl botanist, Blue penguin, Teal explorer, Coral headphones, Pearl owl, Mint frog, Cream navigator, Peach artist, Blue cloud, Sage turtle, Copper listener, Blue bunny, Mint astronaut. Existing indices remain unchanged. **48 selectable portraits** in total.
- Picker includes an All characters / New friends filter, named selection preview, and a bounded scroll area so save controls remain reachable on laptops and phones.

Final prompt:

> Use case: stylized-concept. Asset type: one square 4-by-4 CSS avatar sprite atlas for the Morrow career workspace. Create exactly sixteen DIFFERENT charming premium glossy vinyl robot portrait busts, arranged as a perfectly regular 4-column 4-row grid with sixteen equal square cells, no gutters, same generous headroom and same bust scale in every cell. Each portrait must be isolated and completely contained in its own quarter-width/quarter-height cell, centered at x/y 12.5%,37.5%,62.5%,87.5%. Smooth studio 3D rendering, shiny porcelain/vinyl shells, gentle chrome joints, black oval eyes with catchlights, tiny friendly smiles, soft upper-left lighting, polished collectible-toy quality. Solid flat midnight blue backdrop #101a23 across entire image, no visible grid lines, no cell borders, no text, no labels, no props crossing cells. Predominantly pastel mint, warm peach, icy blue, buttercream, small copper details. Characters row order: 1 peach fox-eared robot with cream faceplate; 2 mint pilot with ivory flight goggles; 3 buttercream reader with thin round amber glasses; 4 pearl botanist with tiny mint leaf antenna; 5 icy-blue penguin robot with pearl belly; 6 teal explorer in soft peach knit beanie; 7 warm-coral robot with rounded headphones; 8 pearl owl-shaped robot with small blue brows; 9 mint frog-eared robot with round cheeks; 10 buttercream navigator with blue visor; 11 peach artist with teal beret; 12 blue cloud-headed robot with small ivory bowtie; 13 sage turtle-inspired rounded helmet robot; 14 copper robot with pearl earmuffs; 15 icy-blue bunny-eared robot; 16 mint astronaut with pearl collar and peach cheeks. Use only portrait busts, heads and short shoulders; no arms, hands or full bodies. Cohesive materials, identical soft lighting and framing, distinctive silhouettes legible at 64px. Square image, highest practical resolution. Avoid realistic people, flat vector art, illustrated outlines, excessive props, text and watermarks.

## Daylight transparent editions — October 26, 2026

The user's correction requests light orange/beige throughout, including removal of the dark baked backgrounds around avatars. All four atlases were inspected, then edited separately with built-in imagegen using `transparent_background: true`. Original files remain intact. The resulting 1254×1254 RGBA atlases preserve the character identities, order, and four-by-four composition. Generated edits can vary small material/edge details; these are not claimed as pixel-identical copies.

Production files use AVIF quality75 and WebP quality90, encoded with Pillow without further artwork edits. Both formats preserve true alpha (verified minimum0 / maximum255); CSS `image-set` loads the supported format. Every portrait and symbol was inspected against cream in Chromium, with the crop sheet at `artifacts/refinement/daylight-atlas-crops.png`. Utility-symbol crops use small CSS framing adjustments so full symbol edges remain visible. Saved avatar indices stay unchanged.

| Atlas | AVIF bytes | WebP bytes | Fully transparent pixels |
| --- | ---: | ---: | ---: |
| `app/assets/orbit-crew-light` | 252,216 | 410,180 | 40.7% |
| `app/assets/orbit-world-light` | 235,369 | 394,614 | 42.2% |
| `app/assets/morrow-crew-light` | 214,481 | 355,490 | 43.6% |
| `app/assets/morrow-friends-light` | 303,054 | 485,734 | 33.2% |

Generated source PNGs (retained under `/Users/apple/.codex/generated_images/01a17834-1d1e-7280-905d-44a8e971aea5/`):

- Orbit crew: `exec-a2870a41-e549-448c-8289-fb5fc6ba1bb3.png`
- Orbit world: `exec-673df485-9b1a-4770-aff2-edc84519d5e9.png`
- Morrow crew: `exec-8f10f65e-141d-4480-8f93-3b99908b2048.png`
- Morrow friends: `exec-2c2cbe61-3b78-41f7-8131-b7acd19266e6.png`

Final prompt (same for all four edits, each with its corresponding original WebP as the edit target):

> Use case: background-extraction. This supplied image is the EDIT TARGET: a production 4-by-4 sprite atlas used by CSS. Perform BACKGROUND REMOVAL ONLY. Replace every exposed charcoal / dark navy background pixel outside the sixteen existing characters or symbols with genuine alpha transparency. Preserve ALL sixteen original objects exactly: their identity, shape, faces, clothing, accessories, small details, original colors, material highlights, shadows on the objects, exact size, exact X/Y placement, same row and column order, same aspect ratio and four-by-four composition. DO NOT repaint, regenerate, rearrange, resize, recenter, crop, add margin, add characters, remove characters, recolor, alter expressions or change lighting. The original dark robot faceplate, dark eyes, dark clothing, metal shadows and other legitimate dark parts of the subjects MUST remain opaque. Remove the background between bodies, around protruding ears and antennas, and through open orbital-ring holes while preserving the rings and glass surfaces. Keep antialiased edges clean for display over warm cream #fffdf9. Output the exact full atlas on a real transparent background, not white, beige, black, or a painted checkerboard. No text, labels, new shadows or borders.


## Studio typography — October 26, 2026

The active dashboard uses self-hosted **Inter** for interface text and **Manrope** for headings. Variable Latin and Latin Extended WOFF2 subsets are stored in `app/fonts/inter-{latin,latin-ext}.woff2` and `app/fonts/manrope-{latin,latin-ext}.woff2`; production preloads only the two Latin subsets. Fonts come from the official Google Fonts CSS endpoint for Inter 400–700 and Manrope 400–800. Their SIL Open Font License files are bundled as `app/fonts/inter-OFL.txt` and `app/fonts/manrope-OFL.txt`. No runtime font service is required. JetBrains Mono remains for code. Earlier font assets remain available for existing source references.


## Warm material editions — October 26, 2026

The active interface now uses four warm transparent atlas editions, replacing the cool lavender/mint/blue materials with ivory, cream, sand, peach, terracotta and caramel. These are built-in imagegen material edits of the existing `*-light.webp` files, followed only by format conversion (AVIF quality75/speed6; WebP quality90/method6). No CSS hue filter is used. Original images and prior editions remain intact. Character indices, identities and the 4×4 sprite structure remain stable; generated edges/material details can vary slightly. All production images are 1254×1254 RGBA with true alpha0–255.

Palette: porcelain `#FFFDF9`, ivory `#FFF3DD`, sand `#D8BFA1`, peach `#F0AA75`, terracotta `#B9572D`, caramel `#9B6747`, cocoa details `#4C3426`. Surface variation keeps the characters distinct within the interface palette. Avatar-picker labels now describe character features rather than obsolete cool colors; stored numeric selections are unchanged.

| Production family (both formats in app/assets) | AVIF bytes | WebP bytes |
| --- | ---: | ---: |
| `orbit-crew-warm` | 283,264 | 429,058 |
| `orbit-world-warm` | 242,152 | 449,568 |
| `morrow-crew-warm` | 240,611 | 403,790 |
| `morrow-friends-warm` | 345,614 | 552,690 |

Detailed generation and transparency metadata is retained under `artifacts/warm-assets/`. Actual CSS crops and desktop/phone captures are in `artifacts/warm-artwork/`.

### orbit-crew: final built-in edit prompt

Retained generated source: `/Users/apple/.codex/generated_images/01a1782f-19ec-7783-91d4-541d6416ea7e/exec-6dfaafad-26be-42e5-afe6-92ee9ddbf4df.png`.

> Use case: precise-object-edit. Asset type: existing production 4-by-4 transparent character sprite atlas. Input image is the EDIT TARGET, not a loose reference. Recolor ONLY the surface materials of all sixteen existing robots to harmonize with a light orange and beige dashboard. Use exclusively warm ivory #FFF3DD, porcelain #FFFDF9, sand #D8BFA1, peach #F0AA75, burnt-orange/terracotta #B9572D, and caramel #9B6747; small eyes and mechanical details may remain deep cocoa #4C3426 or near black. Replace every purple, lilac, blue, mint, green, cool silver tint and colored reflection with these warm materials. Keep cream dominant with carefully varied peach, terracotta and sand accents across the sixteen characters so each remains distinct. In particular make the star character glossy peach/ivory and the ringed planet character cream with terracotta ring; lighten dark shell panels to sand or cream. Preserve glossy polished 3D highlights, soft studio volume, bright warm lighting, black eyes and friendly expressions. This must not look like a flat sepia or monochrome filter. Preserve ALL sixteen subjects, faces, identities, accessories, silhouettes, exact object size and x/y placement, same four equal columns and rows, framing and spacing; no moving, recentering, resizing, cropping, adding or deleting anything. Preserve true alpha transparency everywhere outside the subjects, with clean antialiased cutout edges and no stray color fringe. Keep open spaces between shapes transparent. No white or beige background, no baked shadow behind objects, no text, borders, logos, watermarks or extra objects. The exact layout must stay compatible with existing CSS sprite crops.

### orbit-world: final built-in edit prompt

Retained generated source: `/Users/apple/.codex/generated_images/01a17834-1d1e-7280-905d-44a8e971aea5/exec-af901827-74f4-4a1d-a380-c64d49d849ff.png`.

> Use case: precise-object-edit. EDIT TARGET: this supplied transparent 1254×1254 four-by-four production CSS sprite atlas. Perform a MATERIAL COLOR EDIT ONLY. Preserve all sixteen existing subjects, their identities, expressions, exact silhouettes, shape geometry, proportions, exact X/Y positions, cell sizes, row/column order, camera angles, object scale and all alpha transparency. Do not move, resize, recenter, crop, redraw, replace or add any object. Preserve the exact square 4×4 layout for existing CSS crop compatibility. Recolor every purple, lilac, lavender, blue, icy-blue, mint, sage and green surface AND their colored reflections into this warm palette: warm ivory #FFF3DD, porcelain #FFFDF9, sand #D8BFA1, peach #F0AA75, burnt-orange/terracotta #B9572D, caramel #9B6747. Small eyes and deep detail can use cocoa #4C3426. Retain convincing glossy vinyl/porcelain/glass 3D material, warm highlights and depth, with varied cream-versus-peach-versus-terracotta material distribution across characters and symbols. Use ivory/cream for main face surfaces with peach/terracotta accents, and caramel metal detail. Keep the black-faced robot’s visor a dark cocoa faceplate. The ringed sphere, book/magnifier, database stack, tray, flow diagram, chart document, graduation cap/books and gear retain their exact original shapes but use coordinated warm ivory, peach, terracotta and caramel materials. No remaining purple, pink-purple, blue, cyan, mint or green glow/reflection. This must NOT be a flat sepia wash, grayscale tint, monochrome filter or uniformly orange image. Preserve all original artwork details and transparent cutout edges. Background remains real alpha transparency everywhere outside the original objects, including gaps and ring holes; no colored background, no painted checkerboard. Do not add shadows, text, labels, borders, new props, changed lighting directions, layout changes or margins.

### morrow-crew: final built-in edit prompt

Retained generated source: `/Users/apple/.codex/generated_images/01a17832-db0a-7021-b8d7-ee31cbba714d/exec-1c116e01-5a9f-4972-93f8-6c790d716693.png`.

> Use case: precise-object-edit.
> Asset type: transparent 4×4 CSS sprite atlas for the Morrow website.
> Input image: the supplied morrow-crew-light.webp is the EDIT TARGET, not a loose style reference.
>
> Change ONLY the colors/material colors of this existing image. Preserve every one of the 16 subjects exactly: the eight character portraits in the first two rows and the eight emblems in the last two rows. Keep their identities, faces, poses, silhouettes, relative sizes, exact 4×4 cell positions, edge margins, camera angle, framing, and existing object geometry unchanged. Retain the square 1254×1254 canvas and exact atlas layout for CSS background-position cropping.
>
> Replace ALL purple, violet, lavender, lilac, blue, mint, green, cyan, and cool-color reflections with warm materials. Use only these material colors: ivory #FFF3DD, porcelain #FFFDF9, sand #D8BFA1, peach #F0AA75, terracotta #B9572D, caramel #9B6747. Eyes and tiny dark details should be cocoa #4C3426. Reflections, shading, highlights, visor tints, metal rings, and translucent parts must also be warm, never purple/blue/green. Give different subjects a balanced variety of cream, peach, sand and terracotta materials; this is NOT an overall sepia filter or monochrome wash.
>
> Keep the existing polished dimensional 3D volume, glossy ceramic/vinyl materials, bright soft studio lighting and clean friendly expressions. Suggested warm distribution within the unchanged subjects: peach bunny; ivory/sand mushroom; peach/terracotta pilot; porcelain/caramel professor; sand bear; terracotta/ivory beanie character; ivory/peach star antenna character; porcelain/peach earmuff character. Emblems retain the same shapes: terracotta folded M, sand-and-ivory calendar, peach translucent funnel, porcelain document with terracotta seal, peach/caramel folders, terracotta dimensional bars, sand/peach shield with ivory check, ivory document with caramel/peach magnifier.
>
> Background MUST be genuinely transparent with a real alpha channel. Preserve clean antialiased object cutouts, no opaque backdrop, no checkerboard painted into the image. Do not add any objects, labels, text, border, ground plane, cast shadow, scene, or decoration. Do not move, rotate, resize, redesign, crop, merge, or rearrange any subject. The only intended change is the warm recoloring.

### morrow-friends: final built-in edit prompt

Retained generated source: `/Users/apple/.codex/generated_images/01a17832-f96a-72d0-840a-29519b1b1257/exec-6fe4b80d-a5aa-4e1e-9035-b994e5b8fdb8.png`.

> Use case: precise-object-edit.
> Asset type: existing 4 by 4 transparent atlas of 16 polished 3D robot animal friends used by CSS sprite crops.
> Input image 1 is the EDIT TARGET, not a style reference. Perform a material-color edit only.
> Keep all 16 exact subjects in their exact original four rows and four columns, in the exact same order, same centers, bounding boxes, scale, spacing, poses, facial features, silhouettes, ears, accessories, proportions, edge shapes, camera angles and canvas framing. Preserve original 1254 by 1254 canvas geometry and alpha-cutout compatibility. Preserve every identity: fox, aviator, glasses, sprout; penguin, knit cap, headphones, owl; frog, visor, beret, cloud; turtle, copper robot, rabbit, astronaut.
> Replace every cool-colored surface and reflection (purple, lilac, blue, cyan, mint and green) with varied WARM materials drawn exclusively from ivory #FFF3DD, porcelain #FFFDF9, sand #D8BFA1, peach #F0AA75, terracotta #B9572D and caramel #9B6747. Small eyes, mouths and fine dark details use cocoa #4C3426. Keep faces predominantly ivory or porcelain. Vary the larger shells/accessories among cream, peach, terracotta and caramel across the 16 subjects; each subject should still feel distinct. Warm reflections and warm highlights only; no cool tints left anywhere, including visors, ear cups, glass, leaves and reflections.
> Retain polished dimensional ceramic, translucent warm-tinted glass and warm metal materials, detailed textures, bright soft studio lighting, smooth 3D volume and crisp edge detail. Maintain highlights and natural tonal variation within the warm palette. Do not apply a flat sepia filter or a monochrome brown wash.
> Background must remain truly transparent with clean alpha edges. No opaque backdrop, checkerboard pattern, added objects, text, labels, borders, cast shadows, grid lines, tiles or halos. Do not change the atlas layout or geometry, add/remove subjects, crop, enlarge, shrink or reposition anything. Only recolor the existing materials.

## Morrow sunrise identity — October 26, 2026

- `app/assets/morrow-mark.svg`: original code-native vector, drawn for this project. An open double arch and sunrise dot use terracotta/peach gradients with a restrained highlight. It replaces the earlier folded mark and is shared by the sidebar, account pages, missing pages, favicon and loading states. No raster generation or third-party logo is used.
- `app/fonts/morrow-wordmark.woff2`: 2,628-byte Google Fonts Fraunces subset containing only the letters in “morrow”; weight 700, optical size 32, softness 50, wonk 1. Served locally, exclusively for the brand wordmark. Source family: https://fonts.google.com/specimen/Fraunces . Its SIL Open Font License is retained in `app/fonts/fraunces-OFL.txt`.
- Brand and loader styling: `app/styles/brand.css` and `app/styles/feedback.css`. Existing warm avatar atlases and saved avatar selections remain unchanged by this refresh.

## Morrow mascot identity — October 26, 2026

The user explicitly chose a warm 3D mascot matching the avatars. This replaces the sunrise monogram as the active brand image. Generated with built-in `image_gen.imagegen`, one call, genuine transparency, no reference image passed to the generation. The warm avatar atlas was inspected for palette and material context.

- `app/assets/morrow-mascot.png`: retained original 1254×1254 RGBA source, 1,270,504 bytes.
- `app/assets/morrow-mascot.webp`: active 256×256 lossless WebP, 43,724 bytes; standard LANCZOS resizing only, original transparency preserved.
- `app/assets/morrow-favicon.png`: 64×64 RGBA favicon, 6,994 bytes.
- The mascot appears in navigation branding, account pages, missing pages and loading states. The lowercase wordmark now uses the existing locally hosted Manrope 800. Historical SVG and Fraunces assets are retained but no longer referenced by the brand.
- Metadata, exact source path, alpha checks and size previews: `artifacts/mascot-brand/generation.json`. Transparent corners and alpha range 0–255 verified; decoded WebP/favicon alpha exactly matches the resized source.

Final generation prompt:

> Use case: stylized-concept. Asset type: original compact 3D mascot logo for the Morrow dashboard, rendered as one square transparent asset, designed to remain recognizable at 32–48 pixels. Create ONE friendly sunrise-robot HEAD ONLY. A large, clear warm-ivory porcelain face is inset into a soft peach sun-shaped head shell: five broad, softly rounded sunrise rays rise directly from the upper outline, with gently rounded sides and base. Keep this one integrated head silhouette, not a face placed over a separate sun, halo, badge or medallion. Two clear cocoa oval eyes and a tiny restrained curved smile, gently cheerful and confident. Very small terracotta/caramel seams at the sides can suggest a robot; no complicated mechanical detail. Bright polished ceramic/vinyl 3D material, softly beveled substantial forms, subtle warm studio highlights and pleasant depth, matching collectible glossy warm robot avatars. Palette: ivory #FFF3DD and porcelain #FFFDF9 dominate the face; peach #F0AA75 and sand #D8BFA1 for the shell; sparing terracotta #B9572D and caramel #9B6747 accents; eyes and smile cocoa #4C3426. Frontal, symmetric, compact and centered; artwork occupies about 88% of the square with clean generous edge clearance, fully visible with no cropping. Soft professional warmth rather than exaggerated cartoon excitement. Background must be genuine alpha transparency, including all exterior gaps. No torso, neck, shoulders, arms, feet, props, platform, backplate, badge, letters, letter M, wordmark, numbers, text, watermark, additional characters, contact sheet, borders, floor, background color, cast shadow, detached decorative pieces, blue, purple, green, mint, dark helmet, or dark faceplate. Deliver one beautifully finished production mascot, not a mockup.
