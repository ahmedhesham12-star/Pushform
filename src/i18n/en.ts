/**
 * English catalog. This is the source of truth for message keys: other locales
 * must provide the same keys (missing ones fall back to English).
 * Placeholders use {name} and are filled by t().
 */
export const en = {
  'app.name': 'Pushform',
  'app.tagline': 'Push/pull modeling in the browser',
  'app.title': 'Pushform',

  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.zoomFit': 'Zoom to fit',
  'action.clear': 'Clear model',
  'action.withShortcut': '{name} ({key})',

  'key.undo': 'Ctrl+Z',
  'key.redo': 'Ctrl+Shift+Z',
  'key.zoomFit': 'Shift+Z',
  'key.space': 'Space',
  'key.spaceSymbol': '␣',

  'toolbar.label': 'Tools',
  'tool.select': 'Select',
  'tool.rectangle': 'Rectangle',
  'tool.pushPull': 'Push/Pull',
  'tool.erase': 'Erase',
  'tool.orbit': 'Orbit',
  'tool.pan': 'Pan',

  'intro.start': 'Press R and click two corners on the ground to draw a rectangle. Then press P, click the rectangle and move up to make it solid.',
  'intro.navigate': 'Right-drag to orbit, Shift + right-drag to pan, scroll to zoom. Type a size while drawing for exact dimensions, in any unit: 600mm, 2\' 6", 1.5m.',

  'status.select.idle': 'Click a face to select it.',
  'status.select.selected': 'Face selected. Press Delete to erase it, Esc to clear the selection.',
  'status.rectangle.first': 'Click the first corner on the ground or on a face.',
  'status.rectangle.second': 'Click the opposite corner, or type width, depth and press Enter.',
  'status.pushPull.idle': 'Click a face to push or pull it.',
  'status.pushPull.active': 'Move to set the distance and click to finish, or type a distance and press Enter.',
  'status.erase': 'Click a face to erase it.',
  'status.orbit': 'Drag to orbit. Right-drag orbits with any tool.',
  'status.pan': 'Drag to pan. Shift + right-drag pans with any tool.',

  'measure.dimensions': 'Dimensions',
  'measure.distance': 'Distance',
  'measure.area': 'Area',
  'measure.inputLabel': 'Measurements',
  'measure.listSeparator': ', ',
  'measure.count': '{count}s',

  'message.rectangleAdded': 'Rectangle {width} × {depth} added. Press P to push or pull it.',
  'message.pushed': 'Pushed/pulled {distance}.',
  'message.erased': 'Face erased. Undo brings it back.',
  'message.cleared': 'Model cleared. Undo brings it back.',
  'message.amended': '{command} changed to {values}.',

  'error.tooSmall': 'The rectangle needs a width and a depth.',
  'error.outsideFace': 'Draw the rectangle fully inside the face. Splitting a face along its edge isn’t built yet.',
  'error.overlapsHole': 'The rectangle overlaps another rectangle on this face.',
  'error.notOnPlane': 'The rectangle has to lie on the face it starts on.',
  'error.noSuchFace': 'That face no longer exists.',
  'error.generic': 'That did not work ({code}).',
  'error.typeTwoSizes': 'Type two positive sizes separated by a comma, like 600mm, 400mm.',
  'error.typeOneDistance': 'Type one distance, like 600mm or 2\' 6".',
  'error.typeValues': 'Type {count} values separated by commas.',
  'error.nothingToSize': 'Start a rectangle or a push/pull, then type a size.',

  'command.drawRectangle': 'Draw rectangle',
  'command.pushPull': 'Push/pull',
  'command.erase': 'Erase',
  'command.clearModel': 'Clear model',
  'command.setDisplayUnits': 'Change units',

  'snap.endpoint': 'Endpoint',
  'snap.midpoint': 'Midpoint',
  'snap.onFace': 'On face',
  'snap.onPlane': 'On plane',

  'units.label': 'Units',
  'units.precisionLabel': 'Precision',
  'units.name.mm': 'Millimeters',
  'units.name.cm': 'Centimeters',
  'units.name.m': 'Meters',
  'units.name.in': 'Inches, decimal',
  'units.name.in-frac': 'Inches, fractional',
  'units.name.ft-in': 'Feet and inches',

  'units.symbol.mm': 'mm',
  'units.symbol.cm': 'cm',
  'units.symbol.m': 'm',
  'units.symbol.ft': "'",
  'units.symbol.in': '"',
  'units.symbol.mm2': 'mm²',
  'units.symbol.cm2': 'cm²',
  'units.symbol.m2': 'm²',
  'units.symbol.in2': 'in²',
  'units.symbol.ft2': 'ft²',
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = { readonly [K in MessageKey]: string };
