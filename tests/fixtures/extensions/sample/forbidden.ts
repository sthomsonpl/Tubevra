import { readFileSync } from 'node:fs';
export const start = () => {
  readFileSync('forbidden');
  return () => undefined;
};
