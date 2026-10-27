/**
 * The scene layer: definitions, instances and transforms, between the kernel
 * (one topology per definition) and the commands. Pure TypeScript: no three.js,
 * no DOM.
 */
export * from './scene';
export * from './transform';
export * from './query';
export * from './guides';
export * from './annotations';
export { deserializeScene, sceneFromModel, serializeScene, type SerializedScene, type SerializedTransform } from './serialize';
