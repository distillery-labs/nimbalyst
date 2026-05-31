import { COMMAND_PRIORITY_EDITOR, createCommand, defineExtension } from 'lexical';

/**
 * A no-op command exposed so that the markdown slash-picker entry has
 * something to dispatch. Selecting "Distill" in the slash menu logs a
 * message and inserts nothing.
 */
export const DISTILL_NOOP_COMMAND = createCommand<void>('DISTILL_NOOP');

/**
 * No-op Lexical extension. Its sole purpose is to register
 * `DISTILL_NOOP_COMMAND` so the runtime contribution above has a real
 * command to wire up.
 */
export const DistillLexicalExtension = defineExtension({
  name: 'com.nimbalyst.distill/lexical',
  register: (editor) =>
    editor.registerCommand(
      DISTILL_NOOP_COMMAND,
      () => {
        console.log('[Distill] DISTILL_NOOP_COMMAND dispatched');
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    ),
});
