# generator

The interface only — markup, wiring, the canvas renderer, the archive panel.
The actual drawing code lives in [`src/engine/`](../src/engine/) and is
imported here as an ES module, so the browser and the command line
(`npm run render`) share the exact same functions.

ES modules do not load over `file://`. Opening this file directly will look
broken (blank canvas, no controls responding). Run it from the repository
root instead:

```
npm i
npm run dev
```

and open the URL it prints (`http://localhost:3000/generator/`).
