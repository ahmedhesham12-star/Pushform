import { z } from 'zod';
import { t } from '../../i18n';
import type { CommandDef } from '../types';
import { WORKSPACES } from '../workspaces';

export const setWorkspaceInput = z.strictObject({ workspace: z.enum(WORKSPACES) });
export type SetWorkspaceInput = z.infer<typeof setWorkspaceInput>;

/** Say what the file is for. Only what is offered changes: units, materials and settings stay as they are. */
export const setWorkspace: CommandDef<SetWorkspaceInput, Record<string, never>> = {
  id: 'core.setWorkspace',
  title: () => t('command.setWorkspace'),
  input: setWorkspaceInput,
  run(doc, input) {
    if (input.workspace === doc.workspace) return { ok: true, doc, output: {} };
    return { ok: true, doc: { ...doc, workspace: input.workspace }, output: {} };
  },
};
