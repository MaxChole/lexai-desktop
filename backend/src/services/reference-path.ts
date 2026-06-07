import fs from 'fs';
import path from 'path';

export function resolveReferencesDir(configuredPath?: string): string {
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  const candidates = [
    path.resolve(process.cwd(), 'references'),
    path.resolve(process.cwd(), '../references'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
