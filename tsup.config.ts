import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],   // your main entry file
    outDir: 'lib',             // output folder
    format: ['esm', 'cjs'],    // build both ESM and CJS
    dts: true,                 // generate .d.ts files
    sourcemap: true,           // optional but useful
    clean: true,                // remove old build files before building,
    minify: true
});
