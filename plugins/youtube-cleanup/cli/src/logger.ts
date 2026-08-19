const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

const useColor = process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;

const paint = (code: string, text: string): string => (useColor ? `${code}${text}${RESET}` : text);

let verbose = false;

export const setVerbose = (value: boolean): void => {
  verbose = value;
};

export const log = {
  info: (message: string): void => {
    console.log(message);
  },
  step: (message: string): void => {
    console.log(paint(CYAN, '→ ') + message);
  },
  ok: (message: string): void => {
    console.log(paint(GREEN, '✓ ') + message);
  },
  warn: (message: string): void => {
    console.warn(paint(YELLOW, '! ') + message);
  },
  error: (message: string): void => {
    console.error(paint(RED, '✗ ') + message);
  },
  detail: (message: string): void => {
    console.log(paint(DIM, `  ${message}`));
  },
  debug: (message: string): void => {
    if (verbose) console.log(paint(DIM, `  [debug] ${message}`));
  },
};
