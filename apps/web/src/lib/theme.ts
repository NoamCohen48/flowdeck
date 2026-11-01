import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "flowdeck.theme";

/** Dark theme: explicit choice stamps data-theme; "system" stamps nothing. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);
  return [theme, setTheme];
}
