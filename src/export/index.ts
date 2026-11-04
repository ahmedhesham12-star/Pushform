/**
 * Export: the scene as files other programs read. Pure TypeScript over the
 * kernel and the scene (and the MIT openskp writer for SKP); no DOM, so it
 * runs headless (tests, MCP).
 */
export { exportStl, worldTriangles } from './stl';
export { exportGlb } from './glb';
export { exportSkp } from './skp';
