import { createContext } from 'react';

/** Opens a working-tree file in the repository workspace's editor. */
export const EditorNavigation = createContext<((repo: string, file: string) => void) | null>(null);
