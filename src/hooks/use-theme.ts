// Theme selection, persisted.
//
// The class lives on <html> and is read by the `dark` custom variant in
// index.css. Selection itself happens in an inline script in index.html so the
// correct theme is painted on the first frame — this hook only keeps it in
// sync after that, and writes the choice back so it survives a reload.

import { useCallback, useState } from "react";

type Theme = "light" | "dark";

const KEY = "lolo.theme";


/**
 * The current theme, plus a setter that applies it immediately.
 *
 * There is no listener for external changes: the toggle is the only thing
 * that writes this key, so watching for it would be a listener that can never
 * fire from anywhere but here.
 */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document === "undefined"
      ? "dark"
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // The theme still applied for this session; it just will not persist.
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
