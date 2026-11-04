/**
 * Export: the scene as files other programs read. Pure TypeScript over the
 * kernel and the scene; no DOM, so it runs headless (tests, MCP).
 */
export { exportStl, worldTriangles } from './stl';
export { exportGlb } from './glb';
