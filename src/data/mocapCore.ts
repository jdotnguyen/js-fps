// The shared clip library as a module of its own, so it can be loaded on demand as its own chunk (trim-startup-bundle D1).
// A static JSON import works in Vite (dev and build) and in Node; a dynamic `import('x.json', { with })` fails in Vite's
// dev server, and one without the attribute fails in Node.
import mocapCore from './mocap-core.json' with { type: 'json' };

export default mocapCore;
