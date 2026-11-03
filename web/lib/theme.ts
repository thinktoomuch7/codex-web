export const THEME_OPTIONS = [
  { id: "auto", scheme: null },
  { id: "light", scheme: "light" },
  { id: "mist", scheme: "light" },
  { id: "lilac", scheme: "light" },
  { id: "sand", scheme: "light" },
  { id: "rose", scheme: "light" },
  { id: "dark", scheme: "dark" },
  { id: "pine", scheme: "dark" },
  { id: "dusk", scheme: "dark" },
  { id: "ember", scheme: "dark" },
  { id: "slate", scheme: "dark" },
  { id: "contrast-light", scheme: "light" },
  { id: "contrast-dark", scheme: "dark" },
  { id: "zenburn", scheme: "dark" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) =>
  option.scheme === "dark" ? [option.id] : [],
);

export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",${JSON.stringify(DARK_THEMES)}.includes(t))})();`;

export const THEME_LABEL: Record<ThemePreference, string> = {
  auto: "跟随系统",
  light: "浅色",
  mist: "薄雾",
  lilac: "丁香",
  sand: "沙色",
  rose: "玫瑰",
  dark: "深色",
  pine: "松绿",
  dusk: "黄昏",
  ember: "余烬",
  slate: "石板",
  "contrast-light": "高对比浅",
  "contrast-dark": "高对比深",
  zenburn: "Zenburn",
};

export function applyTheme(preference: ThemePreference): void {
  const theme = preference === "auto"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", DARK_THEMES.includes(theme));
  localStorage.setItem("pi-theme", preference);
}
