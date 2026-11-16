# Tripo Export (web)

A browser app for exporting [Tripo Studio](https://studio.tripo3d.ai) models in the format you want.
Paste a project link, see how the model was made (prompt, Tripo model version, settings, mesh and texture stats),
then download it as **GLB, glTF, OBJ (+MTL + textures), STL, 3MF or USDZ**, with optional texture downscaling.

## How it works

1. The page asks Tripo's project API (`api.tripo3d.ai/v2/studio/project/detail/v3/<id>`) for the project, the same call
   Studio makes when you open the project. That returns the generation recipe and a signed link to the GLB the viewer shows.
2. It downloads that GLB, which is compressed with `EXT_meshopt_compression` + `KHR_mesh_quantization` and has 4K PBR textures inside.
3. It decodes the GLB with [glTF-Transform](https://gltf-transform.dev) + meshoptimizer and writes the formats you picked.
   USDZ uses three.js's `USDZExporter`. All conversion runs in your browser.
4. Output goes into a folder you pick (Chrome/Edge, using the File System Access API), or into one `.zip` download.

Tripo doesn't send CORS headers for other sites, so the browser can't call its API directly. A tiny Netlify Edge Function
(`netlify/edge-functions/proxy.js`, served at `/api/proxy?url=`) relays GET requests, and only to `*.tripo3d.ai` and `*.tripo3d.com`.

Private models: paste your `authorization` header from Studio's network tab into the "Private model?" box. It passes through the site's Netlify proxy to Tripo's project API. The app does not persist it;
it remains in the input field until you clear it or close the page.

FBX and `.blend` need Blender, so they're only in the CLI: [freeAami/tripo-export](https://github.com/freeAami/tripo-export).

## Develop

```
npm install
npm run dev      # builds dist/ and serves it with the proxy on http://localhost:8888
```

Deploys on Netlify: build command `npm run build`, publish directory `dist` (set in `netlify.toml`).


## Validation and deployment

Use Node.js 24. Run `npm ci`, `npm test`, then `npm run build`.
The Netlify site must deploy both `dist` and the Edge Function from this repository.
Do not deploy only `dist` with a static drag-and-drop upload.
The proxy refuses redirects and only forwards a supplied token to the project-detail API.
If a Tripo download starts redirecting, inspect and explicitly validate its new destination before supporting it.

GitHub pushes can trigger automatic publication on connected Netlify sites. Confirm the
site, access settings and plan before pushing or deploying.
